# 记账本 Android 外壳（JiZhang）

把纯前端记账本（`../index.html` 那一套）包成原生 Android App 的工程。
网页资源以内置资产形式打进 APK，**断网可用**，数据全部落在 App 私有目录的 IndexedDB 里。

## 结构

```
app/src/main/assets/www/     网页资源（从上一级 JiZhang 工程复制而来）
app/src/main/java/.../MainActivity.java   WebView 外壳 + 原生桥
app/src/main/res/            图标（矢量 ¥）、主题、应用名
.github/workflows/build.yml  GitHub Actions 自动出 APK
```

## 怎么出 APK

推到 `main` 分支就会自动编译，产物有两个来源：

- **Release 页**：`https://github.com/chenziangloves/jizhang-android/releases` —— 手机浏览器直接下载安装，最方便
- **Actions 产物**：每次运行的 Artifacts 里 zip 包

## 改网页代码之后怎么同步

网页源码的**唯一真源**仍是上一级目录的 JiZhang 工程（`index.html`、`css/`、`js/`）。
改完必须复制过来，否则 APK 里还是旧页面：

```bash
cd C:\Users\25462\WorkBuddy\JiZhang
cp index.html manifest.webmanifest sw.js android/app/src/main/assets/www/
cp css/style.css            android/app/src/main/assets/www/css/
cp js/db.js js/app.js       android/app/src/main/assets/www/js/
cp icons/icon.svg           android/app/src/main/assets/www/icons/
git -C android add -A && git -C android commit -m "sync web assets" && git -C android push
```

复制完要确认 `android/app/src/main/assets/www/index.html` 里仍有这一行（在 `</body>` 前）：

```html
<script src="js/android-bridge.js"></script>
```

丢了这行「导出备份」按钮就存不到手机「下载」目录。

## 技术要点

- 无 appcompat、无 Kotlin，纯 `android.app.Activity` + Java，减少工具链变量
- `WebViewAssetLoader` 把 `assets/` 挂到 `https://appassets.androidplatform.net/`，从而有安全来源、能用 IndexedDB
- `AndroidBridge.saveFile(name, base64)`：把导出的 JSON 写进手机「下载」目录（API 29+ 走 MediaStore，免权限）
- 返回键先关页面弹层，无弹层时按两次退出
- minSdk 26 / targetSdk 34 / AGP 8.5.2 / Gradle 8.9 / JDK 17
