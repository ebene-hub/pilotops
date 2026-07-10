package com.ggis.uavcompanion.data

import android.content.Context
import android.os.Build
import android.provider.Settings
import java.security.MessageDigest

/**
 * Per-controller identity for device licensing (see 0038/0039).
 *
 * The token is Settings.Secure.ANDROID_ID — a 64-bit value scoped to the app signing key +
 * device + user. It survives app reinstall (same signing key) and changes only on factory
 * reset, so it genuinely binds this APK to one controller: side-load it onto another device
 * and the ANDROID_ID differs, so it won't be activated. (Server-enforced via activate_device
 * / device_status; the ID alone grants nothing.)
 */
object Device {

    /** Stable per-device token. Falls back to a Build-derived hash if ANDROID_ID is blank. */
    fun token(ctx: Context): String {
        val id = try {
            Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID)
        } catch (_: Throwable) { null }
        return if (!id.isNullOrBlank() && id != "9774d56d682e549c") id else "fp:" + fingerprint()
    }

    /** Secondary signal (hardware/build) used for reinstall-resilient rebind server-side. */
    fun fingerprint(): String =
        sha256("${Build.MANUFACTURER}|${Build.MODEL}|${Build.DEVICE}|${Build.BOARD}|${Build.FINGERPRINT}")

    /** Friendly controller name shown to the admin in the platform console. */
    fun label(): String = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

    // Last-known activation state, so a bound controller isn't stranded in the field if the
    // activation check can't reach the server. Only trusted as a fallback on a network error;
    // a definitive server "not activated" always overrides it.
    private const val PREFS = "po_device"
    private const val KEY_ACTIVATED = "activated"

    fun setActivated(ctx: Context, value: Boolean) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ACTIVATED, value).apply()
    }

    fun wasActivated(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ACTIVATED, false)

    private fun sha256(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray())
            .joinToString("") { "%02x".format(it) }
}
