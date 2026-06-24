package com.synthrun.mail.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synthrun.mail.data.repository.AuthRepo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

// ── Holds login form state ──
data class LoginState(
    val email: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val isLoggedIn: Boolean = false
)

class LoginViewModel(private val authRepo: AuthRepo) : ViewModel() {
    private val _state = MutableStateFlow(LoginState())
    val state: StateFlow<LoginState> = _state.asStateFlow()

    fun updateEmail(email: String) { _state.value = _state.value.copy(email = email) }
    fun updatePassword(pass: String) { _state.value = _state.value.copy(password = pass) }

    fun signIn() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            val result = runCatching {
                authRepo.signIn(_state.value.email, _state.value.password)
            }
            result.fold(
                onSuccess = { _state.value = _state.value.copy(isLoading = false, isLoggedIn = true) },
                onFailure = { _state.value = _state.value.copy(isLoading = false, error = it.message) }
            )
        }
    }
}