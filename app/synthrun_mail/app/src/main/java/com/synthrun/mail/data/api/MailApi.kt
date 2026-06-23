package com.synthrun.mail.data.api

import com.synthrun.mail.core.Constants.API_BASE
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

// ── HTTP client for backend API calls (NO Node.js code needed) ──
object MailApi {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private val JSON = "application/json; charset=utf-8".toMediaType()

    // ── POST /send — send email via backend ──
    fun sendEmail(
        idToken: String?,
        to: String,
        cc: String,
        bcc: String,
        subject: String,
        body: String,
        htmlBody: String,
        attachments: List<Map<String, Any>>
    ): Result<String> = runCatching {
        val json = JSONObject().apply {
            put("to", to); put("cc", cc); put("bcc", bcc)
            put("subject", subject); put("body", body); put("htmlBody", htmlBody)
            put("attachments", attachments)
        }
        val request = Request.Builder()
            .url("$API_BASE/send")
            .post(json.toString().toRequestBody(JSON))
            .apply { idToken?.let { addHeader("Authorization", "Bearer $it") } }
            .build()
        val url = request.url.toString()
        val hasAuth = request.header("Authorization") != null
        client.newCall(request).execute().let { response ->
            val body = response.body?.string()
            if (!response.isSuccessful) {
                throw Exception("HTTP ${response.code} — $url authed=$hasAuth — body: ${body?.take(500)}")
            }
            body ?: ""
        }
    }

    // ── POST /upload — upload attachment via backend ──
    fun uploadAttachment(idToken: String?, name: String, type: String, base64: String): Result<JSONObject> = runCatching {
        val json = JSONObject().apply {
            put("name", name); put("type", type); put("data", base64)
        }
        val request = Request.Builder()
            .url("$API_BASE/upload")
            .post(json.toString().toRequestBody(JSON))
            .apply { idToken?.let { addHeader("Authorization", "Bearer $it") } }
            .build()
        client.newCall(request).execute().let { response ->
            val body = response.body?.string()
            if (!response.isSuccessful) throw Exception(body ?: "HTTP ${response.code}")
            JSONObject(body ?: "{}")
        }
    }
}