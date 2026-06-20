package com.ggis.uavcompanion.stream

import android.os.Handler
import android.os.Looper

/** Streaming state, surfaced to the UI. */
sealed class CastStatus {
    data object Connecting : CastStatus()
    data class Live(val bitrateKbps: Long) : CastStatus()
    data class Failed(val reason: String) : CastStatus()
    data object Stopped : CastStatus()
}

/** Minimal main-thread event bus between the service and the activity. */
object CastBus {
    @Volatile var listener: ((CastStatus) -> Unit)? = null
    @Volatile var last: CastStatus = CastStatus.Stopped
    private val main = Handler(Looper.getMainLooper())
    fun emit(s: CastStatus) { last = s; main.post { listener?.invoke(s) } }
}
