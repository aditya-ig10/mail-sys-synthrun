package com.synthrun.mail.navigation

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.synthrun.mail.data.repository.AuthRepo
import com.synthrun.mail.data.repository.MessageRepo
import com.synthrun.mail.data.repository.AttachmentRepo
import com.synthrun.mail.data.repository.ContactRepo
import com.synthrun.mail.data.repository.SettingsRepo
import com.synthrun.mail.ui.auth.LoginScreen
import com.synthrun.mail.ui.mailbox.MailboxScreen
import com.synthrun.mail.ui.compose.ComposeScreen
import com.synthrun.mail.ui.settings.SettingsScreen
import com.synthrun.mail.ui.settings.SettingsViewModel

// ── App navigation routes ──
object Routes {
    const val LOGIN = "login"
    const val MAILBOX = "mailbox/{folder}?messageId={messageId}"
    const val COMPOSE = "compose?to={to}&subject={subject}"
    const val SETTINGS = "settings"

    fun mailbox(folder: String = "inbox") = "mailbox/$folder"
    fun compose(to: String = "", subject: String = "") = "compose?to=$to&subject=$subject"
    fun settings() = "settings"
}

@Composable
fun NavGraph(navController: NavHostController) {
    // ── Shared instances (manual DI) ──
    val context = LocalContext.current
    val authRepo = AuthRepo()
    val messageRepo = MessageRepo()
    val attachmentRepo = AttachmentRepo()
    val settingsRepo = SettingsRepo(context)
    val contactRepo = ContactRepo(context)

    // ── Start at login or mailbox ──
    val start = if (authRepo.isSignedIn()) Routes.mailbox() else Routes.LOGIN

    NavHost(navController, startDestination = start) {
        composable(Routes.LOGIN) {
            LoginScreen(
                authRepo = authRepo,
                onLoggedIn = { navController.navigate(Routes.mailbox()) { popUpTo(0) } }
            )
        }
        composable(Routes.MAILBOX) { backStackEntry ->
            val folder = backStackEntry.arguments?.getString("folder") ?: "inbox"
            MailboxScreen(
                authRepo = authRepo,
                messageRepo = messageRepo,
                folder = folder,
                onCompose = { navController.navigate(Routes.compose()) },
                onSettings = { navController.navigate(Routes.settings()) },
                onSignOut = { authRepo.signOut(); navController.navigate(Routes.LOGIN) { popUpTo(0) } }
            )
        }
        composable(Routes.COMPOSE) { backStackEntry ->
            val to = backStackEntry.arguments?.getString("to") ?: ""
            val subject = backStackEntry.arguments?.getString("subject") ?: ""
            ComposeScreen(
                authRepo = authRepo,
                messageRepo = messageRepo,
                attachmentRepo = attachmentRepo,
                contactRepo = contactRepo,
                prefillTo = to,
                prefillSubject = subject,
                onSent = { navController.popBackStack() },
                onDismiss = { navController.popBackStack() }
            )
        }
        composable(Routes.SETTINGS) {
            val vm = remember { SettingsViewModel(settingsRepo, authRepo) }
            SettingsScreen(
                viewModel = vm,
                onBack = { navController.popBackStack() },
                onSignedOut = { navController.navigate(Routes.LOGIN) { popUpTo(0) } }
            )
        }
    }
}