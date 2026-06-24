package com.synthrun.mail.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.synthrun.mail.data.repository.AuthRepo

// ── Sign-in screen (matches web login page) ──
@Composable
fun LoginScreen(
    authRepo: AuthRepo,
    onLoggedIn: () -> Unit
) {
    val viewModel: LoginViewModel = viewModel(factory = object : androidx.lifecycle.ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T = LoginViewModel(authRepo) as T
    })
    val state by viewModel.state.collectAsState()

    // ── Navigate on success ──
    LaunchedEffect(state.isLoggedIn) { if (state.isLoggedIn) onLoggedIn() }

    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .widthIn(max = 400.dp)
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text("Synthrun Mail", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(24.dp))

            OutlinedTextField(value = state.email, onValueChange = viewModel::updateEmail, label = { Text("Email") })
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = state.password, onValueChange = viewModel::updatePassword, label = { Text("Password") }, visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation())
            Spacer(Modifier.height(16.dp))

            Button(onClick = viewModel::signIn, enabled = !state.isLoading, modifier = Modifier.fillMaxWidth()) {
                if (state.isLoading) CircularProgressIndicator(modifier = Modifier.size(20.dp))
                else Text("Sign In")
            }
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}