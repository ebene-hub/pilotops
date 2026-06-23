package com.ggis.uavcompanion.ui

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import com.ggis.uavcompanion.data.Flight
import com.ggis.uavcompanion.data.Session
import com.ggis.uavcompanion.data.Supabase
import com.ggis.uavcompanion.databinding.ActivityPairBinding
import kotlin.concurrent.thread

/**
 * Enter the pairing code shown in Pilot Ops (or use the pilot's own active
 * mission) to bind this controller to a flight before casting.
 */
class PairActivity : AppCompatActivity() {

    private lateinit var b: ActivityPairBinding
    private lateinit var session: Session
    private val main = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityPairBinding.inflate(layoutInflater)
        setContentView(b.root)
        session = Session(intent.getStringExtra(EXTRA_TOKEN).orEmpty(), intent.getStringExtra(EXTRA_USER_ID).orEmpty())

        b.connect.setOnClickListener { connect() }
        b.useActive.setOnClickListener { useActiveMission() }
    }

    private fun connect() {
        val code = b.code.text?.toString()?.trim().orEmpty()
        if (code.length < 6) { status("Enter the 6-digit code from Pilot Ops."); return }
        busy(true); status("Pairing…")
        thread {
            val flight = Supabase.resolvePairCode(session, code).getOrElse {
                main.post { busy(false); status(it.message ?: "Pairing failed.") }; return@thread
            }
            main.post {
                busy(false)
                if (flight == null) status("That code isn't valid for a live mission. Check Pilot Ops and try again.")
                else launchCast(flight)
            }
        }
    }

    private fun useActiveMission() {
        busy(true); status("Finding your mission…")
        thread {
            val flight = Supabase.activeFlight(session).getOrElse {
                main.post { busy(false); status(it.message ?: "Could not load mission.") }; return@thread
            }
            main.post {
                busy(false)
                if (flight == null) status("No active mission. Start one in Pilot Ops, then enter the code.")
                else launchCast(flight)
            }
        }
    }

    private fun launchCast(flight: Flight) {
        startActivity(Intent(this, CastActivity::class.java).apply {
            putExtra(CastActivity.EXTRA_TOKEN, session.accessToken)
            putExtra(CastActivity.EXTRA_FLIGHT_ID, flight.id)
            putExtra(CastActivity.EXTRA_FLIGHT_LABEL, flight.code ?: flight.area ?: flight.id)
            putExtra(CastActivity.EXTRA_AUTOSTART, true)
        })
    }

    private fun busy(on: Boolean) { b.connect.isEnabled = !on; b.useActive.isEnabled = !on }
    private fun status(msg: String) { b.status.text = msg }

    companion object {
        const val EXTRA_TOKEN = "token"
        const val EXTRA_USER_ID = "userId"
    }
}
