package com.synthrun.mail.ui.compose

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.synthrun.mail.data.repository.AttachmentRepo
import com.synthrun.mail.data.repository.AuthRepo
import com.synthrun.mail.data.repository.MessageRepo

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComposeScreen(
    authRepo: AuthRepo,
    messageRepo: MessageRepo,
    attachmentRepo: AttachmentRepo,
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

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { viewModel.addAttachment(context, it) }
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
                title = { Text("New Message", fontSize = 16.sp) },
                navigationIcon = {
                    TextButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Discard", modifier = Modifier.size(20.dp))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface)
            )
        },
        bottomBar = {
            Column {
                if (state.attachments.isNotEmpty()) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
                    LazyRow(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        itemsIndexed(state.attachments) { index, att ->
                            AssistChip(
                                onClick = {},
                                label = { Text(att["name"] as? String ?: "File", style = MaterialTheme.typography.labelSmall) },
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
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                ) {
                    Column {
                        OutlinedButton(
                            onClick = { picker.launch("*/*") },
                            enabled = !state.isAttaching,
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = glassBg,
                                contentColor = MaterialTheme.colorScheme.onSurface
                            ),
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
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("To", fontWeight = FontWeight.Medium, fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                        modifier = Modifier.width(64.dp))
                TextField(
                    value = state.to,
                    onValueChange = viewModel::updateTo,
                    placeholder = { Text("Recipients", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)) },
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.weight(1f),
                    textStyle = MaterialTheme.typography.bodyMedium
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))

            // Cc
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Cc", fontWeight = FontWeight.Medium, fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                    modifier = Modifier.width(64.dp))
                TextField(
                    value = state.cc,
                    onValueChange = viewModel::updateCc,
                    placeholder = { Text("Cc", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)) },
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.weight(1f),
                    textStyle = MaterialTheme.typography.bodyMedium
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))

            // Bcc
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Bcc", fontWeight = FontWeight.Medium, fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                    modifier = Modifier.width(64.dp))
                TextField(
                    value = state.bcc,
                    onValueChange = viewModel::updateBcc,
                    placeholder = { Text("Bcc", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)) },
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.weight(1f),
                    textStyle = MaterialTheme.typography.bodyMedium
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))

            // Subject
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Subject", fontWeight = FontWeight.Medium, fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                    modifier = Modifier.width(64.dp))
                TextField(
                    value = state.subject,
                    onValueChange = viewModel::updateSubject,
                    placeholder = { Text("Subject", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)) },
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.weight(1f),
                    textStyle = MaterialTheme.typography.bodyMedium
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))

            // Body
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
