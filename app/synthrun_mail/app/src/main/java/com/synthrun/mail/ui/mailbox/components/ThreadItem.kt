package com.synthrun.mail.ui.mailbox.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.synthrun.mail.data.model.Message

// ── One row in thread list (sender, subject, preview) ──
@Composable
fun ThreadItem(message: Message, isSelected: Boolean, onClick: () -> Unit) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = if (isSelected) MaterialTheme.colorScheme.surfaceVariant
        else MaterialTheme.colorScheme.surface
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(message.fromName.ifEmpty { message.from }, style = MaterialTheme.typography.bodySmall)
            Text(message.subject.ifEmpty { "(no subject)" }, style = MaterialTheme.typography.bodyMedium)
            message.body.take(80).let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)) }
        }
    }
}