package com.synthrun.mail.data.model

data class UserLabel(
    val id: String = "",
    val name: String = "",
    val color: String = "#888",
    val description: String = "",
    val hidden: Boolean = false
) {
    companion object {
        fun fromMap(id: String, map: Map<String, Any>): UserLabel = UserLabel(
            id = id,
            name = map["name"] as? String ?: "",
            color = map["color"] as? String ?: "#888",
            description = map["description"] as? String ?: "",
            hidden = map["hidden"] as? Boolean ?: false
        )
    }
}
