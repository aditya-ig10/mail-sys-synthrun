package com.synthrun.mail.data.model

import com.google.firebase.Timestamp       //Imports Firebase's time format.
import com.google.firebase.firestore.DocumentSnapshot    //Imports Firestore document.

// ── Matches Firestore mail document fields ──
data class Message(                   //Creates a data class called Message. A data class is mainly used to hold data.
    val id: String = "",
    val folder: String = "inbox",      //Which folder the email belongs to. defxult - inbox
    val from: String = "",            //Sender's display emxil.
    val fromName: String = "",        //Sender's display name.
    val senderEmail: String = "",
    val to: String = "",
    val cc: String = "",
    val bcc: String = "",
    val subject: String = "",
    val body: String = "",
    val htmlBody: String = "",
    val attachments: List<Attachment> = emptyList(),
    val labels: List<String> = emptyList(),
    val unread: Boolean = false,
    val flagged: Boolean = false,
    val important: Boolean = false,
    val status: String = "",
    val recipientEmail: String = "",
    val receivedAt: Timestamp? = null       ///Time email arrived. ? means nullable- it cxn hve vxlue or null
) {
    // ── Convert Firestore document to data class ──
    companion object {             //u cxn cxll Message.fromDocument(doc) without crexting Message()
        @Suppress("UNCHECKED_CAST")
        fun fromDocument(doc: DocumentSnapshot): Message {                          //Function name: fromDocument, Input: Firestore Document. Output: Message object
            val data = doc.data ?: return Message(id = doc.id)                     //If data is missing: return empty message.

            return Message(                                    //Now converting Firestore fields into Kotlin fields.
                id = doc.id,
                folder = data["folder"] as? String ?: "inbox",
                from = data["from"] as? String ?: "",
                fromName = data["fromName"] as? String ?: "",
                senderEmail = data["senderEmail"] as? String ?: "",
                to = data["to"] as? String ?: "",
                cc = data["cc"] as? String ?: "",
                bcc = data["bcc"] as? String ?: "",
                subject = data["subject"] as? String ?: "",
                body = data["body"] as? String ?: "",
                htmlBody = data["htmlBody"] as? String ?: "",
                attachments = (data["attachments"] as? List<Map<String, Any>>)
                    ?.map { Attachment.fromMap(it) } ?: emptyList(),
                labels = (data["labels"] as? List<String>) ?: emptyList(),
                unread = data["unread"] as? Boolean ?: false,
                flagged = data["flagged"] as? Boolean ?: false,
                important = data["important"] as? Boolean ?: false,
                status = data["status"] as? String ?: "",
                recipientEmail = data["recipientEmail"] as? String ?: "",
                receivedAt = data["receivedAt"] as? Timestamp
            )
        }
    }
}