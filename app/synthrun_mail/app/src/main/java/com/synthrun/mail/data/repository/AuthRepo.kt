package com.synthrun.mail.data.repository

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.auth.AuthResult
import com.synthrun.mail.core.Constants.ALLOWED_DOMAIN
import kotlinx.coroutines.tasks.await

// ── Wraps Firebase Auth operations ──
class AuthRepo {
    private val auth = FirebaseAuth.getInstance()

    fun currentUser() = auth.currentUser
    fun currentEmail() = auth.currentUser?.email?.trim()?.lowercase() ?: ""
    fun isSignedIn(): Boolean = auth.currentUser != null

    // ── Check email belongs to our domain ──
    fun isAllowedEmail(email: String): Boolean =
        email.trim().lowercase().endsWith("@$ALLOWED_DOMAIN")

    // ── Email/password sign in ──
    suspend fun signIn(email: String, password: String): AuthResult =
        auth.signInWithEmailAndPassword(email.trim(), password).await()

    // ── Google sign in ──
    suspend fun signInWithGoogle(idToken: String): AuthResult =
        auth.signInWithCredential(GoogleAuthProvider.getCredential(idToken, null)).await()

    // ── Get Firebase ID token for API calls ──
    suspend fun getIdToken(): String? =
        currentUser()?.getIdToken(false)?.await()?.token

    // ── Sign out ──
    fun signOut() = auth.signOut()
}