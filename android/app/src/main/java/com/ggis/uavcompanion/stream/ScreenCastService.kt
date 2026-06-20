package com.ggis.uavcompanion.stream

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.ggis.uavcompanion.R
import com.ggis.uavcompanion.ui.CastActivity
import com.pedro.common.ConnectChecker
import com.pedro.library.generic.GenericDisplay
import kotlin.math.max
import kotlin.math.min

/**
 * Foreground service that mirrors the controller screen (MediaProjection) and
 * streams it (RTMP/SRT) to MediaMTX. Holds the encoder for the cast's lifetime.
 */
class ScreenCastService : Service(), ConnectChecker {

    private var display: GenericDisplay? = null

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
        if (data == null || url.isEmpty()) { stopCast(); return }

        CastBus.emit(CastStatus.Connecting)

        val disp = GenericDisplay(this, true, this)
        disp.setIntentResult(resultCode, data)
        display = disp

        val metrics = resources.displayMetrics
        val maxLong = 1280
        val scale = min(1f, maxLong.toFloat() / max(metrics.widthPixels, metrics.heightPixels))
        val w = (metrics.widthPixels * scale).toInt().let { it - it % 2 }
        val h = (metrics.heightPixels * scale).toInt().let { it - it % 2 }

        val ok = disp.prepareVideo(w, h, FPS, BITRATE, 0, metrics.densityDpi) && disp.prepareAudio()
        if (!ok) { CastBus.emit(CastStatus.Failed("Encoder init failed")); stopCast(); return }
        disp.startStream(url)
    }

    private fun stopCast() {
        try { display?.let { if (it.isStreaming) it.stopStream() } } catch (_: Exception) {}
        display = null
        CastBus.emit(CastStatus.Stopped)
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        stopSelf()
    }

    // ---- ConnectChecker ----
    override fun onConnectionStarted(url: String) { CastBus.emit(CastStatus.Connecting) }
    override fun onConnectionSuccess() { CastBus.emit(CastStatus.Live(0)) }
    override fun onNewBitrate(bitrate: Long) { CastBus.emit(CastStatus.Live(bitrate / 1000)) }
    override fun onConnectionFailed(reason: String) { CastBus.emit(CastStatus.Failed(reason)); stopCast() }
    override fun onDisconnect() { CastBus.emit(CastStatus.Stopped) }
    override fun onAuthError() { CastBus.emit(CastStatus.Failed("Stream auth rejected")); stopCast() }
    override fun onAuthSuccess() {}

    // ---- foreground notification ----
    private fun startInForeground() {
        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            mgr.createNotificationChannel(
                NotificationChannel(CHANNEL, "Live cast", NotificationManager.IMPORTANCE_LOW)
            )
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
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
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
        private const val CHANNEL = "cast"
        private const val NOTIF_ID = 42
        private const val FPS = 30
        private const val BITRATE = 2_500_000

        fun start(ctx: Context, resultCode: Int, data: Intent, url: String) {
            val i = Intent(ctx, ScreenCastService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_DATA, data)
                putExtra(EXTRA_URL, url)
            }
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, ScreenCastService::class.java).apply { action = ACTION_STOP })
        }
    }
}
