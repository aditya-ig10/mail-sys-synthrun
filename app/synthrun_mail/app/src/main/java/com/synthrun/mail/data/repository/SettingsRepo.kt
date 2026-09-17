package com.synthrun.mail.data.repository

import android.content.Context
import android.content.SharedPreferences
import com.google.firebase.firestore.FirebaseFirestore
import com.synthrun.mail.data.model.UserSettings
import kotlinx.coroutines.tasks.await

class SettingsRepo(private val context: Context) {
    private val db = FirebaseFirestore.getInstance()
    private val prefs: SharedPreferences = context.getSharedPreferences("synthrun_settings", Context.MODE_PRIVATE)

    fun loadCached(): UserSettings {
        val theme = prefs.getString("theme", "system") ?: "system"
        val layout = prefs.getString("layout", "synthrun") ?: "synthrun"
        val density = prefs.getString("density", "comfortable") ?: "comfortable"
        return UserSettings(theme = theme, layout = layout, density = density)
    }

    private fun cache(settings: UserSettings) {
        prefs.edit()
            .putString("theme", settings.theme)
            .putString("layout", settings.layout)
            .putString("density", settings.density)
            .apply()
    }

    suspend fun fetch(uid: String): UserSettings {
        return try {
            val snap = db.collection("user_settings").document(uid).get().await()
            val s = if (snap.exists()) UserSettings.fromMap(snap.data ?: emptyMap()) else UserSettings()
            cache(s)
            s
        } catch (_: Exception) {
            loadCached()
        }
    }

    suspend fun save(uid: String, settings: UserSettings) {
        cache(settings)
        try {
            db.collection("user_settings").document(uid).set(settings.toMap()).await()
        } catch (_: Exception) {}
    }

    suspend fun updateTheme(uid: String, theme: String) {
        val s = loadCached().copy(theme = theme)
        save(uid, s)
    }

    suspend fun updateLayout(uid: String, layout: String) {
        val s = loadCached().copy(layout = layout)
        save(uid, s)
    }

    suspend fun updateDensity(uid: String, density: String) {
        val s = loadCached().copy(density = density)
        save(uid, s)
    }

    // ── 2FA ──
    suspend fun enableTotp(uid: String, secret: String) {
        db.collection("user_settings").document(uid)
            .update("totpEnabled", true, "totpSecret", secret).await()
    }

    suspend fun disableTotp(uid: String) {
        db.collection("user_settings").document(uid)
            .update("totpEnabled", false, "totpSecret", "").await()
    }
}
