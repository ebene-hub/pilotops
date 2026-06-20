package com.ggis.uavcompanion.data

/** A signed-in Supabase session. */
data class Session(val accessToken: String, val userId: String)

/** The pilot's currently-live flight (the cast target). */
data class Flight(val id: String, val code: String?, val area: String?)
