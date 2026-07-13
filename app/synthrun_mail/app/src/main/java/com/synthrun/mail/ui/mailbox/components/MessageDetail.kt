package com.synthrun.mail.ui.mailbox.components

import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.synthrun.mail.data.model.Message
import com.synthrun.mail.data.model.UserLabel
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessageDetail(
    modifier: Modifier = Modifier,
    message: Message?,
    userLabels: List<UserLabel> = emptyList(),
    onBack: () -> Unit = {},
    onArchive: () -> Unit = {},
    onTrash: () -> Unit = {},
    onFlag: () -> Unit = {},
    onImportant: () -> Unit = {},
    onMarkUnread: () -> Unit = {},
    onDeleteForever: () -> Unit = {},
    onRestore: () -> Unit = {},
    onMarkNotSpam: () -> Unit = {},
    onRetry: () -> Unit = {},
    onToggleLabel: (String) -> Unit = {}
) {
    if (message == null) return

    val isTrash = message.folder == "trash"
    val isOutbox = message.folder == "outbox"
    val isSpam = message.folder == "spam"
    val isArchived = message.folder == "archived"
    val isOutboxFailed = isOutbox && message.status == "failed"

    var headerExpanded by remember { mutableStateOf(true) }

    Column(modifier = modifier.fillMaxSize()) {
        // ── Back button (phone) ──
        IconButton(onClick = onBack, modifier = Modifier.padding(start = 4.dp, top = 4.dp).size(32.dp)) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back")
        }

        // ── Subject header (collapsible) ──
        Surface(
            tonalElevation = 1.dp,
            modifier = Modifier.fillMaxWidth().clickable { headerExpanded = !headerExpanded }
        ) {
            Column(modifier = Modifier.padding(if (headerExpanded) 16.dp else 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (headerExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        contentDescription = "Toggle header",
                        modifier = Modifier.size(20.dp),
                        tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        message.subject.ifEmpty { "(no subject)" },
                        style = if (headerExpanded) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Normal,
                        maxLines = if (headerExpanded) 2 else 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                }

                if (headerExpanded) {
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primary, modifier = Modifier.size(32.dp)) {
                            Box(contentAlignment = Alignment.Center) {
                                Text(
                                    (message.fromName.ifEmpty { message.from }).take(2).uppercase(),
                                    color = MaterialTheme.colorScheme.onPrimary,
                                    fontSize = 11.sp
                                )
                            }
                        }
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(message.fromName.ifEmpty { message.from }, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                            Text("To: ${message.to}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                        }
                        Spacer(Modifier.weight(1f))
                        message.receivedAt?.let {
                            val sdf = remember { SimpleDateFormat("MMM d, yyyy h:mm a", Locale.getDefault()) }
                            Text(sdf.format(it.toDate()), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                        }
                    }
                }
            }
        }

        HorizontalDivider()

        // ── Action toolbar ──
        Surface(modifier = Modifier.fillMaxWidth(), tonalElevation = 0.dp) {
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                if (isTrash) {
                    // Trash: only Restore + Delete forever
                    ActionChip(icon = Icons.Default.Restore, label = "Restore", onClick = onRestore)
                    ActionChip(icon = Icons.Default.DeleteForever, label = "Delete forever", onClick = onDeleteForever)
                } else if (isSpam) {
                    ActionChip(icon = Icons.Default.Check, label = "Not spam", onClick = onMarkNotSpam)
                    ActionChip(icon = Icons.Default.DeleteForever, label = "Delete forever", onClick = onDeleteForever)
                } else {
                    // Common toggles for inbox/archived/sent etc.
                    ActionChip(icon = Icons.Default.Star, label = if (message.flagged) "Flagged" else "Flag", onClick = onFlag, active = message.flagged)
                    ActionChip(icon = Icons.Default.Info, label = if (message.important) "Important" else "Mark", onClick = onImportant, active = message.important)
                    ActionChip(icon = Icons.Default.Check, label = if (message.folder == "archived") "Unarchive" else "Archive", onClick = onArchive, active = message.folder == "archived")
                    ActionChip(icon = Icons.Default.Delete, label = "Trash", onClick = onTrash)
                    ActionChip(icon = Icons.Default.Markunread, label = if (message.unread) "Read" else "Unread", onClick = onMarkUnread, active = message.unread)
                }
                if (isOutboxFailed) {
                    ActionChip(icon = Icons.Default.Refresh, label = "Retry", onClick = onRetry)
                }
            }
        }

        HorizontalDivider()

        // ── Label chips ──
        if (message.labels.isNotEmpty() || userLabels.isNotEmpty()) {
            Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(message.labels) { labelName ->
                        val labelDef = userLabels.find { it.name == labelName }
                        val chipColor = try { Color(android.graphics.Color.parseColor(labelDef?.color ?: "#888")) } catch (_: Exception) { Color.Gray }
                        InputChip(
                            selected = true,
                            onClick = { onToggleLabel(labelName) },
                            label = { Text(labelName, fontSize = 11.sp) },
                            trailingIcon = { Icon(Icons.Default.Close, "Remove", modifier = Modifier.size(14.dp)) },
                            colors = InputChipDefaults.inputChipColors(selectedContainerColor = chipColor.copy(alpha = 0.2f), selectedLabelColor = chipColor),
                            modifier = Modifier.height(28.dp)
                        )
                    }
                    if (userLabels.isNotEmpty()) {
                        items(userLabels.filter { it.name !in message.labels }) { labelDef ->
                            val chipColor = try { Color(android.graphics.Color.parseColor(labelDef.color)) } catch (_: Exception) { Color.Gray }
                            InputChip(
                                selected = false,
                                onClick = { onToggleLabel(labelDef.name) },
                                label = { Text(labelDef.name, fontSize = 11.sp) },
                                colors = InputChipDefaults.inputChipColors(labelColor = chipColor),
                                modifier = Modifier.height(28.dp)
                            )
                        }
                    }
                }
            }
        }

        // ── Body ──
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            val html = message.htmlBody
            if (html.isNotEmpty() && (html.contains("<") || html.contains("&"))) {
                AndroidView(
                    factory = { ctx ->
                        WebView(ctx).apply {
                            webViewClient = WebViewClient()
                            settings.javaScriptEnabled = false
                            settings.loadWithOverviewMode = true
                            settings.useWideViewPort = true
                            setPadding(0, 0, 0, 0)
                        }
                    },
                    update = { it.loadDataWithBaseURL(null, wrapHtml(html), "text/html", "UTF-8", null) },
                    modifier = Modifier.fillMaxWidth()
                )
            } else {
                Text(
                    message.body.ifEmpty { "(no content)" },
                    style = MaterialTheme.typography.bodyMedium,
                    lineHeight = 24.sp
                )
            }
        }
    }
}

@Composable
private fun ActionChip(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit, active: Boolean = false) {
    val bg = if (active) MaterialTheme.colorScheme.primary.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surface
    val tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
    val borderColor = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = bg,
        border = BorderStroke(1.dp, borderColor),
        modifier = Modifier.height(32.dp).clickable(onClick = onClick)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 10.dp)) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(14.dp), tint = tint)
            Spacer(Modifier.width(4.dp))
            Text(label, fontSize = 10.sp, color = tint)
        }
    }
}

private fun wrapHtml(html: String): String = """
<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:sans-serif;font-size:14px;line-height:1.6;color:#222;padding:0;margin:0;overflow-wrap:break-word;word-break:break-word}
img{max-width:100%;height:auto}table{max-width:100%!important}
pre{white-space:pre-wrap;word-break:break-word}
</style></head><body>$html</body></html>
""".trimIndent()
