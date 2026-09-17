package com.synthrun.mail.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onBack: () -> Unit,
    onSignedOut: () -> Unit
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(state.signedOut) { if (state.signedOut) onSignedOut() }
    LaunchedEffect(state.deleted) { if (state.deleted) onSignedOut() }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Settings") }, navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            })
        }
        ) { p ->
            Column(modifier = Modifier.fillMaxSize().padding(p).verticalScroll(rememberScrollState()).padding(16.dp)) {
                if (state.loading) {
                    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                    return@Scaffold
                }

                if (state.error != null) {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                        Text(state.error!!, modifier = Modifier.padding(16.dp), fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
                    }
                    Spacer(Modifier.height(8.dp))
                }

                // Show content even if error — uses cached/default settings
                SectionHeader("Profile")
                ProfileCard()
            Spacer(Modifier.height(16.dp))

            SectionHeader("Preferences")
            PreferenceGroup(state, viewModel)
            Spacer(Modifier.height(16.dp))

            SectionHeader("Security")
            SecurityGroup(state, viewModel)
            Spacer(Modifier.height(16.dp))

            SectionHeader("Active Sessions")
            SessionsGroup(state, viewModel)
            Spacer(Modifier.height(16.dp))

            SectionHeader("Danger Zone")
            DangerGroup(state, viewModel)

            Spacer(Modifier.height(32.dp))
        }
    }
}

// ── Components ──

@Composable
private fun SectionHeader(title: String) {
    Text(title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(bottom = 8.dp))
}

@Composable
private fun ProfileCard() {
    val auth = com.google.firebase.auth.FirebaseAuth.getInstance()
    val u = auth.currentUser
    val email = u?.email ?: ""
    val name = u?.displayName ?: email.substringBefore("@").replaceFirstChar { it.uppercase() }
    val initial = name.first().uppercaseChar()
    val avatarColors = listOf(Color(0xFF6366F1), Color(0xFF8B5CF6), Color(0xFF3B82F6), Color(0xFF06B6D4), Color(0xFF10B981))
    val avatarColor = avatarColors[Math.abs(name.hashCode()) % avatarColors.size]

    Card(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(56.dp).clip(CircleShape).background(avatarColor),
                contentAlignment = Alignment.Center
            ) {
                Text(initial.toString(), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 22.sp, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.width(16.dp))
            Column {
                Text(name, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                Text(email, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                Spacer(Modifier.height(4.dp))
                Text(
                    if (u?.isEmailVerified == true) "Email verified" else "Email not verified",
                    fontSize = 11.sp,
                    color = if (u?.isEmailVerified == true) Color(0xFF10B981) else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)
                )
            }
        }
    }
}

@Composable
private fun PreferenceGroup(state: SettingsState, vm: SettingsViewModel) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Theme
            Text("Theme", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
                mapOf("system" to "System", "light" to "Light", "dark" to "Dark").forEach { (k, v) ->
                    FilterChip(selected = state.settings.theme == k, onClick = { vm.setTheme(k) }, label = { Text(v, fontSize = 12.sp) })
                }
            }
            Spacer(Modifier.height(12.dp))

            // Layout
            Text("Layout", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
                mapOf("synthrun" to "Synthrun", "gmail" to "Gmail", "outlook" to "Outlook").forEach { (k, v) ->
                    FilterChip(selected = state.settings.layout == k, onClick = { vm.setLayout(k) }, label = { Text(v, fontSize = 12.sp) })
                }
            }
            Spacer(Modifier.height(12.dp))

            // Density
            Text("Density", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
                mapOf("compact" to "Compact", "comfortable" to "Comfortable", "spacious" to "Spacious").forEach { (k, v) ->
                    FilterChip(selected = state.settings.density == k, onClick = { vm.setDensity(k) }, label = { Text(v, fontSize = 12.sp) })
                }
            }
        }
    }
}

@Composable
private fun SecurityGroup(state: SettingsState, vm: SettingsViewModel) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            // ── Password ──
            Text("Change Password", fontWeight = FontWeight.Medium, fontSize = 14.sp)
            Spacer(Modifier.height(8.dp))

            OutlinedTextField(value = state.currentPassword, onValueChange = vm::updateCurrentPassword,
                label = { Text("Current password") }, visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(), singleLine = true)
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(value = state.newPassword, onValueChange = vm::updateNewPassword,
                label = { Text("New password") }, visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(), singleLine = true)
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(value = state.confirmPassword, onValueChange = vm::updateConfirmPassword,
                label = { Text("Confirm new password") }, visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(), singleLine = true)
            Spacer(Modifier.height(8.dp))
            if (state.passwordError != null) { Text(state.passwordError!!, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
            if (state.passwordSuccess) { Text("Password changed successfully", color = MaterialTheme.colorScheme.primary, fontSize = 12.sp) }
            Button(onClick = vm::changePassword, modifier = Modifier.align(Alignment.End)) { Text("Change Password") }

            HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))

            // ── Backup Email ──
            Text("Backup Email", fontWeight = FontWeight.Medium, fontSize = 14.sp)
            Spacer(Modifier.height(4.dp))
            Text("A backup email can be used for account recovery.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(value = state.backupEmail, onValueChange = vm::updateBackupEmail,
                label = { Text("Backup email") }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
            if (state.backupEmailError != null) { Text(state.backupEmailError!!, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
            if (state.backupEmailSuccess) { Text("Backup email saved", color = MaterialTheme.colorScheme.primary, fontSize = 12.sp) }
            Button(onClick = vm::saveBackupEmail, modifier = Modifier.align(Alignment.End)) { Text("Save") }

            HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))

            // ── 2FA / TOTP ──
            Text("Two-Factor Authentication (2FA)", fontWeight = FontWeight.Medium, fontSize = 14.sp)
            Spacer(Modifier.height(4.dp))
            if (state.settings.totpEnabled) {
                Text("2FA is enabled", color = MaterialTheme.colorScheme.primary, fontSize = 13.sp)
                Spacer(Modifier.height(6.dp))
                OutlinedButton(onClick = vm::disableTotp, colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                    Text("Disable 2FA")
                }
            } else if (state.totpSetup) {
                Text("Scan with your authenticator app:", fontSize = 12.sp)
                Spacer(Modifier.height(4.dp))
                Card(modifier = Modifier.fillMaxWidth().heightIn(max = 140.dp)) {
                    Text(state.totpQrUrl ?: "", modifier = Modifier.padding(12.dp), fontSize = 9.sp, lineHeight = 13.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                }
                Spacer(Modifier.height(6.dp))
                OutlinedTextField(value = state.totpVerificationCode, onValueChange = vm::updateTotpCode,
                    label = { Text("Verification code") }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                if (state.totpError != null) { Text(state.totpError!!, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
                if (state.totpSuccess) { Text("2FA enabled successfully", color = MaterialTheme.colorScheme.primary, fontSize = 12.sp) }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedButton(onClick = vm::cancelTotpSetup) { Text("Cancel") }
                    Button(onClick = { vm.verifyTotp(state.totpVerificationCode) }) { Text("Verify & Enable") }
                }
            } else {
                Text("2FA is disabled", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                Spacer(Modifier.height(6.dp))
                OutlinedButton(onClick = vm::startTotpSetup) {
                    Icon(Icons.Default.Lock, "2fa", modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Set up 2FA")
                }
            }
        }
    }
}

@Composable
private fun SessionsGroup(state: SettingsState, vm: SettingsViewModel) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            if (state.sessionsLoading) {
                Box(Modifier.fillMaxWidth().height(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            } else if (state.sessions.isEmpty()) {
                TextButton(onClick = vm::loadSessions) { Text("Load sessions") }
            } else {
                state.sessions.forEach { s ->
                    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Devices, "device", modifier = Modifier.size(20.dp), tint = if (s.current) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text(s.device, fontSize = 13.sp, fontWeight = if (s.current) FontWeight.Medium else FontWeight.Normal)
                            Text("Active ${s.lastActive}", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f))
                        }
                        if (s.current) {
                            Text("Current", fontSize = 11.sp, color = MaterialTheme.colorScheme.primary)
                        } else {
                            TextButton(onClick = { vm.removeSession(s.id) }) { Text("Remove", fontSize = 12.sp) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DangerGroup(state: SettingsState, vm: SettingsViewModel) {
    Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f))) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Delete Account", fontWeight = FontWeight.Medium, fontSize = 14.sp, color = MaterialTheme.colorScheme.error)
            Spacer(Modifier.height(4.dp))
            Text("Permanently delete your account and all data. This cannot be undone.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))

            if (!state.deleting) {
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = state.deleteConfirmText, onValueChange = vm::updateDeleteText,
                    label = { Text("Type DELETE to confirm") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                if (state.deleteError != null) { Text(state.deleteError!!, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
                Spacer(Modifier.height(8.dp))

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = vm::signOut) { Text("Sign Out") }
                    Button(onClick = vm::deleteAccount, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) {
                        Text("Delete Account")
                    }
                }
            } else {
                CircularProgressIndicator(modifier = Modifier.padding(16.dp).size(24.dp))
            }
        }
    }
}
