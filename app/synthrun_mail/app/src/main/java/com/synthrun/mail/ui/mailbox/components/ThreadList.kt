package com.synthrun.mail.ui.mailbox.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.synthrun.mail.data.model.Message

// ── Scrollable thread list (like web thread-items) ──
@Composable
fun ThreadList(
    modifier: Modifier = Modifier,
    messages: List<Message>,
    selectedId: String?,
    onSelect: (Message) -> Unit
) {
    LazyColumn(modifier = modifier.fillMaxWidth()) {
        items(messages) { msg ->
            ThreadItem(message = msg, isSelected = msg.id == selectedId, onClick = { onSelect(msg) })
        }
    }
}