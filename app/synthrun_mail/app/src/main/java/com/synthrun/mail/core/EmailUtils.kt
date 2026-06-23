package com.synthrun.mail.core

// ── Email formatting helpers (same as web) ──
object EmailUtils {
    fun sanitizeEmail(email: String): String = email.trim().lowercase()

    fun formatSenderName(email: String): String {
        val local = email.split("@")[0]
            .replace(Regex("[._-]+"), " ")
            .trim()
            .split("\\s+".toRegex())
            .joinToString(" ") { it.replaceFirstChar(Char::uppercase) }
        return local.ifEmpty { "Synthrun" }
    }
}