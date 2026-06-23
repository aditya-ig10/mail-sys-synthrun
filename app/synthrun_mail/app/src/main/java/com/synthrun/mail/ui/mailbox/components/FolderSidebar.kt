package com.synthrun.mail.ui.mailbox.components

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.window.Popup
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val folderIcons: Map<String, ImageVector> = mapOf(
    "inbox" to Icons.Default.MailOutline,
    "unread" to Icons.Default.Email,
    "sent" to Icons.AutoMirrored.Filled.Send,
    "outbox" to Icons.AutoMirrored.Filled.Send,
    "archived" to Icons.Default.Check,
    "flagged" to Icons.Default.Star,
    "important" to Icons.Default.Info,
    "drafts" to Icons.Default.Edit,
    "trash" to Icons.Default.Delete,
    "spam" to Icons.Default.Warning,
    "clients" to Icons.Default.Person
)

private data class FolderGroup(val label: String, val folders: List<String>)

private val folderGroups = listOf(
    FolderGroup("Inbox", listOf("inbox", "unread", "sent", "outbox")),
    FolderGroup("Labels", listOf("archived", "flagged", "clients", "spam")),
    FolderGroup("Tags", listOf("important", "drafts")),
    FolderGroup("", listOf("trash"))
)

@Composable
fun FolderSidebar(
    currentFolder: String,
    onSelect: (String) -> Unit,
    expanded: Boolean,
    onToggle: () -> Unit
) {
    val width = if (expanded) 200.dp else 52.dp

    Surface(
        modifier = Modifier.width(width).fillMaxHeight(),
        color = MaterialTheme.colorScheme.surfaceVariant
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            item {
                Spacer(Modifier.height(8.dp))
                IconButton(
                    onClick = onToggle,
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        imageVector = if (expanded) Icons.AutoMirrored.Filled.KeyboardArrowLeft else Icons.Default.Menu,
                        contentDescription = if (expanded) "Collapse" else "Expand",
                        tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                        modifier = Modifier.size(20.dp)
                    )
                }
                Spacer(Modifier.height(4.dp))
            }

            folderGroups.forEach { group ->
                if (group.label.isNotEmpty() && expanded) {
                    item {
                        Text(
                            group.label,
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(start = 16.dp, top = 8.dp, bottom = 2.dp),
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
                        )
                    }
                }

                items(group.folders) { folder ->
                    val selected = folder == currentFolder
                    val icon = folderIcons[folder] ?: Icons.Default.MailOutline
                    var showTooltip by remember { mutableStateOf(false) }
                    val scope = rememberCoroutineScope()
                    val density = LocalDensity.current
                    val offsetX = with(density) { 56.dp.roundToPx() }

                    Box {
                        Surface(
                            modifier = Modifier
                                .padding(horizontal = if (expanded) 8.dp else 6.dp, vertical = 1.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .then(
                                    if (expanded) {
                                        Modifier.fillMaxWidth().combinedClickable(
                                            onClick = { onSelect(folder) },
                                            onLongClick = null
                                        )
                                    } else {
                                        Modifier.combinedClickable(
                                            onClick = { onSelect(folder) },
                                            onLongClick = {
                                                showTooltip = true
                                                scope.launch {
                                                    delay(1800)
                                                    showTooltip = false
                                                }
                                            }
                                        )
                                    }
                                ),
                            color = if (selected) MaterialTheme.colorScheme.surface
                            else MaterialTheme.colorScheme.surfaceVariant
                        ) {
                            Row(
                                modifier = Modifier
                                    .then(
                                        if (expanded) Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                                        else Modifier.padding(6.dp)
                                    )
                                    .fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = icon,
                                    contentDescription = folder,
                                    tint = if (selected) MaterialTheme.colorScheme.onSurface
                                    else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                                    modifier = Modifier.size(if (expanded) 18.dp else 20.dp)
                                )
                                if (expanded) {
                                    Spacer(Modifier.width(12.dp))
                                    Text(
                                        text = folder.replaceFirstChar { it.uppercase() },
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                                        color = if (selected) MaterialTheme.colorScheme.onSurface
                                        else MaterialTheme.colorScheme.onSurface
                                    )
                                }
                            }
                        }

                        if (showTooltip && !expanded) {
                            Popup(
                                alignment = Alignment.CenterStart,
                                offset = IntOffset(offsetX, 0),
                                onDismissRequest = { showTooltip = false }
                            ) {
                                Surface(
                                    shape = RoundedCornerShape(6.dp),
                                    color = MaterialTheme.colorScheme.inverseSurface,
                                    shadowElevation = 6.dp
                                ) {
                                    Text(
                                        text = folder.replaceFirstChar { it.uppercase() },
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                        color = MaterialTheme.colorScheme.inverseOnSurface,
                                        fontSize = 13.sp
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
