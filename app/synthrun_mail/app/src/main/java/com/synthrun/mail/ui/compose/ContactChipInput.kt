package com.synthrun.mail.ui.compose

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.synthrun.mail.data.model.ContactEntry
import com.synthrun.mail.data.repository.ContactRepo

@Composable
fun ContactChipInput(
    label: String,
    recipients: List<String>,
    onRecipientsChanged: (List<String>) -> Unit,
    contactRepo: ContactRepo,
    modifier: Modifier = Modifier
) {
    var text by remember { mutableStateOf("") }
    var suggestions by remember { mutableStateOf<List<ContactEntry>>(emptyList()) }
    var isFocused by remember { mutableStateOf(false) }

    fun updateSuggestions(query: String) {
        suggestions = if (query.isBlank()) emptyList() else contactRepo.search(query)
    }

    Column(modifier = modifier) {
        // Existing chips
        if (recipients.isNotEmpty()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                recipients.forEach { addr ->
                    Surface(
                        onClick = { onRecipientsChanged(recipients - addr) },
                        shape = RoundedCornerShape(16.dp),
                        color = MaterialTheme.colorScheme.secondaryContainer,
                        modifier = Modifier.height(28.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 10.dp, end = 6.dp)) {
                            Text(addr, fontSize = 12.sp, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                            Spacer(Modifier.width(4.dp))
                            Icon(Icons.Default.Close, "remove", modifier = Modifier.size(14.dp))
                        }
                    }
                }
            }
        }

        Box {
            OutlinedTextField(
                value = text,
                onValueChange = { v ->
                    text = v
                    updateSuggestions(v)
                },
                label = { Text(label) },
                placeholder = { Text("add recipient", fontSize = 13.sp) },
                modifier = Modifier.fillMaxWidth().onFocusChanged { f ->
                    isFocused = f.isFocused
                    if (!f.isFocused) {
                        suggestions = emptyList()
                        if (text.isNotBlank() && text.contains("@")) {
                            onRecipientsChanged(recipients + text.trim())
                            text = ""
                        }
                    }
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = {
                    if (text.isNotBlank() && text.contains("@")) {
                        onRecipientsChanged(recipients + text.trim())
                        text = ""
                        suggestions = emptyList()
                    }
                }),
                textStyle = MaterialTheme.typography.bodySmall
            )

            // Autocomplete dropdown
            if (isFocused && suggestions.isNotEmpty()) {
                Card(
                    modifier = Modifier.fillMaxWidth().offset(x = 0.dp, y = 56.dp).heightIn(max = 200.dp),
                    elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    LazyColumn(modifier = Modifier.heightIn(max = 200.dp)) {
                        items(suggestions) { contact ->
                            Row(
                                modifier = Modifier.fillMaxWidth()
                                    .clickable {
                                        onRecipientsChanged(recipients + contact.email)
                                        text = ""
                                        suggestions = emptyList()
                                    }
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(Modifier.weight(1f)) {
                                    if (contact.name.isNotBlank()) {
                                        Text(contact.name, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                        Text(contact.email, fontSize = 11.sp,
                                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                                    } else {
                                        Text(contact.email, fontSize = 13.sp)
                                    }
                                }
                                Text("${contact.count}", fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f))
                            }
                        }
                    }
                }
            }
        }
    }
}
