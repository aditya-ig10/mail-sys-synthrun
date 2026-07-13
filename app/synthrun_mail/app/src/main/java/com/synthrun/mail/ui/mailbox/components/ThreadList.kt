package com.synthrun.mail.ui.mailbox.components

import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.synthrun.mail.data.model.Message
import com.synthrun.mail.data.model.UserLabel

@Composable
fun ThreadList(
    modifier: Modifier = Modifier,
    messages: List<Message>,
    selectedId: String?,
    selectedIds: Set<String> = emptySet(),
    userLabels: List<UserLabel> = emptyList(),
    onSelect: (Message) -> Unit,
    onLongClick: ((Message) -> Unit)? = null
) {
    LazyColumn(modifier = modifier) {
        items(messages, key = { it.id }) { msg ->
            ThreadItem(
                message = msg,
                isSelected = msg.id == selectedId || msg.id in selectedIds,
                userLabels = userLabels,
                onClick = { onSelect(msg) },
                onLongClick = { onLongClick?.invoke(msg) }
            )
        }
    }
}
