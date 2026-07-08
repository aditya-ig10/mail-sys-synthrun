package com.synthrun.mail.ui.mailbox.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.remember
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.synthrun.mail.data.model.Message
import com.synthrun.mail.data.model.UserLabel
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun ThreadItem(
    message: Message,
    isSelected: Boolean,
    userLabels: List<UserLabel> = emptyList(),
    onClick: () -> Unit = {},
    onLongClick: () -> Unit = {}
) {
    val bg = when {
        isSelected -> MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
        message.unread && message.folder !in setOf("sent", "draft", "trash", "outbox", "spam") ->
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        else -> MaterialTheme.colorScheme.surface
    }

    val firstLabel = message.labels.firstOrNull()
    val labelColor = firstLabel?.let { name ->
        userLabels.find { it.name == name }?.color
    }

    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        color = bg
    ) {
        Row(
            modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.Top
        ) {
            // Label color strip
            if (labelColor != null) {
                val c = try { Color(android.graphics.Color.parseColor(labelColor)) } catch (_: Exception) { Color.Transparent }
                Box(
                    modifier = Modifier
                        .width(3.dp)
                        .height(36.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(c)
                )
                Spacer(Modifier.width(8.dp))
            }

            // Avatar
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.15f),
                modifier = Modifier.size(32.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        (message.fromName.ifEmpty { message.from }).take(2).uppercase(),
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
            Spacer(Modifier.width(10.dp))

            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        message.fromName.ifEmpty { message.from },
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = if (message.unread) FontWeight.SemiBold else FontWeight.Normal,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    message.receivedAt?.let {
                        val sdf = remember { SimpleDateFormat("MMM d", Locale.getDefault()) }
                        Text(sdf.format(it.toDate()), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                    }
                }
                Spacer(Modifier.height(2.dp))
                Text(
                    message.subject.ifEmpty { "(no subject)" },
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (message.unread) FontWeight.Medium else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        message.body.take(80),
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                        modifier = Modifier.weight(1f)
                    )
                    // Status badge for outbox
                    if (message.folder == "outbox") {
                        val badgeColor = when (message.status) {
                            "failed" -> MaterialTheme.colorScheme.error
                            "sending" -> MaterialTheme.colorScheme.tertiary
                            else -> MaterialTheme.colorScheme.outline
                        }
                        Surface(
                            shape = RoundedCornerShape(4.dp),
                            color = badgeColor.copy(alpha = 0.15f),
                            modifier = Modifier.padding(start = 4.dp)
                        ) {
                            Text(
                                when (message.status) {
                                    "sending" -> "Sending..."
                                    "failed" -> "Failed"
                                    else -> "Pending"
                                },
                                fontSize = 8.sp,
                                color = badgeColor,
                                modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp)
                            )
                        }
                    }
                    // Attachment indicator
                    if (message.attachments.isNotEmpty()) {
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.Default.AttachFile, contentDescription = null, modifier = Modifier.size(12.dp), tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f))
                    }
                }
                // Label chips
                if (message.labels.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        message.labels.take(3).forEach { labelName ->
                            val lbl = userLabels.find { it.name == labelName }
                            val chipColor = try { Color(android.graphics.Color.parseColor(lbl?.color ?: "#888")) } catch (_: Exception) { Color.Gray }
                            Surface(
                                shape = RoundedCornerShape(4.dp),
                                color = chipColor.copy(alpha = 0.15f)
                            ) {
                                Text(labelName, fontSize = 8.sp, color = chipColor, modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp))
                            }
                        }
                    }
                }
            }

            // Flag icon
            if (message.flagged) {
                Spacer(Modifier.width(4.dp))
                Icon(Icons.Default.Star, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.tertiary)
            }
        }
    }
}
