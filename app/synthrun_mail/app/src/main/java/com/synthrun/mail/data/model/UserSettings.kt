package com.synthrun.mail.data.model

data class UserSettings(
    val theme: String = "system",
    val layout: String = "synthrun",
    val density: String = "comfortable",
    val totpEnabled: Boolean = false,
    val totpSecret: String = "",
    val backupEmail: String = ""
) {
    companion object {
        fun fromMap(map: Map<String, Any>): UserSettings = UserSettings(
            theme = map["theme"] as? String ?: "system",
            layout = map["layout"] as? String ?: "synthrun",
            density = map["density"] as? String ?: "comfortable",
            totpEnabled = map["totpEnabled"] as? Boolean ?: false,
            totpSecret = map["totpSecret"] as? String ?: "",
            backupEmail = map["backupEmail"] as? String ?: ""
        )
    }

    fun toMap(): Map<String, Any> = mapOf(
        "theme" to theme, "layout" to layout, "density" to density,
        "totpEnabled" to totpEnabled, "totpSecret" to totpSecret,
        "backupEmail" to backupEmail
    )
}
