import java.net.URL
import java.security.MessageDigest
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// The one permanent release identity. Never committed: local builds read the gitignored
// `gen/android/keystore.properties`, CI reads ANDROID_KEYSTORE_* environment variables.
// Without either, release builds come out unsigned. See docs/RELEASING.md.
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}
fun signingValue(property: String, env: String): String? =
    keystoreProperties.getProperty(property) ?: System.getenv(env)
val releaseStoreFile = signingValue("storeFile", "ANDROID_KEYSTORE_PATH")
val releaseStorePassword = signingValue("password", "ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingValue("keyAlias", "ANDROID_KEY_ALIAS")

// Speaker recognition dependencies are reproducible and checked before use. They are
// downloaded during Android builds, not during dictation, and stay out of git.
val sherpaAar = layout.buildDirectory.file("speaker/vendor/sherpa-onnx-2.0.1.aar")
val speakerModels = layout.buildDirectory.dir("speaker/assets")
val speakerModelName = "3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx"
val speakerModel = speakerModels.map { it.file(speakerModelName) }

val prepareSpeakerModel = tasks.register("prepareSpeakerModel") {
    outputs.file(sherpaAar)
    outputs.file(speakerModel)
    doLast {
        fun downloadVerified(url: String, sha256: String, destination: java.io.File) {
            fun digest(file: java.io.File): String {
                val hash = MessageDigest.getInstance("SHA-256")
                file.inputStream().buffered().use { input ->
                    val chunk = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(chunk)
                        if (n < 0) break
                        hash.update(chunk, 0, n)
                    }
                }
                return hash.digest().joinToString("") { "%02x".format(it) }
            }
            if (destination.exists() && digest(destination) == sha256) return
            destination.parentFile.mkdirs()
            val temporary = java.io.File(destination.absolutePath + ".partial")
            try {
                val connection = URL(url).openConnection()
                connection.connectTimeout = 30_000
                connection.readTimeout = 120_000
                connection.getInputStream().use { input ->
                    temporary.outputStream().buffered().use { output -> input.copyTo(output) }
                }
                if (digest(temporary) != sha256) {
                    throw IllegalStateException("Speaker model dependency checksum mismatch: ${destination.name}")
                }
                Files.move(temporary.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING)
            } finally {
                temporary.delete()
            }
        }
        downloadVerified(
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/sherpa-onnx-2.0.1.aar",
            "a8d09d1d32f3eb8520482c6d3d43fae674681c5b050385967c70a3c2c9bf0ee7",
            sherpaAar.get().asFile,
        )
        downloadVerified(
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/$speakerModelName",
            "c4947caf150b8502fdd75bbe4089b971ab1ec42e90ee3ba547faca2cde44d9ee",
            speakerModel.get().asFile,
        )
    }
}

android {
    compileSdk = 37
    namespace = "com.personal.voiceapp"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.personal.voiceapp"
        minSdk = 24
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (releaseStoreFile != null && releaseStorePassword != null && releaseKeyAlias != null) {
            create("release") {
                storeFile = file(releaseStoreFile)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseStorePassword
            }
        }
    }
    buildTypes {
        getByName("debug") {
            // PR preview installs beside the release app without replacing its signing identity or data.
            applicationIdSuffix = ".preview"
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfigs.findByName("release")?.let { signingConfig = it }
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
    sourceSets.getByName("main").assets.srcDir(speakerModels)
}

// Build model and AAR before Java/Kotlin compilation or asset merging.
tasks.matching { it.name == "preBuild" }.configureEach { dependsOn(prepareSpeakerModel) }

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation(files(sherpaAar))
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // Assistant Camera Context: photo + 1 FPS frames with a visible preview.
    val cameraX = "1.4.2"
    implementation("androidx.camera:camera-core:$cameraX")
    implementation("androidx.camera:camera-camera2:$cameraX")
    implementation("androidx.camera:camera-lifecycle:$cameraX")
    implementation("androidx.camera:camera-view:$cameraX")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
