package com.synthrun.mail.data.repository

import android.content.Context
import android.content.SharedPreferences
import com.google.firebase.firestore.FirebaseFirestore
import com.synthrun.mail.data.model.ContactEntry
import kotlinx.coroutines.tasks.await
import org.json.JSONArray

class ContactRepo(private val context: Context) {
    private val db = FirebaseFirestore.getInstance()
    private val prefs: SharedPreferences = context.getSharedPreferences("synthrun_contacts", Context.MODE_PRIVATE)

    fun loadLocal(): List<ContactEntry> {
        val raw = prefs.getString("contacts", "[]") ?: "[]"
        val arr = JSONArray(raw)
        return (0 until arr.length()).map { i ->
            val obj = arr.getJSONObject(i)
            ContactEntry(
                email = obj.optString("email", ""),
                name = obj.optString("name", ""),
                count = obj.optInt("count", 1)
            )
        }.sortedByDescending { it.count }
    }

    private fun saveLocal(contacts: List<ContactEntry>) {
        val arr = JSONArray()
        contacts.forEach { c ->
            arr.put(org.json.JSONObject().apply {
                put("email", c.email)
                put("name", c.name)
                put("count", c.count)
            })
        }
        prefs.edit().putString("contacts", arr.toString()).apply()
    }

    suspend fun buildFromMessages(uid: String) {
        try {
            val snap = db.collection("mail").whereEqualTo("uid", uid).get().await()
            val map = mutableMapOf<String, Pair<String, Int>>()
            for (doc in snap.documents) {
                val d = doc.data ?: continue
                // from field
                val from = d["from"] as? String ?: ""
                val fromName = d["fromName"] as? String ?: d["senderName"] as? String ?: ""
                val senderEmail = d["senderEmail"] as? String ?: ""
                if (from.isNotBlank() && from != uid) map[from.lowercase()] = fromName to (map[from.lowercase()]?.second?.plus(1) ?: 1)
                if (senderEmail.isNotBlank() && senderEmail != uid) map[senderEmail.lowercase()] = fromName to (map[senderEmail.lowercase()]?.second?.plus(1) ?: 1)
                // to, cc, bcc
                listOf("to", "cc", "bcc").forEach { field ->
                    val valStr = d[field] as? String ?: ""
                    valStr.split(",").map { it.trim() }.filter { it.isNotBlank() && it.contains("@") }.forEach { addr ->
                        val clean = addr.lowercase().trim()
                        if (clean != uid) map[clean] = "" to (map[clean]?.second?.plus(1) ?: 1)
                    }
                }
            }
            val entries = map.map { ContactEntry(email = it.key, name = it.value.first, count = it.value.second) }
                .sortedByDescending { it.count }
            saveLocal(entries)
        } catch (_: Exception) {}
    }

    fun search(query: String): List<ContactEntry> {
        if (query.isBlank()) return loadLocal().take(10)
        val q = query.lowercase()
        return loadLocal().filter { it.email.contains(q) || it.name.lowercase().contains(q) }.take(10)
    }

    fun addEntry(email: String, name: String = "") {
        val list = loadLocal().toMutableList()
        val existing = list.indexOfFirst { it.email == email.lowercase() }
        if (existing >= 0) {
            list[existing] = list[existing].copy(count = list[existing].count + 1, name = name.ifBlank { list[existing].name })
        } else {
            list.add(ContactEntry(email = email.lowercase(), name = name, count = 1))
        }
        saveLocal(list)
    }
}
