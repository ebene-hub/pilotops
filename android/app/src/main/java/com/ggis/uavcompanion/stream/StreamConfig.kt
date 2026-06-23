package com.ggis.uavcompanion.stream

import com.ggis.uavcompanion.BuildConfig

/**
 * MediaMTX ingest URL for a flight (path = flight uuid). RTMP clients drop the
 * URL query, so the token is NOT carried here — the app authorises the cast via
 * the gateway's /grant endpoint first (see Supabase.grantStream).
 */
object StreamConfig {
    val host: String get() = BuildConfig.STREAM_HOST
    val scheme: String get() = BuildConfig.STREAM_SCHEME.lowercase()
    val grantUrl: String get() = "https://$host/grant"

    fun ingestUrl(flightId: String): String = when (scheme) {
        "srt" -> "srt://$host:8890?streamid=publish:$flightId"
        else -> "rtmp://$host:1935/$flightId"
    }
}
