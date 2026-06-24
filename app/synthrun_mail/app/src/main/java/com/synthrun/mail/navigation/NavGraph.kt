package com.synthrun.mail.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.synthrun.mail.data.repository.AuthRepo
import com.synthrun.mail.data.repository.MessageRepo
import com.synthrun.mail.data.repository.AttachmentRepo
import com.synthrun.mail.ui.auth.LoginScreen
import com.synthrun.mail.ui.mailbox.MailboxScreen
import com.synthrun.mail.ui.compose.ComposeScreen

// ── App navigation routes ──
object Routes {
    const val LOGIN = "login"
    const val MAILBOX = "mailbox/{folder}?messageId={messageId}"
    const val COMPOSE = "compose?to={to}&subject={subject}"

    fun mailbox(folder: String = "inbox") = "mailbox/$folder"
    fun compose(to: String = "", subject: String = "") = "compose?to=$to&subject=$subject"
}

@Composable
fun NavGraph(navController: NavHostController) {
    // ── Shared instances (manual DI) ──
    val authRepo = AuthRepo()
    val messageRepo = MessageRepo()
    val attachmentRepo = AttachmentRepo()

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
                prefillTo = to,
                prefillSubject = subject,
                onSent = { navController.popBackStack() },
                onDismiss = { navController.popBackStack() }
            )
        }
    }
}