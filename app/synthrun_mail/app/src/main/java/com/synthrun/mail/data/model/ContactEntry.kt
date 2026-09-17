package com.synthrun.mail.data.model

data class ContactEntry(
    val email: String,
    val name: String = "",
    val count: Int = 1
)
