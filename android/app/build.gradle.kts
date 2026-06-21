plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun prop(name: String, default: String): String =
    (project.findProperty(name) as String?) ?: default

android {
    namespace = "com.ggis.uavcompanion"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.ggis.uavcompanion"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        buildConfigField("String", "SUPABASE_URL", "\"${prop("SUPABASE_URL", "https://your-domain")}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${prop("SUPABASE_ANON_KEY", "")}\"")
        buildConfigField("String", "STREAM_HOST", "\"${prop("STREAM_HOST", "your-domain")}\"")
        buildConfigField("String", "STREAM_SCHEME", "\"${prop("STREAM_SCHEME", "rtmp")}\"")
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Screen capture (MediaProjection) → RTMP/SRT encoder.
    // github.com/pedroSG94/RootEncoder
    implementation("com.github.pedroSG94.RootEncoder:library:2.7.5")
}
