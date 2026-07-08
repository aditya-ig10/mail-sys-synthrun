package com.synthrun.mail.ui.compose

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synthrun.mail.data.model.EmailTemplate
import com.synthrun.mail.data.repository.AttachmentRepo
import com.synthrun.mail.data.repository.AuthRepo
import com.synthrun.mail.data.repository.MessageRepo
import com.synthrun.mail.data.repository.TemplateRepo
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ComposeState(
    val to: String = "",
    val cc: String = "",
    val bcc: String = "",
    val subject: String = "",
    val body: String = "",
    val htmlBody: String = "",
    val isHtmlMode: Boolean = false,
    val htmlPreview: Boolean = false,
    val attachments: List<Map<String, Any>> = emptyList(),
    val draftId: String? = null,
    val isAttaching: Boolean = false,
    val isSending: Boolean = false,
    val sendSuccess: Boolean = false,
    val error: String? = null,
    val statusMessage: String = "",
    val uploadProgress: Float = 0f,
    val uploadFileName: String = ""
)

class ComposeViewModel(
    private val authRepo: AuthRepo,
    private val messageRepo: MessageRepo,
    private val attachmentRepo: AttachmentRepo
) : ViewModel() {
    private val _state = MutableStateFlow(ComposeState())
    val state: StateFlow<ComposeState> = _state.asStateFlow()

    private var draftSaveTimer: Job? = null

    init {
        loadDraft()
    }

    fun updateTo(v: String) { _state.value = _state.value.copy(to = v); scheduleDraftSave() }
    fun updateCc(v: String) { _state.value = _state.value.copy(cc = v); scheduleDraftSave() }
    fun updateBcc(v: String) { _state.value = _state.value.copy(bcc = v); scheduleDraftSave() }
    fun updateSubject(v: String) { _state.value = _state.value.copy(subject = v); scheduleDraftSave() }
    fun updateBody(v: String) { _state.value = _state.value.copy(body = v); scheduleDraftSave() }
    fun toggleHtmlMode() { _state.value = _state.value.copy(isHtmlMode = !_state.value.isHtmlMode, htmlPreview = false) }
    fun toggleHtmlPreview() { _state.value = _state.value.copy(htmlPreview = !_state.value.htmlPreview) }
    fun updateHtmlBody(v: String) { _state.value = _state.value.copy(htmlBody = v); scheduleDraftSave() }

    private fun scheduleDraftSave() {
        draftSaveTimer?.cancel()
        draftSaveTimer = viewModelScope.launch {
            delay(2000)
            saveDraft()
        }
    }

    private suspend fun saveDraft() {
        val s = _state.value
        if (s.to.isBlank() && s.cc.isBlank() && s.bcc.isBlank() && s.subject.isBlank() && s.body.isBlank()) return
        try {
            val id = messageRepo.saveDraft(
                email = authRepo.currentEmail(),
                name = "",
                to = s.to, cc = s.cc, bcc = s.bcc,
                subject = s.subject,
                body = s.body,
                htmlBody = if (s.isHtmlMode) s.htmlBody else "",
                existingDraftId = s.draftId
            )
            _state.update { it.copy(draftId = id, statusMessage = "Draft saved") }
        } catch (_: Exception) {}
    }

    private fun loadDraft() {
        viewModelScope.launch {
            try {
                val draft = messageRepo.loadDraft(authRepo.currentEmail())
                if (draft != null) {
                    _state.update {
                        it.copy(
                            draftId = draft.id,
                            to = draft.to, cc = draft.cc, bcc = draft.bcc,
                            subject = draft.subject,
                            body = draft.body,
                            htmlBody = draft.htmlBody,
                            isHtmlMode = draft.htmlBody.isNotEmpty(),
                            statusMessage = "Draft restored"
                        )
                    }
                }
            } catch (_: Exception) {}
        }
    }

    fun clearDraft() {
        viewModelScope.launch {
            _state.value.draftId?.let { messageRepo.deleteMessage(it) }
        }
    }

    fun addAttachment(context: Context, uri: Uri) {
        val currentCount = _state.value.attachments.size
        if (currentCount >= 5) {
            _state.value = _state.value.copy(error = "Maximum 5 attachments per message")
            return
        }

        // Check file size before uploading
        var fileSize = 0L
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            cursor.moveToFirst()
            val sizeIdx = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE)
            if (sizeIdx >= 0) fileSize = cursor.getLong(sizeIdx)
        }
        if (fileSize > 10 * 1024 * 1024) {
            _state.value = _state.value.copy(error = "File too large — max 10 MB per file")
            return
        }

        viewModelScope.launch {
            _state.value = _state.value.copy(
                isAttaching = true,
                uploadProgress = 0f,
                uploadFileName = "Uploading...",
                error = null
            )
            val result = attachmentRepo.upload(context, uri, authRepo.getIdToken())
            _state.value = _state.value.copy(
                isAttaching = false,
                uploadProgress = 1f,
                uploadFileName = ""
            )
            result.onSuccess { att ->
                _state.value = _state.value.copy(
                    attachments = _state.value.attachments + att,
                    uploadProgress = 0f
                )
            }.onFailure { e ->
                _state.value = _state.value.copy(
                    error = "Failed to attach - ${e.message}",
                    uploadProgress = 0f,
                    uploadFileName = ""
                )
            }
        }
    }

    fun removeAttachment(index: Int) {
        val updated = _state.value.attachments.toMutableList()
        if (index in updated.indices) {
            updated.removeAt(index)
            _state.value = _state.value.copy(attachments = updated)
        }
    }

    fun send() {
        val s = _state.value
        if (s.to.isBlank()) {
            _state.value = s.copy(error = "Recipient (To) is required")
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(isSending = true, error = null, statusMessage = "Saving to outbox...")

            val email = authRepo.currentEmail()
            val body = if (s.isHtmlMode) s.body.ifEmpty { android.text.Html.fromHtml(s.htmlBody, android.text.Html.FROM_HTML_MODE_LEGACY).toString() } else s.body
            val htmlBody = if (s.isHtmlMode) s.htmlBody else ""

            // Save as outbox first
            val outboxId = messageRepo.saveOutbox(email, "", s.to, s.cc, s.bcc, s.subject, body, htmlBody, s.attachments)

            _state.value = _state.value.copy(statusMessage = "Sending...")

            val token = authRepo.getIdToken()
            val result = messageRepo.sendViaApi(token, s.to, s.cc, s.bcc, s.subject, body, htmlBody, s.attachments)

            result.fold(
                onSuccess = {
                    // Move outbox → sent
                    if (outboxId != null) {
                        messageRepo.updateFolder(outboxId, "sent")
                        messageRepo.updateStatus(outboxId, "sent")
                    }
                    // Also save a sent copy
                    messageRepo.saveSentMessage(email, "", s.to, s.cc, s.subject, body, htmlBody, s.attachments)
                    // Clear draft
                    clearDraft()
                    _state.value = _state.value.copy(isSending = false, sendSuccess = true, statusMessage = "")
                },
                onFailure = {
                    // Mark outbox as failed
                    if (outboxId != null) {
                        messageRepo.updateStatus(outboxId, "failed")
                    }
                    _state.value = _state.value.copy(
                        isSending = false,
                        error = it.message ?: "Failed to send",
                        statusMessage = ""
                    )
                }
            )
        }
    }

    fun applyTemplate(template: EmailTemplate) {
        _state.update {
            it.copy(
                htmlBody = template.htmlContent,
                isHtmlMode = true,
                body = android.text.Html.fromHtml(template.htmlContent, android.text.Html.FROM_HTML_MODE_LEGACY).toString()
            )
        }
    }

    fun applyCustomTemplate(name: String, message: String, cta: String = "Visit Synthrun →") {
        val html = TemplateRepo.buildCustomTemplate(name, message, cta)
        _state.update {
            it.copy(
                htmlBody = html,
                isHtmlMode = true,
                body = android.text.Html.fromHtml(html, android.text.Html.FROM_HTML_MODE_LEGACY).toString()
            )
        }
    }

    fun retrySend(messageId: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isSending = true, error = null, statusMessage = "Retrying...")
            messageRepo.updateStatus(messageId, "sending")

            val token = authRepo.getIdToken()
            // We need the full message data — for now load from Firestore
            val result = messageRepo.sendViaApi(token, _state.value.to, _state.value.cc, _state.value.bcc, _state.value.subject, _state.value.body, _state.value.htmlBody, _state.value.attachments)

            result.fold(
                onSuccess = {
                    messageRepo.updateFolder(messageId, "sent")
                    messageRepo.updateStatus(messageId, "sent")
                    _state.value = _state.value.copy(isSending = false, sendSuccess = true)
                },
                onFailure = {
                    messageRepo.updateStatus(messageId, "failed")
                    _state.value = _state.value.copy(isSending = false, error = it.message)
                }
            )
        }
    }
}
