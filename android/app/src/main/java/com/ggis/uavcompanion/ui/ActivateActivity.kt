package com.ggis.uavcompanion.ui

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import com.ggis.uavcompanion.data.Device
import com.ggis.uavcompanion.data.Session
import com.ggis.uavcompanion.data.Supabase
import com.ggis.uavcompanion.databinding.ActivityActivateBinding
import kotlin.concurrent.thread

/**
 * Device-licensing gate: bind THIS controller to a Pilot Ops license key before it can pair
 * and cast. One activation slot per key = one controller (see 0038/0039). Reached from
 * LoginActivity when device_status reports this device isn't activated for the pilot's org.
 */
class ActivateActivity : AppCompatActivity() {

    private lateinit var b: ActivityActivateBinding
    private lateinit var session: Session
    private val main = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityActivateBinding.inflate(layoutInflater)
        setContentView(b.root)
        session = Session(intent.getStringExtra(EXTRA_TOKEN).orEmpty(), intent.getStringExtra(EXTRA_USER_ID).orEmpty())
        b.deviceLabel.text = Device.label()
        b.activate.setOnClickListener { activate() }
    }

    private fun activate() {
        val key = b.key.text?.toString()?.trim().orEmpty()
        if (key.isEmpty()) { status("Enter your license key."); return }
        busy(true); status("Activating…")
        thread {
            val outcome = Supabase.activateDevice(
                session, key, Device.token(this), Device.fingerprint(), Device.label()
            ).getOrElse {
                main.post { busy(false); status(it.message ?: "Activation failed.") }; return@thread
            }
            main.post {
                busy(false)
                when {
                    outcome.ok -> {
                        Device.setActivated(this, true)
                        startActivity(Intent(this, PairActivity::class.java).apply {
                            putExtra(PairActivity.EXTRA_TOKEN, session.accessToken)
                            putExtra(PairActivity.EXTRA_USER_ID, session.userId)
                        })
                        finish()
                    }
                    outcome.reason == "invalid_key" -> status("That license key isn't valid for your organization.")
                    outcome.reason == "no_slots" -> status("All device slots for this key are in use. Ask your provider to release one or issue another key.")
                    else -> status("Activation failed. Contact your provider.")
                }
            }
        }
    }

    private fun busy(on: Boolean) { b.activate.isEnabled = !on }
    private fun status(msg: String) { b.status.text = msg }

    companion object {
        const val EXTRA_TOKEN = "token"
        const val EXTRA_USER_ID = "userId"
    }
}
