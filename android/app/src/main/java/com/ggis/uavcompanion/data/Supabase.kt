package com.ggis.uavcompanion.data

import com.ggis.uavcompanion.BuildConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Tiny Supabase REST client (GoTrue auth + PostgREST) — no SDK, just OkHttp.
 * All calls are synchronous; call them off the main thread.
 */
object Supabase {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private val base = BuildConfig.SUPABASE_URL.trimEnd('/')
    private val anon = BuildConfig.SUPABASE_ANON_KEY
    private val JSON = "application/json".toMediaType()

    /** Email/password sign-in → access token + user id. */
    fun signIn(email: String, password: String): Result<Session> = runCatching {
        val body = JSONObject().put("email", email.trim()).put("password", password)
        val req = Request.Builder()
            .url("$base/auth/v1/token?grant_type=password")
            .header("apikey", anon)
            .header("Content-Type", "application/json")
            .post(body.toString().toRequestBody(JSON))
            .build()
        http.newCall(req).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) error(messageOf(text) ?: "Sign-in failed (${res.code})")
            val json = JSONObject(text)
            val token = json.optString("access_token")
            val uid = json.optJSONObject("user")?.optString("id").orEmpty()
            if (token.isEmpty() || uid.isEmpty()) error("Unexpected sign-in response")
            Session(token, uid)
        }
    }

    /** The newest live flight where the signed-in user is the pilot, or null. */
    fun activeFlight(session: Session): Result<Flight?> = runCatching {
        val url = "$base/rest/v1/flights?select=id,code,area&status=eq.live" +
            "&pilot_id=eq.${session.userId}&order=created_at.desc&limit=1"
        val req = Request.Builder()
            .url(url)
            .header("apikey", anon)
            .header("Authorization", "Bearer ${session.accessToken}")
            .get()
            .build()
        http.newCall(req).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) error("Could not load mission (${res.code})")
            val arr = JSONArray(text)
            if (arr.length() == 0) return@use null
            val o = arr.getJSONObject(0)
            Flight(o.getString("id"), o.optString("code", null), o.optString("area", null))
        }
    }

    /** Current status of a flight ('live', 'completed', …), or null. */
    fun flightStatus(token: String, flightId: String): Result<String?> = runCatching {
        val req = Request.Builder()
            .url("$base/rest/v1/flights?select=status&id=eq.$flightId")
            .header("apikey", anon)
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return@use null
            val arr = JSONArray(res.body?.string().orEmpty())
            if (arr.length() == 0) null else arr.getJSONObject(0).optString("status").ifEmpty { null }
        }
    }

    /** Push the controller's current GPS to the flight row (cur_lat/cur_lng) so it
     *  shows on the Pilot Ops map. Best-effort; failures are swallowed by the caller. */
    fun updateLocation(token: String, flightId: String, lat: Double, lng: Double): Result<Unit> = runCatching {
        val body = JSONObject().put("cur_lat", lat).put("cur_lng", lng)
        val req = Request.Builder()
            .url("$base/rest/v1/flights?id=eq.$flightId")
            .header("apikey", anon)
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .patch(body.toString().toRequestBody(JSON))
            .build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) error("location update failed (${res.code})")
        }
    }

    /** Pre-authorise a cast: the gateway records a short-lived publish grant for
     *  this flight so the (token-less) RTMP push that follows is allowed.
     *  Succeeds (Result.success) when authorised; on denial fails with the
     *  gateway's reason (e.g. "not live", "cross-org", "not crew") as the message. */
    fun grantStream(token: String, flightId: String, grantUrl: String): Result<Unit> = runCatching {
        val body = JSONObject().put("flightId", flightId).put("token", token)
        val req = Request.Builder()
            .url(grantUrl)
            .header("Content-Type", "application/json")
            .post(body.toString().toRequestBody(JSON))
            .build()
        http.newCall(req).execute().use { res ->
            if (res.isSuccessful) return@runCatching
            val text = res.body?.string().orEmpty()
            val reason = runCatching { JSONObject(text).optString("reason") }.getOrNull()?.ifEmpty { null }
            error(reason ?: "denied (HTTP ${res.code})")
        }
    }

    /** Exchange a pairing code (shown in Pilot Ops) for the bound flight. */
    fun resolvePairCode(session: Session, code: String): Result<Flight?> = runCatching {
        val body = JSONObject().put("p_code", code.trim())
        val req = Request.Builder()
            .url("$base/rest/v1/rpc/resolve_pair_code")
            .header("apikey", anon)
            .header("Authorization", "Bearer ${session.accessToken}")
            .header("Content-Type", "application/json")
            .post(body.toString().toRequestBody(JSON))
            .build()
        http.newCall(req).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) error("Pairing failed (${res.code})")
            val o = JSONObject(text)
            if (!o.optBoolean("ok")) return@use null
            Flight(o.getString("flight_id"), o.optString("label", null), null)
        }
    }

    private fun messageOf(body: String): String? = runCatching {
        val o = JSONObject(body)
        o.optString("error_description").ifEmpty { o.optString("msg").ifEmpty { o.optString("error") } }
            .ifEmpty { null }
    }.getOrNull()
}
