package com.ggis.uavcompanion.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.ggis.uavcompanion.data.Supabase
import com.ggis.uavcompanion.databinding.ActivityCastBinding
import com.ggis.uavcompanion.stream.CastBus
import com.ggis.uavcompanion.stream.CastStatus
import com.ggis.uavcompanion.stream.ScreenCastService
import com.ggis.uavcompanion.stream.StreamConfig
import kotlin.concurrent.thread

/** Shows the resolved mission and drives start/stop of the screen cast. */
class CastActivity : AppCompatActivity() {

    private lateinit var b: ActivityCastBinding
    private lateinit var flightId: String
    private lateinit var token: String
    private var casting = false
    private val main = Handler(Looper.getMainLooper())

    private val notifPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ensureLocationThenProject() }
    // Location is optional — whatever the user picks, proceed to the cast.
    private val locationPerm = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { requestProjection() }

    private val projection = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val data = res.data
        if (res.resultCode == RESULT_OK && data != null) {
            setStatus("Authorizing cast…")
            thread {
                // Authorise the publish over HTTPS first (RTMP can't carry the token).
                val grant = Supabase.grantStream(token, flightId, StreamConfig.grantUrl)
                main.post {
                    grant.fold(
                        onSuccess = {
                            ScreenCastService.start(this, res.resultCode, data, StreamConfig.ingestUrl(flightId), token, flightId)
                            casting = true; render()
                        },
                        onFailure = {
                            setStatus("Couldn't authorize the cast — ${it.message}. Make sure the mission is live in Pilot Ops and you're signed in as its pilot, then retry.")
                        }
                    )
                }
            }
        } else {
            setStatus("Screen capture permission was declined.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityCastBinding.inflate(layoutInflater)
        setContentView(b.root)

        token = intent.getStringExtra(EXTRA_TOKEN).orEmpty()
        flightId = intent.getStringExtra(EXTRA_FLIGHT_ID).orEmpty()
        b.mission.text = intent.getStringExtra(EXTRA_FLIGHT_LABEL) ?: flightId
        b.target.visibility = android.view.View.GONE

        b.toggle.setOnClickListener { if (casting) stop() else preflight() }
        render()

        // Came straight from pairing / "use my active mission" → start casting now
        // (still shows Android's screen-capture consent) instead of a second tap.
        if (intent.getBooleanExtra(EXTRA_AUTOSTART, false) && !casting) preflight()
    }

    override fun onResume() {
        super.onResume()
        // Flight ended while we were backgrounded → log out now.
        if (CastBus.ended) { goLogin(); return }
        CastBus.listener = { onStatus(it) }
        onStatus(CastBus.last)
    }

    override fun onPause() { super.onPause(); CastBus.listener = null }

    private fun preflight() {
        // Android 13+ needs notification permission for the foreground-service notice.
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            ensureLocationThenProject()
        }
    }

    // Ask for location once (so the controller's position can show on the Pilot Ops
    // map). It's optional — the cast proceeds whether granted or denied.
    private fun ensureLocationThenProject() {
        val haveLoc = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!haveLoc) {
            locationPerm.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        } else {
            requestProjection()
        }
    }

    private fun requestProjection() {
        val mpm = getSystemService(MediaProjectionManager::class.java)
        projection.launch(mpm.createScreenCaptureIntent())
    }

    private fun stop() {
        ScreenCastService.stop(this)
        casting = false; render()
    }

    private fun onStatus(s: CastStatus) {
        when (s) {
            is CastStatus.Connecting -> { setStatus("Connecting…") }
            is CastStatus.Live -> { casting = true; setStatus(if (s.bitrateKbps > 0) "LIVE · ${s.bitrateKbps} kbps" else "LIVE"); render() }
            is CastStatus.Failed -> { casting = false; setStatus("Failed · ${s.reason}"); render() }
            is CastStatus.Stopped -> { casting = false; setStatus("Idle"); render() }
            is CastStatus.Ended -> { casting = false; goLogin() }
        }
    }

    // Mission ended → stop is already done by the service; return to sign-in.
    private fun goLogin() {
        CastBus.ended = false
        CastBus.listener = null
        startActivity(Intent(this, LoginActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        })
        finish()
    }

    private fun render() { b.toggle.text = if (casting) "Stop casting" else "Start casting" }
    private fun setStatus(msg: String) { b.status.text = msg }

    companion object {
        const val EXTRA_TOKEN = "token"
        const val EXTRA_FLIGHT_ID = "flightId"
        const val EXTRA_FLIGHT_LABEL = "flightLabel"
        const val EXTRA_AUTOSTART = "autostart"
    }
}
