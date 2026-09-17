package com.synthrun.mail.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.synthrun.mail.data.model.UserLabel
import kotlinx.coroutines.tasks.await

class LabelRepo {
    private val db = FirebaseFirestore.getInstance()

    suspend fun loadLabels(uid: String): List<UserLabel> {
        val snap = db.collection("user_settings").document(uid)
            .collection("labels").get().await()
        return snap.documents.map { UserLabel.fromMap(it.id, it.data ?: emptyMap()) }
    }

    suspend fun addLabel(uid: String, name: String, color: String, description: String) {
        db.collection("user_settings").document(uid)
            .collection("labels").add(mapOf(
                "name" to name, "color" to color,
                "description" to description, "hidden" to false
            )).await()
    }

    suspend fun updateLabel(uid: String, labelId: String, name: String, color: String, description: String, hidden: Boolean) {
        db.collection("user_settings").document(uid)
            .collection("labels").document(labelId)
            .update("name", name, "color", color, "description", description, "hidden", hidden).await()
    }

    suspend fun deleteLabel(uid: String, labelId: String) {
        db.collection("user_settings").document(uid)
            .collection("labels").document(labelId).delete().await()
    }

    suspend fun toggleLabelOnMessage(messageId: String, labelName: String, add: Boolean) {
        val ref = db.collection("mail").document(messageId)
        if (add) {
            ref.update("labels", com.google.firebase.firestore.FieldValue.arrayUnion(labelName)).await()
        } else {
            ref.update("labels", com.google.firebase.firestore.FieldValue.arrayRemove(labelName)).await()
        }
    }
}
