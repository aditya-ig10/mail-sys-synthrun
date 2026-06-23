package com.synthrun.mail.core


object Constants {       //object creates a singleton, Only ONE copy of this object exists in the whole app.
    // ── Backend server URL (deployed on Render) ──
    const val API_BASE = "https://mail-sys-synthrun.onrender.com"                      //This stores your backend URL. val- Means read-only variable.
    const val ALLOWED_DOMAIN = "synthrun.site"            //Meaning your app probably only allows: abc@synthrun.site nd not abc@gmail.com

    // ── Folder definitions (matches web app exactly) ──
    val FOLDERS = listOf(              //listOf() creates a read-only list.
        "inbox", "unread", "sent", "outbox", "archived",
        "flagged", "important", "drafts", "trash", "clients", "spam"
    )

    // ── Folders excluded from inbox view ──
    val EXCLUDED_FROM_INBOX = setOf("sent", "drafts", "trash", "outbox", "spam")
}