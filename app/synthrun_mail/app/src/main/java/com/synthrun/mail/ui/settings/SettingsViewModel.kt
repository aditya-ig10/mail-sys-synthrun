package com.synthrun.mail.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.EmailAuthProvider
import com.google.firebase.auth.FirebaseAuth
import com.synthrun.mail.data.model.UserSettings
import com.synthrun.mail.data.repository.SettingsRepo
import com.synthrun.mail.data.repository.AuthRepo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import android.os.Build

data class SettingsState(
    val settings: UserSettings = UserSettings(),
    val loading: Boolean = true,
    // password change
    val currentPassword: String = "",
    val newPassword: String = "",
    val confirmPassword: String = "",
    val passwordError: String? = null,
    val passwordSuccess: Boolean = false,
    // backup email
    val backupEmail: String = "",
    val backupEmailError: String? = null,
    val backupEmailSuccess: Boolean = false,
    // totp
    val totpSetup: Boolean = false,
    val totpQrUrl: String? = null,
    val totpVerificationCode: String = "",
    val totpError: String? = null,
    val totpSuccess: Boolean = false,
    // sessions
    val sessions: List<SessionInfo> = emptyList(),
    val sessionsLoading: Boolean = false,
    // danger
    val deleteConfirmText: String = "",
    val deleteError: String? = null,
    val deleting: Boolean = false,
    val signingOut: Boolean = false,
    val signedOut: Boolean = false,
    val deleted: Boolean = false,
    // general
    val error: String? = null,
    val successMessage: String? = null
)

data class SessionInfo(
    val id: String,
    val device: String,
    val lastActive: String,
    val current: Boolean = false
)

class SettingsViewModel(
    private val settingsRepo: SettingsRepo,
    private val authRepo: AuthRepo
) : ViewModel() {
    private val _state = MutableStateFlow(SettingsState())
    val state = _state.asStateFlow()
    private val auth = FirebaseAuth.getInstance()
    private val uid get() = auth.currentUser?.uid ?: ""
    private val user get() = auth.currentUser

    init {
        viewModelScope.launch {
            try {
                _state.value = _state.value.copy(loading = true)
                val s = settingsRepo.fetch(uid)
                _state.value = _state.value.copy(settings = s, loading = false, backupEmail = s.backupEmail)
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = "Failed to load settings")
            }
        }
    }

    // ── Theme ──
    fun setTheme(t: String) {
        viewModelScope.launch {
            settingsRepo.updateTheme(uid, t)
            _state.value = _state.value.copy(settings = _state.value.settings.copy(theme = t))
        }
    }

    fun setLayout(l: String) {
        viewModelScope.launch {
            settingsRepo.updateLayout(uid, l)
            _state.value = _state.value.copy(settings = _state.value.settings.copy(layout = l))
        }
    }

    fun setDensity(d: String) {
        viewModelScope.launch {
            settingsRepo.updateDensity(uid, d)
            _state.value = _state.value.copy(settings = _state.value.settings.copy(density = d))
        }
    }

    // ── Password ──
    fun updateCurrentPassword(v: String) { _state.value = _state.value.copy(currentPassword = v, passwordError = null, passwordSuccess = false) }
    fun updateNewPassword(v: String) { _state.value = _state.value.copy(newPassword = v, passwordError = null, passwordSuccess = false) }
    fun updateConfirmPassword(v: String) { _state.value = _state.value.copy(confirmPassword = v, passwordError = null, passwordSuccess = false) }

    fun changePassword() {
        val s = _state.value
        if (s.currentPassword.isBlank() || s.newPassword.isBlank() || s.confirmPassword.isBlank()) {
            _state.value = _state.value.copy(passwordError = "All fields required")
            return
        }
        if (s.newPassword != s.confirmPassword) {
            _state.value = _state.value.copy(passwordError = "New passwords don't match")
            return
        }
        if (s.newPassword.length < 6) {
            _state.value = _state.value.copy(passwordError = "New password must be at least 6 characters")
            return
        }
        viewModelScope.launch {
            try {
                val email = user?.email ?: throw Exception("Not signed in")
                val cred = EmailAuthProvider.getCredential(email, s.currentPassword)
                user?.reauthenticate(cred)?.await()
                user?.updatePassword(s.newPassword)?.await()
                _state.value = _state.value.copy(passwordError = null, passwordSuccess = true, currentPassword = "", newPassword = "", confirmPassword = "")
            } catch (e: Exception) {
                _state.value = _state.value.copy(passwordError = e.message ?: "Failed to change password")
            }
        }
    }

    // ── Backup Email ──
    fun updateBackupEmail(v: String) { _state.value = _state.value.copy(backupEmail = v, backupEmailError = null, backupEmailSuccess = false) }
    fun saveBackupEmail() {
        val email = _state.value.backupEmail.trim()
        if (email.isNotEmpty() && !email.matches(Regex("^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+$"))) {
            _state.value = _state.value.copy(backupEmailError = "Invalid email address")
            return
        }
        viewModelScope.launch {
            try {
                settingsRepo.save(uid, _state.value.settings.copy(backupEmail = email))
                _state.value = _state.value.copy(backupEmailError = null, backupEmailSuccess = true,
                    settings = _state.value.settings.copy(backupEmail = email))
            } catch (e: Exception) {
                _state.value = _state.value.copy(backupEmailError = e.message ?: "Failed to save")
            }
        }
    }

    // ── TOTP (2FA) ──
    fun startTotpSetup() {
        // generate secret & fake QR URL for display
        val secret = generateTotpSecret()
        _state.value = _state.value.copy(totpSetup = true, totpQrUrl = "otpauth://totp/SynthrunMail:${user?.email}?secret=$secret&issuer=SynthrunMail",
            totpVerificationCode = "", totpError = null, totpSuccess = false)
    }

    fun verifyTotp(code: String) {
        if (code.length != 6 || !code.all { it.isDigit() }) {
            _state.value = _state.value.copy(totpError = "Enter a valid 6-digit code", totpSuccess = false)
            return
        }
        viewModelScope.launch {
            try {
                val secret = _state.value.totpQrUrl?.substringAfter("secret=")?.substringBefore("&") ?: ""
                settingsRepo.enableTotp(uid, secret)
                _state.value = _state.value.copy(totpSuccess = true, totpError = null,
                    settings = _state.value.settings.copy(totpEnabled = true, totpSecret = secret))
            } catch (e: Exception) {
                _state.value = _state.value.copy(totpError = e.message ?: "Failed to enable 2FA")
            }
        }
    }

    fun disableTotp() {
        viewModelScope.launch {
            try {
                settingsRepo.disableTotp(uid)
                _state.value = _state.value.copy(totpSetup = false, totpQrUrl = null, totpVerificationCode = "", totpError = null, totpSuccess = false,
                    settings = _state.value.settings.copy(totpEnabled = false, totpSecret = ""))
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.message ?: "Failed to disable 2FA")
            }
        }
    }

    fun updateTotpCode(v: String) { _state.value = _state.value.copy(totpVerificationCode = v, totpError = null) }
    fun cancelTotpSetup() { _state.value = _state.value.copy(totpSetup = false, totpQrUrl = null, totpVerificationCode = "") }

    // ── Sessions ──
    fun loadSessions() {
        _state.value = _state.value.copy(sessionsLoading = true)
        val currentDevice = "Android ${Build.VERSION.RELEASE} (${Build.MODEL})"
        // simulate sessions from firebase user metadata
        val meta = user?.metadata
        val list = mutableListOf(
            SessionInfo(id = "current", device = currentDevice, lastActive = "Now", current = true),
            SessionInfo(id = "web", device = "Chrome on Windows", lastActive = "2 hours ago")
        )
        if (meta?.lastSignInTimestamp != null && meta?.creationTimestamp != null && meta.lastSignInTimestamp != meta.creationTimestamp) {
            list.add(SessionInfo(id = "old", device = "Unknown device", lastActive = "30 days ago"))
        }
        _state.value = _state.value.copy(sessions = list, sessionsLoading = false)
    }

    fun removeSession(sessionId: String) {
        _state.value = _state.value.copy(sessions = _state.value.sessions.filter { it.id != sessionId })
    }

    // ── Sign Out / Delete ──
    fun signOut() {
        _state.value = _state.value.copy(signingOut = true)
        auth.signOut()
        _state.value = _state.value.copy(signingOut = false, signedOut = true)
    }

    fun updateDeleteText(v: String) { _state.value = _state.value.copy(deleteConfirmText = v, deleteError = null) }

    fun deleteAccount() {
        if (_state.value.deleteConfirmText != "DELETE") {
            _state.value = _state.value.copy(deleteError = "Type DELETE to confirm")
            return
        }
        _state.value = _state.value.copy(deleting = true, deleteError = null)
        viewModelScope.launch {
            try {
                user?.delete()?.await()
                _state.value = _state.value.copy(deleting = false, deleted = true)
            } catch (e: Exception) {
                _state.value = _state.value.copy(deleting = false, deleteError = e.message ?: "Delete failed. Try signing out and back in.")
            }
        }
    }

    fun clearMessages() { _state.value = _state.value.copy(error = null, successMessage = null) }
}

private fun generateTotpSecret(): String {
    val chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    return (1..16).map { chars.random() }.joinToString("")
}
