package com.synthrun.mail.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.synthrun.mail.data.api.MailApi
import com.synthrun.mail.data.model.Message
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

// ── Firestore read/write + API send ──
class MessageRepo {
    private val db = FirebaseFirestore.getInstance()

    // ── Observe messages for current user (real-time) ──
    fun observeMessages(email: String): Flow<List<Message>> = callbackFlow {
        val listener = db.collection("mail")
            .whereEqualTo("recipientEmail", email)
            .orderBy("receivedAt", Query.Direction.DESCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) return@addSnapshotListener
                val messages = snapshot?.documents?.map { Message.fromDocument(it) } ?: emptyList()
                trySend(messages)
            }
        awaitClose { listener.remove() }
    }

    // ── Save sent message to Firestore ──
    suspend fun saveSentMessage(email: String, name: String, to: String, cc: String, subject: String, body: String, htmlBody: String, attachments: List<Map<String, Any>>) {
        val data = hashMapOf(
            "folder" to "sent", "from" to email, "fromName" to name,
            "senderEmail" to email, "to" to to, "cc" to cc,
            "subject" to subject, "body" to body, "htmlBody" to htmlBody,
            "attachments" to attachments, "unread" to false, "flagged" to false,
            "important" to false, "recipientEmail" to email,
            "receivedAt" to com.google.firebase.Timestamp.now()
        )
        db.collection("mail").add(data).await()
    }

    // ── Update message folder (archive, trash, etc.) ──
    suspend fun updateFolder(messageId: String, folder: String) {
        db.collection("mail").document(messageId).update("folder", folder).await()
    }

    // ── Update message flags ──
    suspend fun updateFlag(messageId: String, flagged: Boolean) {
        db.collection("mail").document(messageId).update("flagged", flagged).await()
    }
    suspend fun updateImportant(messageId: String, important: Boolean) {
        db.collection("mail").document(messageId).update("important", important).await()
    }
    suspend fun markRead(messageId: String) {
        db.collection("mail").document(messageId).update("unread", false).await()
    }

    // ── Delete message ──
    suspend fun deleteMessage(messageId: String) {
        db.collection("mail").document(messageId).delete().await()
    }

    // ── Send via backend API ──
    suspend fun sendViaApi(idToken: String?, to: String, cc: String, bcc: String, subject: String, body: String, htmlBody: String, attachments: List<Map<String, Any>>): Result<String> =
        MailApi.sendEmail(idToken, to, cc, bcc, subject, body, htmlBody, attachments)
}