package com.synthrun.mail.ui.mailbox.components

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.synthrun.mail.data.model.UserLabel

@Composable
fun BulkActionBar(
    selectedCount: Int,
    onTrash: () -> Unit,
    onArchive: () -> Unit,
    onFlag: () -> Unit,
    onMarkRead: () -> Unit,
    onMarkUnread: () -> Unit,
    userLabels: List<UserLabel> = emptyList(),
    onApplyLabel: (String) -> Unit = {}
) {
    var showLabelPicker by remember { mutableStateOf(false) }

    Surface(
        tonalElevation = 2.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column {
            Row(
                modifier = Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("$selectedCount selected", fontSize = 12.sp, modifier = Modifier.padding(end = 8.dp))
                BulkChip(icon = Icons.Default.Delete, label = "Trash", onClick = onTrash)
                BulkChip(icon = Icons.Default.Archive, label = "Archive", onClick = onArchive)
                BulkChip(icon = Icons.Default.Star, label = "Flag", onClick = onFlag)
                BulkChip(icon = Icons.Default.Markunread, label = "Read", onClick = onMarkRead)
                BulkChip(icon = Icons.Default.Markunread, label = "Unread", onClick = onMarkUnread)
                BulkChip(icon = Icons.Default.BookmarkBorder, label = "Label", onClick = { showLabelPicker = !showLabelPicker })
            }
            if (showLabelPicker && userLabels.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .horizontalScroll(rememberScrollState())
                        .padding(start = 8.dp, end = 8.dp, bottom = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    userLabels.forEach { label ->
                        FilterChip(
                            selected = false,
                            onClick = { onApplyLabel(label.name); showLabelPicker = false },
                            label = { Text(label.name, fontSize = 10.sp) },
                            modifier = Modifier.height(28.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun BulkChip(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.padding(end = 4.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(3.dp))
            Text(label, fontSize = 10.sp)
        }
    }
}
