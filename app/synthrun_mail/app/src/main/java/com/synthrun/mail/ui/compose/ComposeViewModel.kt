package com.synthrun.mail.ui.compose

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synthrun.mail.data.repository.AttachmentRepo
import com.synthrun.mail.data.repository.AuthRepo
import com.synthrun.mail.data.repository.MessageRepo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ComposeState(
    val to: String = "",
    val cc: String = "",
    val bcc: String = "",
    val subject: String = "",
    val body: String = "",
    val attachments: List<Map<String, Any>> = emptyList(),
    val isAttaching: Boolean = false,
    val isSending: Boolean = false,
    val sendSuccess: Boolean = false,
    val error: String? = null
)

class ComposeViewModel(
    private val authRepo: AuthRepo,
    private val messageRepo: MessageRepo,
    private val attachmentRepo: AttachmentRepo
) : ViewModel() {
    private val _state = MutableStateFlow(ComposeState())
    val state: StateFlow<ComposeState> = _state.asStateFlow()

    fun updateTo(v: String) { _state.value = _state.value.copy(to = v) }
    fun updateCc(v: String) { _state.value = _state.value.copy(cc = v) }
    fun updateBcc(v: String) { _state.value = _state.value.copy(bcc = v) }
    fun updateSubject(v: String) { _state.value = _state.value.copy(subject = v) }
    fun updateBody(v: String) { _state.value = _state.value.copy(body = v) }

    fun addAttachment(context: Context, uri: Uri) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isAttaching = true, error = null)
            val result = attachmentRepo.upload(context, uri, authRepo.getIdToken())
            _state.value = _state.value.copy(isAttaching = false)
            result.onSuccess { att ->
                _state.value = _state.value.copy(attachments = _state.value.attachments + att)
            }.onFailure { e ->
                _state.value = _state.value.copy(error = "Failed to attach - ${e.message}")
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
            _state.value = _state.value.copy(isSending = true, error = null)
            val token = authRepo.getIdToken()
            val result = messageRepo.sendViaApi(token, s.to, s.cc, s.bcc, s.subject, s.body, "", s.attachments)
            result.fold(
                onSuccess = {
                    messageRepo.saveSentMessage(
                        authRepo.currentEmail(), "", s.to, s.cc, s.subject, s.body, "", s.attachments
                    )
                    _state.value = _state.value.copy(isSending = false, sendSuccess = true)
                },
                onFailure = {
                    _state.value = _state.value.copy(isSending = false, error = it.message ?: "Failed to send")
                }
            )
        }
    }
}
