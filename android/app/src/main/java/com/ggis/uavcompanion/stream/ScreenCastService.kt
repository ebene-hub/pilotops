package com.ggis.uavcompanion.stream

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.ggis.uavcompanion.R
import com.ggis.uavcompanion.data.Supabase
import com.ggis.uavcompanion.ui.CastActivity
import com.pedro.common.ConnectChecker
import com.pedro.encoder.input.sources.audio.NoAudioSource
import com.pedro.encoder.input.sources.video.NoVideoSource
import com.pedro.encoder.input.sources.video.ScreenSource
import com.pedro.library.generic.GenericStream
import com.pedro.library.util.BitrateAdapter
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.min

/**
 * Foreground service that mirrors the controller screen (MediaProjection) and
 * streams it (RTMP/SRT) to MediaMTX. Video-only (no mic) — uses RootEncoder's
 * GenericStream with a ScreenSource.
 */
class ScreenCastService : Service(), ConnectChecker {

    private var stream: GenericStream? = null
    private var projection: MediaProjection? = null
    private val mpm by lazy { getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager }
    @Volatile private var polling = false
    @Volatile private var castToken = ""
    @Volatile private var castFlightId = ""
    // Capture-stall watchdog state. A frozen MediaProjection keeps the stream
    // "connected" and still emits bytes (forceRender pads the last frame), so the
    // only field signal is a bitrate that collapses to the static floor.
    @Volatile private var lastMotionMs = 0L
    @Volatile private var healsSinceMotion = 0
    // Adapts the encoder bitrate to the real uplink (poor field internet) so the
    // cast backs off and recovers instead of saturating and freezing for viewers.
    private var bitrateAdapter: BitrateAdapter? = null
    // Controller GPS → flight row (shown on the Pilot Ops map).
    private var locationManager: LocationManager? = null
    private var locationListener: LocationListener? = null
    @Volatile private var lastLocSentMs = 0L
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopCast(); return START_NOT_STICKY }
            ACTION_START -> startCast(intent)
        }
        return START_STICKY
    }

    private fun startCast(intent: Intent) {
        startInForeground()

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        val data: Intent? = intent.getParcelableExtra(EXTRA_DATA)
        val url = intent.getStringExtra(EXTRA_URL).orEmpty()
        val token = intent.getStringExtra(EXTRA_TOKEN).orEmpty()
        val flightId = intent.getStringExtra(EXTRA_FLIGHT_ID).orEmpty()
        castToken = token; castFlightId = flightId
        if (data == null || url.isEmpty()) { stopCast(); return }

        CastBus.emit(CastStatus.Connecting)

        val metrics = resources.displayMetrics
        val maxLong = 1280
        val scale = min(1f, maxLong.toFloat() / max(metrics.widthPixels, metrics.heightPixels))
        val w = (metrics.widthPixels * scale).toInt().let { it - it % 2 }
        val h = (metrics.heightPixels * scale).toInt().let { it - it % 2 }
        val rotation = if (metrics.heightPixels > metrics.widthPixels) 90 else 0

        val s = GenericStream(this, this, NoVideoSource(), NoAudioSource()).apply {
            // MediaProjection only emits frames when the screen changes — force a
            // steady frame rate so the feed stays smooth on a static screen.
            getGlInterface().setForceRender(true, 15)
        }
        stream = s

        val prepared = try {
            // iFrameInterval = 1s (frequent keyframes) trims connect + recovery latency.
            s.prepareVideo(w, h, BITRATE, FPS, iFrameInterval = 1, rotation = rotation) && s.prepareAudio(32000, true, 128 * 1000)
        } catch (_: Exception) { false }
        if (!prepared) { CastBus.emit(CastStatus.Failed("Encoder init failed")); stopCast(); return }

        // Cap adaptation at the configured bitrate; it scales down under uplink
        // congestion and climbs back up as the connection recovers.
        bitrateAdapter = BitrateAdapter { br -> try { stream?.setVideoBitrateOnFly(br) } catch (_: Exception) {} }
            .apply { setMaxBitrate(BITRATE) }

        val mp = mpm.getMediaProjection(resultCode, data)
        if (mp == null) { CastBus.emit(CastStatus.Failed("Screen capture unavailable")); stopCast(); return }
        projection = mp
        try {
            polling = true   // we're now "active"; handleDrop will check the flight on any drop
            s.changeVideoSource(ScreenSource(applicationContext, mp))
            s.startStream(url)
            lastMotionMs = System.currentTimeMillis(); healsSinceMotion = 0
            startEndWatch(token, flightId)
            startStallWatch()
            startLocationUpdates(token, flightId)
        } catch (e: Exception) {
            CastBus.emit(CastStatus.Failed(e.message ?: "Could not start cast")); stopCast()
        }
    }

    // Detect a wedged screen capture (frames stopped updating while the encoder
    // keeps padding the last frame) and self-heal by rebuilding the capture surface
    // — no pilot action, no viewer refresh. For live drone ops the cast normally
    // has motion, so a bitrate stuck at the static floor for STALL_MS means frozen.
    private fun startStallWatch() {
        thread {
            while (polling) {
                try { Thread.sleep(3000) } catch (_: InterruptedException) {}
                if (!polling) break
                val idle = System.currentTimeMillis() - lastMotionMs
                // One heal per stall episode; re-armed only once real motion returns
                // (healsSinceMotion is reset in onNewBitrate). So a genuinely static
                // but healthy screen costs at most one harmless refresh, not a loop.
                if (idle > STALL_MS && healsSinceMotion == 0) {
                    healsSinceMotion++
                    lastMotionMs = System.currentTimeMillis()
                    healCapture()
                }
            }
        }
    }

    private fun healCapture() {
        val mp = projection ?: return
        mainHandler.post {
            try {
                val s = stream ?: return@post
                if (s.isStreaming) {
                    // Rebuild the MediaProjection VirtualDisplay on the same projection;
                    // a stalled capture resumes when the surface is recreated. With
                    // iFrameInterval = 1 a fresh keyframe follows within ~1s, so every
                    // viewer recovers without refreshing.
                    s.changeVideoSource(ScreenSource(applicationContext, mp))
                }
            } catch (_: Exception) {}
        }
    }

    // Poll the flight while casting; when Pilot Ops ends it, stop and signal the
    // app to log the pilot out (works even while the app is backgrounded).
    private fun startEndWatch(token: String, flightId: String) {
        if (token.isEmpty() || flightId.isEmpty()) return
        polling = true
        thread {
            while (polling) {
                try { Thread.sleep(8000) } catch (_: InterruptedException) {}
                if (!polling) break
                val status = Supabase.flightStatus(token, flightId).getOrNull() ?: continue
                if (status != "live") {
                    CastBus.ended = true
                    CastBus.emit(CastStatus.Ended)
                    mainHandler.post { stopCast() }
                    break
                }
            }
        }
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    // Stream the controller's GPS to the flight row (cur_lat/cur_lng) while casting,
    // so the Pilot Ops map shows where the controller actually is — not the viewer's
    // PC. Best-effort: if permission is denied or no provider, the cast is unaffected.
    private fun startLocationUpdates(token: String, flightId: String) {
        if (!hasLocationPermission() || token.isEmpty() || flightId.isEmpty()) return
        val lm = getSystemService(LOCATION_SERVICE) as? LocationManager ?: return
        locationManager = lm
        val listener = object : LocationListener {
            override fun onLocationChanged(loc: Location) {
                val now = System.currentTimeMillis()
                if (now - lastLocSentMs < LOC_INTERVAL_MS) return
                lastLocSentMs = now
                val lat = loc.latitude; val lng = loc.longitude
                thread { Supabase.updateLocation(token, flightId, lat, lng) }
            }
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
            @Deprecated("Required on API < 30")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        locationListener = listener
        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, LOC_INTERVAL_MS, 5f, listener, Looper.getMainLooper())
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, LOC_INTERVAL_MS, 5f, listener, Looper.getMainLooper())
            // Seed immediately with the last known fix so the pin isn't blank.
            val last = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            if (last != null) { val la = last.latitude; val lo = last.longitude; thread { Supabase.updateLocation(token, flightId, la, lo) } }
        } catch (_: SecurityException) {}
    }

    private fun stopLocationUpdates() {
        try { locationListener?.let { locationManager?.removeUpdates(it) } } catch (_: Exception) {}
        locationListener = null; locationManager = null
    }

    private fun stopCast() {
        polling = false
        bitrateAdapter = null
        stopLocationUpdates()
        try { stream?.let { if (it.isStreaming) it.stopStream() } } catch (_: Exception) {}
        try { stream?.release() } catch (_: Exception) {}
        stream = null
        try { projection?.stop() } catch (_: Exception) {}
        projection = null
        CastBus.emit(CastStatus.Stopped)
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        stopSelf()
    }

    // ---- ConnectChecker ----
    override fun onConnectionStarted(url: String) { CastBus.emit(CastStatus.Connecting) }
    override fun onConnectionSuccess() { lastMotionMs = System.currentTimeMillis(); healsSinceMotion = 0; CastBus.emit(CastStatus.Live(0)) }
    override fun onNewBitrate(bitrate: Long) {
        // Feed the real sent bitrate (and uplink congestion) to the adapter so it
        // can dial the encoder up/down to match the field connection.
        try { bitrateAdapter?.adaptBitrate(bitrate, stream?.getStreamClient()?.hasCongestion() ?: false) } catch (_: Exception) {}
        // Bitrate above the static floor = the capture is delivering fresh frames →
        // mark motion and re-arm the stall watchdog.
        if (bitrate > MOTION_FLOOR_BPS) { lastMotionMs = System.currentTimeMillis(); healsSinceMotion = 0 }
        CastBus.emit(CastStatus.Live(bitrate / 1000))
    }
    override fun onConnectionFailed(reason: String) { handleDrop(reason, failed = true) }
    override fun onDisconnect() { handleDrop(null, failed = false) }
    override fun onAuthError() { handleDrop("Stream auth rejected", failed = true) }
    override fun onAuthSuccess() {}

    // A dropped connection can mean Pilot Ops ended the mission (the server
    // unpublishes us) or a transient network fault. This often fires *before* the
    // end-watch poll, so check the flight here too: if it's no longer live, signal
    // Ended (→ log the pilot out); otherwise just reflect failed/stopped.
    private fun handleDrop(reason: String?, failed: Boolean) {
        if (!polling) { CastBus.emit(CastStatus.Stopped); return }  // manual stop already underway
        polling = false
        val t = castToken; val fid = castFlightId
        thread {
            val live = if (t.isNotEmpty() && fid.isNotEmpty())
                (Supabase.flightStatus(t, fid).getOrNull() == "live") else true
            if (!live) { CastBus.ended = true; CastBus.emit(CastStatus.Ended) }
            else CastBus.emit(if (failed) CastStatus.Failed(reason ?: "Connection lost") else CastStatus.Stopped)
            mainHandler.post { stopCast() }
        }
    }

    // ---- foreground notification ----
    private fun startInForeground() {
        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            mgr.createNotificationChannel(NotificationChannel(CHANNEL, "Live cast", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, CastActivity::class.java),
            if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0
        )
        val notif: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("GGIS UAV Companion")
            .setContentText("Casting controller screen to Pilot Ops")
            .setSmallIcon(R.drawable.ic_launcher)
            .setOngoing(true)
            .setContentIntent(open)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            // Declare the location FGS type only when we actually hold the permission;
            // passing it without permission throws on Android 14+.
            var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            if (hasLocationPermission()) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            startForeground(NOTIF_ID, notif, type)
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    companion object {
        const val ACTION_START = "com.ggis.uavcompanion.START"
        const val ACTION_STOP = "com.ggis.uavcompanion.STOP"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_DATA = "data"
        const val EXTRA_URL = "url"
        const val EXTRA_TOKEN = "token"
        const val EXTRA_FLIGHT_ID = "flightId"
        private const val CHANNEL = "cast"
        private const val NOTIF_ID = 42
        private const val FPS = 30
        // Ceiling for the adaptive encoder. 2 Mbps @ 720p30 is sustainable for most
        // viewers' downlinks; the adapter scales below this when the uplink is poor.
        private const val BITRATE = 2_000_000
        // Below this the encoder is almost certainly re-sending a static/frozen
        // frame; sustained for STALL_MS we rebuild the capture surface.
        private const val MOTION_FLOOR_BPS = 350_000L
        private const val STALL_MS = 12_000L
        // How often (min) to push the controller's GPS to the flight row.
        private const val LOC_INTERVAL_MS = 8_000L

        fun start(ctx: Context, resultCode: Int, data: Intent, url: String, token: String, flightId: String) {
            val i = Intent(ctx, ScreenCastService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_DATA, data)
                putExtra(EXTRA_URL, url)
                putExtra(EXTRA_TOKEN, token)
                putExtra(EXTRA_FLIGHT_ID, flightId)
            }
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, ScreenCastService::class.java).apply { action = ACTION_STOP })
        }
    }
}
