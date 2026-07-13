package com.synthrun.mail.ui.mailbox.components

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import com.synthrun.mail.data.model.UserLabel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val folderIcons: Map<String, ImageVector> = mapOf(
    "inbox" to Icons.Default.MailOutline,
    "unread" to Icons.Default.Email,
    "sent" to Icons.AutoMirrored.Filled.Send,
    "outbox" to Icons.Default.Outbox,
    "archived" to Icons.Default.Check,
    "flagged" to Icons.Default.Star,
    "important" to Icons.Default.Info,
    "drafts" to Icons.Default.Edit,
    "trash" to Icons.Default.Delete,
    "spam" to Icons.Default.Warning,
    "clients" to Icons.Default.Person
)

private val staticFolders = listOf("inbox", "unread", "sent", "outbox", "archived", "flagged", "clients", "spam", "important", "drafts", "trash")

@Composable
fun FolderSidebar(
    width: Dp,
    currentFolder: String,
    onSelect: (String) -> Unit,
    expanded: Boolean,
    onToggle: () -> Unit,
    userLabels: List<UserLabel> = emptyList(),
    inboxUnread: Int = 0,
    inboxTotal: Int = 0,
    flaggedCount: Int = 0,
    draftCount: Int = 0,
    trashCount: Int = 0,
    outboxCount: Int = 0,
    spamCount: Int = 0,
    archivedCount: Int = 0,
    sentCount: Int = 0
) {
    val density = LocalDensity.current
    val offsetX = with(density) { 56.dp.roundToPx() }

    Surface(
        modifier = Modifier.width(width).fillMaxHeight(),
        color = MaterialTheme.colorScheme.surfaceVariant
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(vertical = 8.dp)
        ) {
            item {
                Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
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
                }
                Spacer(Modifier.height(4.dp))
            }

            // Static folders with counts
            items(staticFolders) { folder ->
                val selected = folder == currentFolder
                val icon = folderIcons[folder] ?: Icons.Default.MailOutline
                val count = when (folder) {
                    "inbox" -> inboxTotal
                    "unread" -> inboxUnread
                    "drafts" -> draftCount
                    "trash" -> trashCount
                    "outbox" -> outboxCount
                    "spam" -> spamCount
                    "archived" -> archivedCount
                    "sent" -> sentCount
                    "flagged" -> flaggedCount
                    else -> 0
                }
                var showTooltip by remember { mutableStateOf(false) }
                val scope = rememberCoroutineScope()

                FolderItem(
                    icon = icon,
                    label = folder.replaceFirstChar { it.uppercase() },
                    count = count,
                    selected = selected,
                    expanded = expanded,
                    onClick = { onSelect(folder) },
                    onLongClick = {
                        if (!expanded) {
                            showTooltip = true
                            scope.launch { delay(1800); showTooltip = false }
                        }
                    },
                    tooltipExpanded = showTooltip,
                    onDismissTooltip = { showTooltip = false },
                    offsetX = offsetX
                )
            }

            // Custom labels section
            if (expanded && userLabels.isNotEmpty()) {
                item {
                    Text(
                        "Labels",
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp),
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f),
                        fontSize = 10.sp
                    )
                }
                items(userLabels) { label ->
                    val folderKey = "label:${label.name}"
                    val labelSelected = folderKey == currentFolder
                    FolderItem(
                        icon = Icons.Default.BookmarkBorder,
                        label = label.name,
                        count = 0,
                        selected = labelSelected,
                        expanded = true,
                        onClick = { onSelect(folderKey) },
                        onLongClick = {},
                        labelColor = parseColor(label.color),
                        tooltipExpanded = false,
                        onDismissTooltip = {},
                        offsetX = 0
                    )
                }
            }
        }
    }
}

@Composable
private fun FolderItem(
    icon: ImageVector,
    label: String,
    count: Int,
    selected: Boolean,
    expanded: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    labelColor: Color? = null,
    tooltipExpanded: Boolean,
    onDismissTooltip: () -> Unit,
    offsetX: Int
) {
    Box {
        Surface(
            modifier = Modifier
                .padding(horizontal = if (expanded) 8.dp else 6.dp, vertical = 1.dp)
                .clip(RoundedCornerShape(6.dp))
                .then(
                    if (expanded) Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = null)
                    else Modifier.combinedClickable(onClick = onClick, onLongClick = onLongClick)
                ),
            color = if (selected) MaterialTheme.colorScheme.surface
            else MaterialTheme.colorScheme.surfaceVariant
        ) {
            Row(
                modifier = Modifier
                    .then(if (expanded) Modifier.padding(horizontal = 12.dp, vertical = 8.dp) else Modifier.padding(6.dp))
                    .fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = label,
                    tint = labelColor ?: if (selected) MaterialTheme.colorScheme.onSurface
                    else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    modifier = Modifier.size(if (expanded) 18.dp else 20.dp)
                )
                if (expanded) {
                    Spacer(Modifier.width(10.dp))
                    Text(
                        text = label,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                        color = if (labelColor != null) labelColor else MaterialTheme.colorScheme.onSurface
                    )
                    if (count > 0) {
                        Box(
                            modifier = Modifier
                                .clip(CircleShape)
                                .padding(start = 4.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = count.toString(),
                                style = MaterialTheme.typography.labelSmall,
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                            )
                        }
                    }
                }
            }
        }

        if (tooltipExpanded && !expanded) {
            Popup(
                alignment = Alignment.CenterStart,
                offset = IntOffset(offsetX, 0),
                onDismissRequest = onDismissTooltip
            ) {
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = MaterialTheme.colorScheme.inverseSurface,
                    shadowElevation = 6.dp
                ) {
                    Text(
                        text = label,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        color = MaterialTheme.colorScheme.inverseOnSurface,
                        fontSize = 13.sp
                    )
                }
            }
        }
    }
}

private fun parseColor(hex: String): Color {
    return try {
        Color(android.graphics.Color.parseColor(hex))
    } catch (_: Exception) {
        Color.Gray
    }
}
