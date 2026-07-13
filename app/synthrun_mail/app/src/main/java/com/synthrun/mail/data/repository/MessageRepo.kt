package com.synthrun.mail.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.synthrun.mail.data.api.MailApi
import com.synthrun.mail.data.model.Message
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

class MessageRepo {
    private val db = FirebaseFirestore.getInstance()

    fun observeMessages(email: String): Flow<List<Message>> = callbackFlow {
        val listener = db.collection("mail")
            .whereEqualTo("recipientEmail", email)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    android.util.Log.e("MessageRepo", "observeMessages error", error)
                    return@addSnapshotListener
                }
                val messages = snapshot?.documents?.map { Message.fromDocument(it) }?.sortedByDescending { it.receivedAt?.toDate()?.time ?: 0L } ?: emptyList()
                trySend(messages)
            }
        awaitClose { listener.remove() }
    }

    // ── Sent message ──
    suspend fun saveSentMessage(email: String, name: String, to: String, cc: String, subject: String, body: String, htmlBody: String, attachments: List<Map<String, Any>>) {
        val data = hashMapOf(
            "folder" to "sent", "from" to email, "fromName" to name,
            "senderEmail" to email, "to" to to, "cc" to cc,
            "subject" to subject, "body" to body, "htmlBody" to htmlBody,
            "attachments" to attachments, "unread" to false, "flagged" to false,
            "important" to false, "recipientEmail" to email,
            "receivedAt" to Timestamp.now()
        )
        db.collection("mail").add(data).await()
    }

    // ── Outbox ──
    suspend fun saveOutbox(email: String, name: String, to: String, cc: String, bcc: String, subject: String, body: String, htmlBody: String, attachments: List<Map<String, Any>>): String? {
        val data: Map<String, Any> = mapOf(
            "folder" to "outbox", "status" to "sending",
            "from" to email, "fromName" to name, "senderEmail" to email,
            "to" to to, "cc" to cc, "bcc" to bcc,
            "subject" to subject, "body" to body, "htmlBody" to htmlBody,
            "attachments" to attachments,
            "senderUid" to "", "recipientEmail" to email,
            "unread" to false, "flagged" to false, "important" to false,
            "receivedAt" to Timestamp.now()
        )
        return try {
            db.collection("mail").add(data).await().id
        } catch (_: Exception) { null }
    }

    suspend fun updateStatus(messageId: String, status: String) {
        db.collection("mail").document(messageId).update("status", status).await()
    }

    // ── Drafts ──
    suspend fun saveDraft(email: String, name: String, to: String, cc: String, bcc: String, subject: String, body: String, htmlBody: String, existingDraftId: String?): String? {
        val data: Map<String, Any> = mapOf(
            "folder" to "draft", "from" to email, "fromName" to name,
            "senderEmail" to email, "to" to to, "cc" to cc, "bcc" to bcc,
            "subject" to subject, "body" to body, "htmlBody" to htmlBody,
            "senderUid" to "", "recipientEmail" to email,
            "unread" to false, "flagged" to false, "important" to false,
            "updatedAt" to Timestamp.now()
        )
        return try {
            if (existingDraftId != null) {
                db.collection("mail").document(existingDraftId).update(data).await()
                existingDraftId
            } else {
                db.collection("mail").add(data).await().id
            }
        } catch (_: Exception) { null }
    }

    suspend fun loadDraft(email: String): Message? {
        return try {
            val snap = db.collection("mail")
                .whereEqualTo("recipientEmail", email)
                .whereEqualTo("folder", "draft")
                .get().await()
            val doc = snap.documents.firstOrNull() ?: return null
            Message.fromDocument(doc)
        } catch (_: Exception) { null }
    }

    // ── Actions ──
    suspend fun updateFolder(messageId: String, folder: String) {
        db.collection("mail").document(messageId).update("folder", folder).await()
    }

    suspend fun updateFlag(messageId: String, flagged: Boolean) {
        db.collection("mail").document(messageId).update("flagged", flagged).await()
    }

    suspend fun updateImportant(messageId: String, important: Boolean) {
        db.collection("mail").document(messageId).update("important", important).await()
    }

    suspend fun markRead(messageId: String) {
        db.collection("mail").document(messageId).update("unread", false).await()
    }

    suspend fun markUnread(messageId: String) {
        db.collection("mail").document(messageId).update("unread", true).await()
    }

    suspend fun deleteMessage(messageId: String) {
        db.collection("mail").document(messageId).delete().await()
    }

    // ── Send via backend API ──
    suspend fun sendViaApi(idToken: String?, to: String, cc: String, bcc: String, subject: String, body: String, htmlBody: String, attachments: List<Map<String, Any>>): Result<String> =
        MailApi.sendEmail(idToken, to, cc, bcc, subject, body, htmlBody, attachments)
}
