package com.ggis.uavcompanion.ui

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import com.ggis.uavcompanion.data.Device
import com.ggis.uavcompanion.data.Session
import com.ggis.uavcompanion.data.Supabase
import com.ggis.uavcompanion.databinding.ActivityLoginBinding
import kotlin.concurrent.thread

/** Sign in with Pilot Ops credentials, then resolve the pilot's live mission. */
class LoginActivity : AppCompatActivity() {

    private lateinit var b: ActivityLoginBinding
    private val main = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.signIn.setOnClickListener { signIn() }
    }

    private fun signIn() {
        val email = b.email.text?.toString()?.trim().orEmpty()
        val password = b.password.text?.toString().orEmpty()
        if (email.isEmpty() || password.isEmpty()) { status("Enter your email and password."); return }

        busy(true); status("Signing in…")
        thread {
            val session = Supabase.signIn(email, password).getOrElse {
                main.post { busy(false); status(it.message ?: "Sign-in failed.") }; return@thread
            }
            // Device-licensing gate: this controller must be activated (or its org unlicensed).
            main.post { status("Checking controller…") }
            val token = Device.token(this)
            val statusRes = Supabase.deviceStatus(session, token)
            val activated = statusRes.getOrElse {
                // Network error → trust the last-known state so a bound controller keeps working.
                Device.wasActivated(this)
            }
            if (statusRes.isSuccess) Device.setActivated(this, activated)
            main.post {
                busy(false)
                if (activated) goPair(session) else goActivate(session)
            }
        }
    }

    private fun goPair(session: Session) {
        startActivity(Intent(this, PairActivity::class.java).apply {
            putExtra(PairActivity.EXTRA_TOKEN, session.accessToken)
            putExtra(PairActivity.EXTRA_USER_ID, session.userId)
        })
    }

    private fun goActivate(session: Session) {
        startActivity(Intent(this, ActivateActivity::class.java).apply {
            putExtra(ActivateActivity.EXTRA_TOKEN, session.accessToken)
            putExtra(ActivateActivity.EXTRA_USER_ID, session.userId)
        })
    }

    private fun busy(on: Boolean) { b.signIn.isEnabled = !on }
    private fun status(msg: String) { b.status.text = msg }
}
