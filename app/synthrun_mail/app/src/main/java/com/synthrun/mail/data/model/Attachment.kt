package com.synthrun.mail.data.model

// ── Attachment file info (from backend upload) ──
data class Attachment(
    val name: String = "",
    val size: Long = 0,
    val type: String = "",
    val fileId: String = "",
    val url: String = ""
) {
    companion object {
        fun fromMap(map: Map<String, Any>): Attachment = Attachment(
            name = map["name"] as? String ?: "",
            size = (map["size"] as? Long) ?: 0,
            type = map["type"] as? String ?: "",
            fileId = map["fileId"] as? String ?: "",
            url = map["url"] as? String ?: ""
        )
    }
}