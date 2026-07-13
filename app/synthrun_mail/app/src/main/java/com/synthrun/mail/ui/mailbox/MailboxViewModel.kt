package com.synthrun.mail.ui.mailbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synthrun.mail.core.Constants.EXCLUDED_FROM_INBOX
import com.synthrun.mail.data.model.Message
import com.synthrun.mail.data.model.UserLabel
import com.synthrun.mail.data.repository.AuthRepo
import com.synthrun.mail.data.repository.LabelRepo
import com.synthrun.mail.data.repository.MessageRepo
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class MailboxState(
    val allMessages: List<Message> = emptyList(),
    val filteredMessages: List<Message> = emptyList(),
    val currentFolder: String = "inbox",
    val selectedMessage: Message? = null,
    val searchQuery: String = "",
    val selectedIds: Set<String> = emptySet(),
    val userLabels: List<UserLabel> = emptyList(),
    val loading: Boolean = true,
    val inboxUnread: Int = 0,
    val inboxTotal: Int = 0,
    val flaggedCount: Int = 0,
    val draftCount: Int = 0,
    val trashCount: Int = 0,
    val outboxCount: Int = 0,
    val spamCount: Int = 0,
    val archivedCount: Int = 0,
    val sentCount: Int = 0
)

class MailboxViewModel(
    private val authRepo: AuthRepo,
    private val messageRepo: MessageRepo,
    private val labelRepo: LabelRepo = LabelRepo()
) : ViewModel() {
    private val _state = MutableStateFlow(MailboxState())
    val state: StateFlow<MailboxState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            messageRepo.observeMessages(authRepo.currentEmail()).collect { messages ->
                _state.update { it.copy(allMessages = messages, loading = false) }
                computeCounts(messages)
                filterByFolder(_state.value.currentFolder)
            }
        }
        loadLabels()
    }

    private fun loadLabels() {
        val uid = authRepo.currentUser()?.uid ?: return
        viewModelScope.launch {
            try {
                val labels = labelRepo.loadLabels(uid)
                _state.update { it.copy(userLabels = labels) }
                filterByFolder(_state.value.currentFolder)
            } catch (_: Exception) {}
        }
    }

    private fun computeCounts(messages: List<Message>) {
        var inboxTotal = 0; var inboxUnread = 0; var draftCount = 0
        var trashCount = 0; var outboxCount = 0; var spamCount = 0
        var archivedCount = 0; var sentCount = 0; var flaggedCount = 0
        for (m in messages) {
            // inboxTotal = messages in "inbox" folder only (matches web frontend)
            when (m.folder) {
                "inbox", "" -> { inboxTotal++; if (m.unread) inboxUnread++ }
                "draft" -> draftCount++
                "trash" -> trashCount++
                "outbox" -> outboxCount++
                "spam" -> spamCount++
                "archived" -> archivedCount++
                "sent" -> sentCount++
            }
            if (m.flagged) flaggedCount++
        }
        _state.update { it.copy(
            inboxTotal = inboxTotal, inboxUnread = inboxUnread, flaggedCount = flaggedCount,
            draftCount = draftCount, trashCount = trashCount,
            outboxCount = outboxCount, spamCount = spamCount,
            archivedCount = archivedCount, sentCount = sentCount
        )}
    }

    fun selectFolder(folder: String) {
        _state.update { it.copy(currentFolder = folder, selectedMessage = null, selectedIds = emptySet()) }
        filterByFolder(folder)
    }

    fun selectMessage(msg: Message) {
        _state.update { it.copy(selectedMessage = msg) }
        if (msg.unread) {
            markRead(msg.id)
        }
    }

    fun updateSearch(query: String) {
        _state.update { it.copy(searchQuery = query) }
        filterByFolder(_state.value.currentFolder)
    }

    fun toggleSelected(id: String) {
        _state.update { s ->
            val ids = s.selectedIds.toMutableSet()
            if (ids.contains(id)) ids.remove(id) else ids.add(id)
            s.copy(selectedIds = ids)
        }
    }

    fun clearSelection() {
        _state.update { it.copy(selectedIds = emptySet()) }
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
            "clients" -> all.filter { it.labels.contains("clients") }
                else -> {
                    if (folder.startsWith("label:")) {
                        val labelName = folder.removePrefix("label:")
                        all.filter { it.labels.contains(labelName) }
                    } else {
                        all.filter { m -> m.folder == "inbox" || m.folder.isNullOrEmpty() }
                    }
                }
        }

        val searched = if (query.isNotEmpty()) filtered.filter { msg ->
            listOf(msg.subject, msg.from, msg.to, msg.body)
                .any { it.lowercase().contains(query) }
        } else filtered

        _state.update { it.copy(filteredMessages = searched) }
    }

    // ── Actions (toggle but keep message visible on current page) ──
    fun archiveMessage(id: String) {
        val msg = _state.value.selectedMessage ?: _state.value.allMessages.find { it.id == id } ?: return
        val target = if (msg.folder == "archived") "inbox" else "archived"
        _state.update { s ->
            val updated = s.allMessages.map { if (it.id == id) it.copy(folder = target) else it }
            s.copy(allMessages = updated, selectedMessage = if (s.selectedMessage?.id == id) s.selectedMessage?.copy(folder = target) else s.selectedMessage)
        }
        viewModelScope.launch { messageRepo.updateFolder(id, target) }
    }
    fun trashMessage(id: String) {
        _state.update { s ->
            val updated = s.allMessages.map { if (it.id == id) it.copy(folder = "trash") else it }
            s.copy(allMessages = updated, selectedMessage = if (s.selectedMessage?.id == id) s.selectedMessage?.copy(folder = "trash") else s.selectedMessage)
        }
        viewModelScope.launch { messageRepo.updateFolder(id, "trash") }
    }
    fun deleteMessage(id: String) { viewModelScope.launch { messageRepo.deleteMessage(id) } }
    fun deleteForever(id: String) {
        _state.update { s -> s.copy(allMessages = s.allMessages.filter { it.id != id }) }
        viewModelScope.launch { messageRepo.deleteMessage(id) }
    }
    fun emptyTrash() {
        viewModelScope.launch {
            val trashIds = _state.value.allMessages.filter { it.folder == "trash" }.map { it.id }
            for (id in trashIds) messageRepo.deleteMessage(id)
        }
    }
    fun toggleFlag(id: String, flagged: Boolean) {
        updateLocalMessage(id) { it.copy(flagged = flagged) }
        viewModelScope.launch { messageRepo.updateFlag(id, flagged) }
    }
    fun toggleImportant(id: String, important: Boolean) {
        updateLocalMessage(id) { it.copy(important = important) }
        viewModelScope.launch { messageRepo.updateImportant(id, important) }
    }
    fun markRead(id: String) {
        updateLocalMessage(id) { it.copy(unread = false) }
        viewModelScope.launch { messageRepo.markRead(id) }
    }
    fun markUnread(id: String) {
        updateLocalMessage(id) { it.copy(unread = true) }
        viewModelScope.launch { messageRepo.markUnread(id) }
    }

    private fun updateLocalMessage(id: String, transform: (Message) -> Message) {
        _state.update { s ->
            val updated = s.allMessages.map { if (it.id == id) transform(it) else it }
            s.copy(
                allMessages = updated,
                selectedMessage = if (s.selectedMessage?.id == id) transform(s.selectedMessage) else s.selectedMessage
            )
        }
        computeCounts(_state.value.allMessages)
        filterByFolder(_state.value.currentFolder)
    }
    fun restoreFromTrash(id: String) { viewModelScope.launch { messageRepo.updateFolder(id, "inbox") } }
    fun markAsNotSpam(id: String) { viewModelScope.launch { messageRepo.updateFolder(id, "inbox") } }
    fun retryOutbox(id: String) { /* will be handled by ComposeViewModel */ }

    // ── Label actions ──
    fun assignLabel(messageId: String, labelName: String, add: Boolean) {
        viewModelScope.launch {
            try {
                labelRepo.toggleLabelOnMessage(messageId, labelName, add)
            } catch (_: Exception) {}
        }
    }

    fun toggleMessageLabel(messageId: String, labelName: String) {
        val msg = _state.value.allMessages.find { it.id == messageId }
        val has = msg?.labels?.contains(labelName) == true
        assignLabel(messageId, labelName, !has)
    }

    // ── Bulk actions ──
    fun bulkTrash() = bulkAction { messageRepo.updateFolder(it, "trash") }
    fun bulkArchive() = bulkAction { messageRepo.updateFolder(it, "archived") }
    fun bulkFlag() = bulkAction {
        val msg = _state.value.allMessages.find { m -> m.id == it }
        messageRepo.updateFlag(it, msg?.flagged != true)
    }
    fun bulkMarkRead() = bulkAction { messageRepo.markRead(it) }
    fun bulkMarkUnread() = bulkAction { messageRepo.markUnread(it) }
    fun bulkApplyLabel(labelName: String) = bulkAction { assignLabel(it, labelName, true) }

    private fun bulkAction(action: suspend (String) -> Unit) {
        viewModelScope.launch {
            val ids = _state.value.selectedIds.toList()
            for (id in ids) {
                try { action(id) } catch (_: Exception) {}
            }
            _state.update { it.copy(selectedIds = emptySet()) }
        }
    }
}
