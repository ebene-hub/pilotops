package com.ggis.uavcompanion.stream

import com.ggis.uavcompanion.BuildConfig

/**
 * Builds the MediaMTX ingest URL for a flight. The path is the flight uuid and
 * the Supabase access token rides in the query string, where the stream-gateway
 * validates it (publish auth).
 */
object StreamConfig {
    val host: String get() = BuildConfig.STREAM_HOST
    val scheme: String get() = BuildConfig.STREAM_SCHEME.lowercase()

    fun ingestUrl(flightId: String, token: String): String = when (scheme) {
        "srt" -> "srt://$host:8890?streamid=publish:$flightId?token=$token"
        else -> "rtmp://$host:1935/$flightId?token=$token"
    }
}
