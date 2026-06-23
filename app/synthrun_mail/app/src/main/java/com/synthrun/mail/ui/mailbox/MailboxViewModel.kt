package com.synthrun.mail.ui.mailbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synthrun.mail.core.Constants.EXCLUDED_FROM_INBOX
import com.synthrun.mail.data.model.Message
import com.synthrun.mail.data.repository.AuthRepo
import com.synthrun.mail.data.repository.MessageRepo
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

// ── Holds all mailbox state ──
data class MailboxState(
    val allMessages: List<Message> = emptyList(),
    val filteredMessages: List<Message> = emptyList(),
    val currentFolder: String = "inbox",
    val selectedMessage: Message? = null,
    val searchQuery: String = "",
    val selectedIds: Set<String> = emptySet()
)

class MailboxViewModel(
    private val authRepo: AuthRepo,
    private val messageRepo: MessageRepo
) : ViewModel() {
    private val _state = MutableStateFlow(MailboxState())
    val state: StateFlow<MailboxState> = _state.asStateFlow()

    init {
        // ── Listen to Firestore in real time ──
        viewModelScope.launch {
            messageRepo.observeMessages(authRepo.currentEmail()).collect { messages ->
                _state.update { it.copy(allMessages = messages) }
                filterByFolder(_state.value.currentFolder)
            }
        }
    }

    fun selectFolder(folder: String) {
        _state.update { it.copy(currentFolder = folder, selectedMessage = null) }
        filterByFolder(folder)
    }

    fun selectMessage(msg: Message) {
        _state.update { it.copy(selectedMessage = msg) }
        // ── Mark as read if unread ──
        if (msg.unread) {
            viewModelScope.launch { messageRepo.markRead(msg.id) }
        }
    }

    fun updateSearch(query: String) {
        _state.update { it.copy(searchQuery = query) }
        filterByFolder(_state.value.currentFolder)
    }

    private fun filterByFolder(folder: String) {
        val all = _state.value.allMessages
        val query = _state.value.searchQuery.lowercase()

        val filtered = when (folder) {
            "unread" -> all.filter { it.unread && it.folder !in EXCLUDED_FROM_INBOX }
            "sent" -> all.filter { it.folder == "sent" }
            "outbox" -> all.filter { it.folder == "outbox" }
            "archived" -> all.filter { it.folder == "archived" }
            "flagged" -> all.filter { it.flagged }
            "important" -> all.filter { it.important }
            "drafts" -> all.filter { it.folder == "draft" }
            "trash" -> all.filter { it.folder == "trash" }
            "spam" -> all.filter { it.folder == "spam" }
            else -> all.filter { it.folder !in EXCLUDED_FROM_INBOX }
        }

        // ── Apply search filter ──
        val searched = if (query.isNotEmpty()) filtered.filter { msg ->
            listOf(msg.subject, msg.from, msg.to, msg.body)
                .any { it.lowercase().contains(query) }
        } else filtered

        _state.update { it.copy(filteredMessages = searched) }
    }

    fun archiveMessage(id: String) { viewModelScope.launch { messageRepo.updateFolder(id, "archived") } }
    fun trashMessage(id: String) { viewModelScope.launch { messageRepo.updateFolder(id, "trash") } }
    fun deleteMessage(id: String) { viewModelScope.launch { messageRepo.deleteMessage(id) } }
    fun toggleFlag(id: String, flagged: Boolean) { viewModelScope.launch { messageRepo.updateFlag(id, flagged) } }
    fun toggleImportant(id: String, important: Boolean) { viewModelScope.launch { messageRepo.updateImportant(id, important) } }
}