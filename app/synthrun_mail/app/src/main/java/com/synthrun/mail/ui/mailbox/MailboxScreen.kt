package com.synthrun.mail.ui.mailbox

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.synthrun.mail.data.repository.AuthRepo
import com.synthrun.mail.data.repository.MessageRepo
import com.synthrun.mail.ui.mailbox.components.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MailboxScreen(
    authRepo: AuthRepo,
    messageRepo: MessageRepo,
    folder: String,
    onCompose: () -> Unit,
    onSignOut: () -> Unit
) {
    val viewModel: MailboxViewModel = viewModel(
        factory = object : androidx.lifecycle.ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T =
                MailboxViewModel(authRepo, messageRepo) as T
        }
    )
    val state by viewModel.state.collectAsState()
    LaunchedEffect(folder) { viewModel.selectFolder(folder) }

    var sidebarExpanded by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Synthrun Mail") },
                actions = {
                    TextButton(onClick = onSignOut) {
                        Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = "Sign out", modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Sign out")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface
                )
            )
        },
        bottomBar = {
            MobileNav(currentFolder = state.currentFolder, onSelect = viewModel::selectFolder)
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onCompose,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier.size(48.dp)
            ) {
                Icon(Icons.Default.Edit, contentDescription = "Compose", modifier = Modifier.size(22.dp))
            }
        }
    ) { padding ->
        Row(modifier = Modifier.fillMaxSize().padding(padding)) {
            FolderSidebar(
                currentFolder = state.currentFolder,
                onSelect = viewModel::selectFolder,
                expanded = sidebarExpanded,
                onToggle = { sidebarExpanded = !sidebarExpanded }
            )

            if (state.filteredMessages.isEmpty()) {
                Box(modifier = Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                    Text(
                        "No messages",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                    )
                }
            } else {
                ThreadList(
                    modifier = Modifier.weight(1f),
                    messages = state.filteredMessages,
                    selectedId = state.selectedMessage?.id,
                    onSelect = viewModel::selectMessage
                )
                MessageDetail(
                    modifier = Modifier.weight(1f),
                    message = state.selectedMessage,
                    onArchive = { state.selectedMessage?.let { viewModel.archiveMessage(it.id) } },
                    onTrash = { state.selectedMessage?.let { viewModel.trashMessage(it.id) } },
                    onFlag = { state.selectedMessage?.let { viewModel.toggleFlag(it.id, !it.flagged) } },
                    onImportant = { state.selectedMessage?.let { viewModel.toggleImportant(it.id, !it.important) } }
                )
            }
        }
    }
}
