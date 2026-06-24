package com.synthrun.mail.ui.mailbox.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.synthrun.mail.data.model.Message

// ── Full message view (bubble layout, like web) ──
@Composable
fun MessageDetail(
    modifier: Modifier = Modifier,
    message: Message?,
    onArchive: () -> Unit,
    onTrash: () -> Unit,
    onFlag: () -> Unit,
    onImportant: () -> Unit
) {
    if (message == null) return

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        // ── Subject header ──
        Text(message.subject, style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(8.dp))

        // ── Sender block (avatar + name + date) ──
        Text("From: ${message.fromName} <${message.from}>")
        Text("To: ${message.to}")
        message.receivedAt?.let { Text("Date: ${it.toDate()}") }
        Spacer(Modifier.height(12.dp))

        HorizontalDivider()
        Spacer(Modifier.height(12.dp))

        // ── Body (plain text for now) ──
        Text(message.htmlBody.ifEmpty { message.body })
    }
}