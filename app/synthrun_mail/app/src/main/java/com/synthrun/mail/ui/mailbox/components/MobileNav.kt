package com.synthrun.mail.ui.mailbox.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector

private val navItems = listOf(
    "inbox" to Icons.Default.MailOutline,
    "unread" to Icons.Default.Email,
    "sent" to Icons.AutoMirrored.Filled.Send,
    "flagged" to Icons.Default.Star,
    "clients" to Icons.Default.Person
)

@Composable
fun MobileNav(currentFolder: String, onSelect: (String) -> Unit) {
    NavigationBar {
        navItems.forEach { (folder, icon) ->
            NavigationBarItem(
                selected = folder == currentFolder,
                onClick = { onSelect(folder) },
                label = { Text(folder.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelSmall) },
                icon = {
                    Icon(
                        imageVector = icon,
                        contentDescription = folder
                    )
                }
            )
        }
    }
}
