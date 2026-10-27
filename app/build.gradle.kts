import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
}

// 本地与 CI 共用同一套签名配置：
// - 本地：android/keystore.properties（已被 .gitignore 排除）
// - CI  ：workflow 构建前用 GitHub Secrets 现场生成同名文件
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) {
        FileInputStream(keystorePropsFile).use { load(it) }
    }
}
val hasSigning = keystorePropsFile.exists()

android {
    namespace = "com.chenziang.jizhang"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.chenziang.jizhang"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "1.1"
    }

    signingConfigs {
        if (hasSigning) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            if (hasSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
}
