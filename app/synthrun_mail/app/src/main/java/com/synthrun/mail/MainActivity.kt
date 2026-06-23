package com.synthrun.mail //ells Kotlin that this file belongs to the package: com.synthrun.mail

import android.os.Bundle                    //Bundle is used to store and pass small amounts of data between Android components. eg. - saving activity state, passing values between screens
import androidx.activity.ComponentActivity   //Your activity inherits from this. Modern Compose apps use: ComponentActivity, because it supports Jetpack Compose features.
import androidx.activity.compose.setContent  //Normally Android uses: setContentView() for for XML layouts. But compose doesnt use XML instexd setContent{}
import androidx.compose.foundation.layout.fillMaxSize  //It makes a UI element occupy the complete screen.
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier          //Modifier is used to modify UI components.
import androidx.navigation.compose.rememberNavController //Imports Navigation Controller. NavController controls movement: Login screen → Dashboard screen → profile screen
import com.synthrun.mail.navigation.NavGraph //Imports your own navigation graph.
import com.synthrun.mail.ui.theme.SynthrunTheme


// ── Single activity entry point ──
class MainActivity : ComponentActivity() {                  //mexns - my MainActivity is a ComponentActivity
    override fun onCreate(savedInstanceState: Bundle?) {   //override — overrides parent method, fun — function declaration //This function runs when your app starts.
        super.onCreate(savedInstanceState)                 //Calls the parent class's onCreate().
        setContent {                                        //This replaces XML layout. Everything inside this block is your UI.
            SynthrunTheme {
                Surface(modifier = Modifier.fillMaxSize()) {     //surfxce - A container, modifier - Changes its properties, fillMaxSize() - width = screen width height = screen height
                    NavGraph(navController = rememberNavController())  //rememberNavController()- creates a navigation controller.
                }
            }
        }
    }
}