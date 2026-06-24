package com.synthrun.mail.data.repository

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.synthrun.mail.data.api.MailApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import android.util.Base64

// ── Handles file upload to backend ──
class AttachmentRepo {
    // ── Upload file via POST /upload ──
    suspend fun upload(context: Context, uri: Uri, idToken: String?): Result<Map<String, Any>> = withContext(Dispatchers.IO) {
        runCatching {
            // ── Read file name & size ──
            var name = "file"
            var size = 0L
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                cursor.moveToFirst()
                val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIdx >= 0) name = cursor.getString(nameIdx)
                val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (sizeIdx >= 0) size = cursor.getLong(sizeIdx)
            }

            // ── Read file bytes → base64 ──
            val inputStream = context.contentResolver.openInputStream(uri)
            val bytes = inputStream?.readBytes() ?: throw Exception("Cannot read file")
            inputStream.close()
            val base64 = Base64.encodeToString(bytes, Base64.DEFAULT)

            // ── Call API ──
            val type = context.contentResolver.getType(uri) ?: "application/octet-stream"
            val response = MailApi.uploadAttachment(idToken, name, type, base64).getOrThrow()

            // ── Return upload result ──
            mapOf(
                "name" to response.optString("name", name),
                "size" to response.optLong("size", size),
                "type" to response.optString("type", type),
                "fileId" to response.optString("fileId", ""),
                "url" to response.optString("url", "")
            )
        }
    }
}