# 记账本 Android 外壳（JiZhang）

把纯前端记账本（上一级 `index.html` 那一套）包成原生 Android App。
网页资源以内置资产打进 APK，**断网可用**，账本数据保存在 App 私有目录的 IndexedDB 里。

## 结构

```
app/src/main/assets/www/                  网页资源（由 tools/sync_android.py 同步）
app/src/main/java/.../MainActivity.java   WebView 外壳 + 原生桥
app/src/main/res/                         图标（自适应 + 5 档密度 PNG）、主题、应用名
.github/workflows/build.yml              GitHub Actions 自动出 APK
```

## 下载地址（固定不变）

```
https://github.com/chenziangloves/jizhang-android/releases/latest/download/jizhang-latest.apk
```

这个链接永远指向**最新一版**已签名安装包，可以直接存到手机浏览器书签。

## 版本号规则（关系到能不能「覆盖安装」）

| 场景 | versionCode | versionName |
| --- | --- | --- |
| CI 构建 | `1000 + 构建序号`（自动递增） | `1.2.<构建序号>` |
| 本地构建 | 12（默认值） | `1.2.0` |

手机会拿新包的 versionCode 和已装包比：**必须更大**才允许覆盖升级；再加上包名相同、签名相同，数据就原地保留，不用卸载。

签名密钥是固定的（`../secrets/jizhang-release.jks`，30 年有效期）。**一旦换密钥，所有人都必须卸载重装**，所以这个文件要备份好。

## 改完网页代码怎么出 APK

网页源码的唯一真源是上一级目录。改完先同步，再提交推送：

```bash
cd C:\Users\25462\WorkBuddy\JiZhang
python tools/sync_android.py                     # 或点工作台的「同步到安卓工程」
git -C android add -A
git -C android commit -m "sync: 说明"
git -C android push
```

推送后 Actions 自动编译，2 分钟左右在 Releases 出新的 `jizhang-latest.apk`。

## 原生桥（JS 侧 `window.JZ`，定义在 `js/native.js`）

| 方法 | 作用 |
| --- | --- |
| `JZ.available()` | 是否在 App 里（浏览器为 `false`，所有能力自动降级） |
| `JZ.info()` | `{versionName, versionCode, backupAt, ...}` |
| `JZ.autoBackup(json)` | 写自动备份（数据一变就触发，节流 4 秒） |
| `JZ.loadBackup()` | 读回最近一次自动备份 |
| `JZ.openUrl(url)` | 用系统浏览器打开（更新下载用） |
| `JZ.showToast(msg)` | 原生 Toast |

底层 Java 接口：`appInfo` / `autoBackup` / `loadBackup` / `openUrl` / `saveFile` / `toast`。

## 自动备份落在哪

1. `Android/data/com.chenziang.jizhang/files/backup/jizhang-autobackup.json`（随 App 更新保留）
2. `下载/记账本备份/jizhang-autobackup.json`（**卸载 App 也不丢**）

App 启动时如果发现本地账本是空的、而上面有备份，会弹窗问「要恢复吗」。

## 技术要点

- 无 appcompat、无 Kotlin，纯 `android.app.Activity` + Java，减少工具链变量
- `WebViewAssetLoader` 把 `assets/` 挂到 `https://appassets.androidplatform.net/`，从而有安全来源、能用 IndexedDB
- 入口 URL 带 `?v=<versionName>`，每次升级强制重读包内资源，避免 WebView 缓存让新版跑旧界面（IndexedDB 按 origin 存，不受影响）
- `saveFile(name, base64)`：导出 JSON 到手机「下载」目录（API 29+ 走 MediaStore，免权限）
- 返回键先关页面弹层，无弹层时按两次退出
- minSdk 26 / targetSdk 34 / AGP 8.5.2 / Gradle 8.9 / JDK 17
