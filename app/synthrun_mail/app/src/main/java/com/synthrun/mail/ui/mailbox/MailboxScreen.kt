package com.synthrun.mail.ui.mailbox

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.synthrun.mail.data.repository.AuthRepo
import com.synthrun.mail.data.repository.MessageRepo
import com.synthrun.mail.ui.common.ShimmerListItem
import com.synthrun.mail.ui.mailbox.components.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MailboxScreen(
    authRepo: AuthRepo,
    messageRepo: MessageRepo,
    folder: String,
    onCompose: () -> Unit,
    onSettings: () -> Unit = {},
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

    var sidebarExpanded by remember { mutableStateOf(true) }
    val isTablet = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 600
    var showDetail by remember { mutableStateOf(false) }
    var showSearch by remember { mutableStateOf(false) }
    val displayDetail = isTablet || showDetail

    fun onSelectMessage(msg: com.synthrun.mail.data.model.Message) {
        viewModel.selectMessage(msg)
        if (!isTablet) showDetail = true
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when (state.currentFolder) {
                            "inbox" -> "Inbox"
                            "unread" -> "Unread"
                            "sent" -> "Sent"
                            "outbox" -> "Outbox"
                            "archived" -> "Archived"
                            "flagged" -> "Flagged"
                            "important" -> "Important"
                            "drafts" -> "Drafts"
                            "trash" -> "Trash"
                            "spam" -> "Spam"
                            "clients" -> "Clients"
                            else -> state.currentFolder.removePrefix("label:").replaceFirstChar { it.uppercase() }
                        }
                    )
                },
                actions = {
                    if (state.selectedIds.isNotEmpty()) {
                        IconButton(onClick = viewModel::clearSelection) {
                            Icon(Icons.Default.Close, contentDescription = "Clear selection")
                        }
                    } else if (showSearch) {
                        TextField(
                            value = state.searchQuery,
                            onValueChange = viewModel::updateSearch,
                            placeholder = { Text("Search...", fontSize = 14.sp) },
                            singleLine = true,
                            colors = TextFieldDefaults.colors(
                                focusedContainerColor = MaterialTheme.colorScheme.surface,
                                unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                                cursorColor = MaterialTheme.colorScheme.primary
                            ),
                            modifier = Modifier.weight(1f),
                            textStyle = MaterialTheme.typography.bodyMedium
                        )
                        IconButton(onClick = { showSearch = false; viewModel.updateSearch("") }) {
                            Icon(Icons.Default.Close, contentDescription = "Close search")
                        }
                    } else {
                        IconButton(onClick = { showSearch = true }) {
                            Icon(Icons.Default.Search, contentDescription = "Search")
                        }
                    }
                    if (!showSearch) {
                        IconButton(onClick = onSettings) {
                            Icon(Icons.Default.Settings, contentDescription = "Settings")
                        }
                        TextButton(onClick = onSignOut) {
                            Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = "Sign out", modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Sign out")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface
                )
            )
        },
        bottomBar = {
            MobileNav(currentFolder = state.currentFolder, onSelect = viewModel::selectFolder, inboxUnread = state.inboxUnread)
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
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            // Bulk action bar
            if (state.selectedIds.isNotEmpty()) {
                BulkActionBar(
                    selectedCount = state.selectedIds.size,
                    onTrash = viewModel::bulkTrash,
                    onArchive = viewModel::bulkArchive,
                    onFlag = viewModel::bulkFlag,
                    onMarkRead = viewModel::bulkMarkRead,
                    onMarkUnread = viewModel::bulkMarkUnread,
                    userLabels = state.userLabels,
                    onApplyLabel = viewModel::bulkApplyLabel
                )
            }

            Row(modifier = Modifier.weight(1f).fillMaxWidth()) {
                val density = LocalDensity.current
                val swipeThreshold = with(density) { 80.dp.toPx() }
                val sidebarWidth: Dp by animateDpAsState(
                    targetValue = if (sidebarExpanded) 220.dp else 52.dp,
                    animationSpec = spring(stiffness = Spring.StiffnessMediumLow, dampingRatio = Spring.DampingRatioMediumBouncy),
                    label = "sidebarWidth"
                )

                // Sidebar — swipe-to-close always tracked, no conditional recomposition
                Box(
                    modifier = Modifier
                        .width(sidebarWidth).fillMaxHeight()
                        .pointerInput(swipeThreshold) {
                            var acc = 0f
                            detectHorizontalDragGestures(
                                onDragEnd = { acc = 0f },
                                onDragCancel = { acc = 0f },
                                onHorizontalDrag = { _, dx ->
                                    if (sidebarExpanded) {
                                        acc += dx; if (acc < -swipeThreshold) { sidebarExpanded = false; acc = 0f }
                                    } else { acc = 0f }
                                }
                            )
                        }
                ) {
                    FolderSidebar(
                        width = sidebarWidth,
                        currentFolder = state.currentFolder,
                        onSelect = { viewModel.selectFolder(it); showDetail = false },
                        expanded = sidebarExpanded,
                        onToggle = { sidebarExpanded = !sidebarExpanded },
                        userLabels = state.userLabels,
                        inboxUnread = state.inboxUnread,
                        inboxTotal = state.inboxTotal,
                        flaggedCount = state.flaggedCount,
                        draftCount = state.draftCount,
                        trashCount = state.trashCount,
                        outboxCount = state.outboxCount,
                        spamCount = state.spamCount,
                        archivedCount = state.archivedCount,
                        sentCount = state.sentCount
                    )
                }

                // Hot zone (24dp) to swipe-to-open when collapsed
                if (!sidebarExpanded) {
                    Box(
                        modifier = Modifier
                            .width(24.dp).fillMaxHeight()
                            .pointerInput(swipeThreshold) {
                                var acc = 0f
                                detectHorizontalDragGestures(
                                    onDragEnd = { acc = 0f },
                                    onDragCancel = { acc = 0f },
                                    onHorizontalDrag = { _, dx -> acc += dx; if (acc > swipeThreshold) { sidebarExpanded = true; acc = 0f } }
                                )
                            }
                    )
                }

                // Main content — tap anywhere closes sidebar (non-consuming observer, always present)
                Column(
                    modifier = Modifier
                        .weight(1f).fillMaxHeight()
                        .pointerInput(Unit) {
                            awaitPointerEventScope { while (true) { awaitPointerEvent(); if (sidebarExpanded) sidebarExpanded = false } }
                        }
                ) {
                if (state.filteredMessages.isEmpty()) {
                    if (state.loading) {
                        Column(Modifier.weight(1f).fillMaxHeight()) {
                            repeat(12) { ShimmerListItem() }
                        }
                    } else {
                        Box(modifier = Modifier.weight(1f).fillMaxWidth().fillMaxHeight(), contentAlignment = Alignment.Center) {
                            Text(
                                "No messages",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                            )
                        }
                    }
                } else {
                    // On phone: show list or detail, not both
                    if (!displayDetail || isTablet) {
                        ThreadList(
                            modifier = if (isTablet) Modifier.weight(0.4f) else Modifier.weight(1f),
                            messages = state.filteredMessages,
                            selectedId = state.selectedMessage?.id,
                            selectedIds = state.selectedIds,
                            userLabels = state.userLabels,
                            onSelect = { msg ->
                                if (state.selectedIds.isNotEmpty()) {
                                    viewModel.toggleSelected(msg.id)
                                } else {
                                    onSelectMessage(msg)
                                }
                            },
                            onLongClick = { viewModel.toggleSelected(it.id) }
                        )
                    }

                    if (displayDetail && state.selectedMessage != null) {
                        MessageDetail(
                            modifier = if (isTablet) Modifier.weight(0.6f) else Modifier.weight(1f),
                            message = state.selectedMessage,
                            userLabels = state.userLabels,
                            onBack = { if (!isTablet) showDetail = false },
                            onArchive = { state.selectedMessage?.let { viewModel.archiveMessage(it.id) } },
                            onTrash = { state.selectedMessage?.let { viewModel.trashMessage(it.id); if (!isTablet) showDetail = false } },
                            onFlag = { state.selectedMessage?.let { viewModel.toggleFlag(it.id, !it.flagged) } },
                            onImportant = { state.selectedMessage?.let { viewModel.toggleImportant(it.id, !it.important) } },
                            onMarkUnread = { state.selectedMessage?.let { msg -> if (msg.unread) viewModel.markRead(msg.id) else viewModel.markUnread(msg.id) } },
                            onDeleteForever = { state.selectedMessage?.let { viewModel.deleteForever(it.id) } },
                            onRestore = { state.selectedMessage?.let { viewModel.restoreFromTrash(it.id) } },
                            onMarkNotSpam = { state.selectedMessage?.let { viewModel.markAsNotSpam(it.id) } },
                            onRetry = { state.selectedMessage?.let { viewModel.retryOutbox(it.id) } },
                            onToggleLabel = { labelName ->
                                state.selectedMessage?.let { viewModel.toggleMessageLabel(it.id, labelName) }
                            }
                        )
                    }
                }
                }  // end main content Column
            }
        }
    }
}
