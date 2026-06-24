package com.synthrun.mail.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.synthrun.mail.R

private val Manrope = FontFamily(
    Font(R.font.manrope_regular, FontWeight.Normal),
    Font(R.font.manrope_medium, FontWeight.Medium),
    Font(R.font.manrope_semibold, FontWeight.SemiBold),
    Font(R.font.manrope_bold, FontWeight.Bold),
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF9C7A4F),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFF0E4D3),
    onPrimaryContainer = Color(0xFF3A2A1A),
    background = Color(0xFFFAFAF6),
    surface = Color.White,
    onBackground = Color(0xFF1C1C1A),
    onSurface = Color(0xFF1C1C1A),
    outline = Color(0xFFE0DDD5),
    surfaceVariant = Color(0xFFF5F3EF),
    onSurfaceVariant = Color(0xFF494846),
    secondary = Color(0xFF6B655E),
)
private val DarkColors = darkColorScheme(
    primary = Color(0xFFD4B48C),
    onPrimary = Color(0xFF3A2A1A),
    background = Color(0xFF101114),
    surface = Color(0xFF15171B),
    onBackground = Color(0xFFECEAE2),
    onSurface = Color(0xFFECEAE2),
    outline = Color(0xFF2A2D34),
    surfaceVariant = Color(0xFF181A1F),
    onSurfaceVariant = Color(0xFFC4C2BC),
    secondary = Color(0xFF9A9590),
)

private val AppTypography = Typography(
    displayLarge = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 57.sp),
    displayMedium = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 45.sp),
    displaySmall = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 36.sp),
    headlineLarge = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.SemiBold, fontSize = 32.sp),
    headlineMedium = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.SemiBold, fontSize = 28.sp),
    headlineSmall = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.SemiBold, fontSize = 24.sp),
    titleLarge = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Medium, fontSize = 22.sp),
    titleMedium = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Medium, fontSize = 16.sp),
    titleSmall = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Medium, fontSize = 14.sp),
    bodyLarge = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Normal, fontSize = 16.sp),
    bodyMedium = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Normal, fontSize = 14.sp),
    bodySmall = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Normal, fontSize = 12.sp),
    labelLarge = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Medium, fontSize = 14.sp),
    labelMedium = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Medium, fontSize = 12.sp),
    labelSmall = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Medium, fontSize = 11.sp),
)

@Composable
fun SynthrunTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = AppTypography,
        content = content
    )
}
