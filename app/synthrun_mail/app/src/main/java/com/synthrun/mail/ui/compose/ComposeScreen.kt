package com.synthrun.mail.ui.compose

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.synthrun.mail.data.repository.AttachmentRepo
import com.synthrun.mail.data.repository.AuthRepo
import com.synthrun.mail.data.repository.ContactRepo
import com.synthrun.mail.data.repository.MessageRepo

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComposeScreen(
    authRepo: AuthRepo,
    messageRepo: MessageRepo,
    attachmentRepo: AttachmentRepo,
    contactRepo: ContactRepo,
    prefillTo: String,
    prefillSubject: String,
    onSent: () -> Unit,
    onDismiss: () -> Unit
) {
    val viewModel: ComposeViewModel = viewModel(
        factory = object : androidx.lifecycle.ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T =
                ComposeViewModel(authRepo, messageRepo, attachmentRepo) as T
        }
    )
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val userEmail = authRepo.currentEmail()

    LaunchedEffect(Unit) {
        val uid = authRepo.currentUser()?.uid ?: return@LaunchedEffect
        contactRepo.buildFromMessages(uid)
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { viewModel.addAttachment(context, it) }
    }

    fun parseRecipients(s: String) = s.split(",").map { it.trim() }.filter { it.isNotBlank() }
    var showCc by remember { mutableStateOf(state.cc.isNotEmpty()) }
    var showBcc by remember { mutableStateOf(state.bcc.isNotEmpty()) }
    var showTemplatePicker by remember { mutableStateOf(false) }

    if (showTemplatePicker) {
        TemplatePickerDialog(
            onDismiss = { showTemplatePicker = false },
            onSelect = { template ->
                viewModel.applyTemplate(template)
                showTemplatePicker = false
            }
        )
    }

    LaunchedEffect(prefillTo) { viewModel.updateTo(prefillTo) }
    LaunchedEffect(prefillSubject) { viewModel.updateSubject(prefillSubject) }

    LaunchedEffect(state.sendSuccess) {
        if (state.sendSuccess) onSent()
    }

    val fieldColors = TextFieldDefaults.colors(
        focusedIndicatorColor = Color.Transparent,
        unfocusedIndicatorColor = Color.Transparent,
        focusedContainerColor = Color.Transparent,
        unfocusedContainerColor = Color.Transparent,
    )

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("New Message", fontSize = 16.sp)
                        if (state.statusMessage.isNotEmpty()) {
                            Text(state.statusMessage, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                        }
                    }
                },
                navigationIcon = {
                    TextButton(onClick = {
                        viewModel.clearDraft()
                        onDismiss()
                    }) {
                        Icon(Icons.Default.Close, contentDescription = "Discard", modifier = Modifier.size(20.dp))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface)
            )
        },
        bottomBar = {
            Column {
                // Upload progress
                if (state.isAttaching) {
                    LinearProgressIndicator(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                        progress = { state.uploadProgress }
                    )
                    if (state.uploadFileName.isNotEmpty()) {
                        Text(
                            state.uploadFileName,
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                            modifier = Modifier.padding(horizontal = 12.dp)
                        )
                    }
                }

                if (state.attachments.isNotEmpty()) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
                    LazyRow(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        itemsIndexed(state.attachments) { index, att ->
                            val name = att["name"] as? String ?: "File"
                            val size = (att["size"] as? Long) ?: 0
                            AssistChip(
                                onClick = {},
                                label = {
                                    Column {
                                        Text(name, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                                        Text(formatSize(size), fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                                    }
                                },
                                trailingIcon = {
                                    IconButton(onClick = { viewModel.removeAttachment(index) }, modifier = Modifier.size(16.dp)) {
                                        Icon(Icons.Default.Close, "Remove", modifier = Modifier.size(12.dp))
                                    }
                                }
                            )
                        }
                    }
                }

                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))

                val glassBg = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
                val glassBorder = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f))

                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)
                ) {
                    Column {
                        Row {
                            OutlinedButton(
                                onClick = { picker.launch("*/*") },
                                enabled = !state.isAttaching,
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                                colors = ButtonDefaults.outlinedButtonColors(containerColor = glassBg, contentColor = MaterialTheme.colorScheme.onSurface),
                                border = glassBorder
                            ) {
                                if (state.isAttaching) {
                                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                } else {
                                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                                }
                                Spacer(Modifier.width(4.dp))
                                Text(if (state.isAttaching) "Uploading..." else "Attach", fontSize = 13.sp)
                            }
                            Spacer(Modifier.width(8.dp))
                            OutlinedButton(
                            onClick = { viewModel.toggleHtmlMode() },
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = if (state.isHtmlMode) MaterialTheme.colorScheme.primary.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
                                contentColor = if (state.isHtmlMode) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                            ),
                            border = BorderStroke(1.dp, if (state.isHtmlMode) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))
                        ) {
                            Icon(Icons.Default.Code, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text(if (state.isHtmlMode) "HTML" else "Plain", fontSize = 13.sp)
                        }
                        Spacer(Modifier.width(8.dp))
                        OutlinedButton(
                            onClick = { showTemplatePicker = true },
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            colors = ButtonDefaults.outlinedButtonColors(containerColor = glassBg, contentColor = MaterialTheme.colorScheme.onSurface),
                            border = glassBorder
                        ) {
                            Icon(Icons.Default.Description, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Templates", fontSize = 13.sp)
                        }
                        }
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = { viewModel.send() },
                            enabled = !state.isSending,
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.2f),
                                contentColor = MaterialTheme.colorScheme.primary
                            ),
                            border = glassBorder
                        ) {
                            if (state.isSending) {
                                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.primary)
                            } else {
                                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("Send", fontSize = 13.sp)
                            }
                        }
                    }

                    Spacer(Modifier.weight(1f))

                    Text(
                        "from: $userEmail",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.45f),
                        maxLines = 1,
                        modifier = Modifier.align(Alignment.Bottom)
                    )
                }

                state.error?.let {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.error,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                    )
                }
            }
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            // To
            ContactChipInput(
                label = "To",
                recipients = parseRecipients(state.to),
                onRecipientsChanged = { viewModel.updateTo(it.joinToString(", ")) },
                contactRepo = contactRepo,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))

            // Cc toggle
            if (showCc || state.cc.isNotEmpty()) {
                ContactChipInput(
                    label = "Cc",
                    recipients = parseRecipients(state.cc),
                    onRecipientsChanged = { viewModel.updateCc(it.joinToString(", ")) },
                    contactRepo = contactRepo,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
            } else {
                TextButton(onClick = { showCc = true }, modifier = Modifier.padding(start = 12.dp)) {
                    Text("+ Cc", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                }
            }

            // Bcc toggle
            if (showBcc || state.bcc.isNotEmpty()) {
                ContactChipInput(
                    label = "Bcc",
                    recipients = parseRecipients(state.bcc),
                    onRecipientsChanged = { viewModel.updateBcc(it.joinToString(", ")) },
                    contactRepo = contactRepo,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
            } else if (showCc) {
                TextButton(onClick = { showBcc = true }, modifier = Modifier.padding(start = 12.dp)) {
                    Text("+ Bcc", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                }
            }

            // Subject
            Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Subject", fontWeight = FontWeight.Medium, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f), modifier = Modifier.width(64.dp))
                TextField(value = state.subject, onValueChange = viewModel::updateSubject, placeholder = { Text("Subject", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)) }, singleLine = true, colors = fieldColors, modifier = Modifier.weight(1f), textStyle = MaterialTheme.typography.bodyMedium)
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))

            // Body (plain text or HTML with preview)
            if (state.isHtmlMode) {
                Column(modifier = Modifier.fillMaxWidth().weight(1f)) {
                    // Source / Preview tabs
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(0.dp)
                    ) {
                        TextButton(onClick = { if (state.htmlPreview) viewModel.toggleHtmlPreview() }) {
                            Text(
                                "Source",
                                fontSize = 11.sp,
                                fontWeight = if (!state.htmlPreview) FontWeight.SemiBold else FontWeight.Normal,
                                color = if (!state.htmlPreview) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                            )
                        }
                        TextButton(onClick = { if (!state.htmlPreview) viewModel.toggleHtmlPreview() }) {
                            Text(
                                "Preview",
                                fontSize = 11.sp,
                                fontWeight = if (state.htmlPreview) FontWeight.SemiBold else FontWeight.Normal,
                                color = if (state.htmlPreview) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                            )
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))

                    if (state.htmlPreview) {
                        AndroidView(
                            factory = { ctx ->
                                android.webkit.WebView(ctx).apply {
                                    webViewClient = android.webkit.WebViewClient()
                                    settings.javaScriptEnabled = false
                                    settings.loadWithOverviewMode = true
                                    settings.useWideViewPort = true
                                }
                            },
                            update = { it.loadDataWithBaseURL(null, wrapHtmlPreview(state.htmlBody), "text/html", "UTF-8", null) },
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        TextField(
                            value = state.htmlBody,
                            onValueChange = viewModel::updateHtmlBody,
                            placeholder = { Text("Write HTML...", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)) },
                            colors = fieldColors,
                            modifier = Modifier.fillMaxSize(),
                            textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 12.sp)
                        )
                    }
                }
            } else {
                TextField(
                    value = state.body,
                    onValueChange = viewModel::updateBody,
                    placeholder = { Text("Write your message...", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)) },
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp)
                )
            }
        }
    }
}

private fun formatSize(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024) return "%.1f KB".format(kb)
    return "%.1f MB".format(kb / 1024.0)
}

private fun wrapHtmlPreview(html: String): String = """
<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:sans-serif;font-size:14px;line-height:1.6;color:#333;padding:16px;margin:0;overflow-wrap:break-word}
img{max-width:100%;height:auto}table{max-width:100%!important}
pre{white-space:pre-wrap;word-break:break-word}
</style></head><body>$html</body></html>
""".trimIndent()
