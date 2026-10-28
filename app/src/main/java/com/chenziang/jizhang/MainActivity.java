package com.chenziang.jizhang;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import javax.net.ssl.SSLException;

public class MainActivity extends Activity {

    private static final int REQ_FILE_CHOOSER = 1001;
    private static final String START_URL =
            "https://appassets.androidplatform.net/assets/www/index.html";
    /** 自动备份文件名：同时存在于 App 私有目录和「下载/记账本备份」里，卸载重装也能捞回来 */
    private static final String AUTO_BACKUP_NAME = "jizhang-autobackup.json";
    /** 备份历史里最多保留多少份快照 */
    private static final int BACKUP_KEEP = 10;
    /** 距上次快照超过这个时长就再留一份（6 小时） */
    private static final long SNAPSHOT_GAP_MS = 6L * 60L * 60L * 1000L;
    private static final String PREF_NAME = "jizhang";
    private static final String KEY_LAST_SNAPSHOT = "lastSnapshotAt";

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private long lastBackPress = 0L;

    /** 「检查更新」的异步结果表：JS 侧靠轮询取回，避免在主线程做网络请求 */
    private final Map<String, String> updateResults = new ConcurrentHashMap<>();
    /** 更新包下载进度（0-100，-1 表示失败），JS 侧轮询展示 */
    private volatile int downloadProgress = -1;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.WHITE);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new NativeBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e) {
                    pendingFileCallback = null;
                    Toast.makeText(MainActivity.this, "没有找到可用的文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl(startUrl());
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    /**
     * 带上版本号的入口地址：每次升级都会强制重新读一遍包内资源，
     * 避免 WebView 缓存让新版本还在跑旧界面。数据按 origin 存，不受影响。
     */
    private String startUrl() {
        String v = "0";
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (pi.versionName != null && !pi.versionName.isEmpty()) v = pi.versionName;
        } catch (Exception ignored) {
        }
        return START_URL + "?v=" + Uri.encode(v);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (pendingFileCallback == null) {
                super.onActivityResult(requestCode, resultCode, data);
                return;
            }
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            pendingFileCallback.onReceiveValue(results);
            pendingFileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /**
     * 返回键：先关掉页面里的弹层，没有弹层时按两次退出。
     */
    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        String js = "(function(){"
                + "function isOpen(el){if(!el)return false;var cs=getComputedStyle(el);"
                + "return cs.display!=='none'&&cs.visibility!=='hidden'&&parseFloat(cs.opacity||'1')>0.01;}"
                + "var dlg=document.getElementById('dialog-backdrop');"
                + "var sht=document.getElementById('sheet-backdrop');"
                + "if(isOpen(dlg)){dlg.click();return 'dlg';}"
                + "if(isOpen(sht)){sht.click();return 'sht';}"
                + "return '';})()";
        webView.evaluateJavascript(js, value -> {
            boolean handled = value != null && (value.contains("dlg") || value.contains("sht"));
            if (handled) {
                return;
            }
            long now = System.currentTimeMillis();
            if (now - lastBackPress < 2000L) {
                moveTaskToBack(true);
            } else {
                lastBackPress = now;
                Toast.makeText(MainActivity.this, "再按一次返回键退出", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private class NativeBridge {

        @JavascriptInterface
        public void toast(final String message) {
            runOnUiThread(() ->
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void saveFile(final String fileName, final String base64) {
            String result;
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                String name = (fileName == null || fileName.trim().isEmpty())
                        ? "jizhang-backup.json" : fileName.trim();
                result = "备份已保存到 " + writeToDownloads(name, bytes);
            } catch (Exception e) {
                result = "保存失败：" + e;
            }
            final String msg = result;
            runOnUiThread(() ->
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
        }

        private String writeToDownloads(String name, byte[] bytes) throws Exception {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContentResolver()
                        .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) {
                    throw new IllegalStateException("无法创建文件");
                }
                OutputStream os = getContentResolver().openOutputStream(uri);
                if (os == null) {
                    throw new IllegalStateException("无法打开文件");
                }
                os.write(bytes);
                os.close();
                return "下载/" + name;
            }
            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (!dir.exists() && !dir.mkdirs()) {
                throw new IllegalStateException("无法创建下载目录");
            }
            File target = new File(dir, name);
            FileOutputStream fos = new FileOutputStream(target);
            fos.write(bytes);
            fos.close();
            return target.getAbsolutePath();
        }

        /* ---------- 版本信息 ---------- */

        @JavascriptInterface
        public String appInfo() {
            JSONObject o = new JSONObject();
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                o.put("versionName", pi.versionName == null ? "" : pi.versionName);
                o.put("versionCode", pi.versionCode);
                o.put("packageName", getPackageName());
                o.put("sdk", Build.VERSION.SDK_INT);
                File f = autoBackupFile();
                o.put("backupAt", f.exists() ? f.lastModified() : 0L);
                o.put("backupBytes", f.exists() ? f.length() : 0L);
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        /* ---------- 自动备份 ---------- */

        @JavascriptInterface
        public void autoBackup(final String json) {
            if (json == null || json.length() < 20) return;
            final byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            final String text = json;
            new Thread(() -> {
                try {
                    writeAutoBackup(text, bytes);
                } catch (Exception ignored) {
                }
                try {
                    mirrorBackupToDownloads(bytes);
                } catch (Exception ignored) {
                }
            }).start();
        }

        /**
         * 两份备份一起维护：
         *   backup/jizhang-autobackup.json  —— 永远是最新一份，恢复时直接读它
         *   backup/history/*.json           —— 历史快照，最多留 BACKUP_KEEP 份
         *
         * 什么时候留快照？只有两种情况，避免每记一笔就堆一个文件：
         *   1) 记录条数比上次备份明显变少 —— 说明刚发生了删除/清空，
         *      这时候先把「删之前」那份存成快照，误删才有得救；
         *   2) 距离上一份快照超过 6 小时 —— 当作时间机器，最多丢半天。
         */
        private void writeAutoBackup(String text, byte[] bytes) throws Exception {
            File latest = autoBackupFile();
            int newCount = countRecords(text);
            int oldCount = latest.exists() ? countRecords(readFileQuiet(latest)) : -1;

            long now = System.currentTimeMillis();
            long lastSnap = prefs().getLong(KEY_LAST_SNAPSHOT, 0L);
            boolean shrunk = oldCount >= 0 && newCount >= 0 && newCount < oldCount;
            boolean stale = now - lastSnap > SNAPSHOT_GAP_MS;

            if (latest.exists() && (shrunk || stale)) {
                snapshotFrom(latest, now);
                prefs().edit().putLong(KEY_LAST_SNAPSHOT, now).apply();
                pruneSnapshots();
            }

            File tmp = new File(latest.getAbsolutePath() + ".tmp");
            FileOutputStream fos = new FileOutputStream(tmp);
            fos.write(bytes);
            fos.flush();
            fos.close();
            if (latest.exists()) {
                //noinspection ResultOfMethodCallIgnored
                latest.delete();
            }
            if (!tmp.renameTo(latest)) {
                FileOutputStream f2 = new FileOutputStream(latest);
                f2.write(bytes);
                f2.close();
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
            }
        }

        private SharedPreferences prefs() {
            return getSharedPreferences(PREF_NAME, MODE_PRIVATE);
        }

        private File backupDir() {
            File base = getExternalFilesDir(null);
            if (base == null) base = getFilesDir();
            File dir = new File(base, "backup");
            if (!dir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
            }
            return dir;
        }

        private File snapshotDir() {
            File dir = new File(backupDir(), "history");
            if (!dir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
            }
            return dir;
        }

        /** 从备份 JSON 里数记录条数，解析不了返回 -1 */
        private int countRecords(String json) {
            if (json == null || json.length() < 20) return -1;
            try {
                JSONArray a = new JSONObject(json).optJSONArray("records");
                return a == null ? 0 : a.length();
            } catch (Exception e) {
                return -1;
            }
        }

        private String readFileQuiet(File f) {
            try {
                if (f == null || !f.exists() || f.length() < 3) return null;
                FileInputStream fis = new FileInputStream(f);
                return readStream(fis);
            } catch (Exception e) {
                return null;
            }
        }

        private void snapshotFrom(File src, long at) {
            try {
                File dst = new File(snapshotDir(), "jizhang-" + stamp(at) + ".json");
                if (dst.exists()) return;
                FileInputStream in = new FileInputStream(src);
                FileOutputStream out = new FileOutputStream(dst);
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                in.close();
                out.close();
            } catch (Exception ignored) {
            }
        }

        private String stamp(long at) {
            java.text.SimpleDateFormat f =
                    new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US);
            return f.format(new java.util.Date(at));
        }

        private void pruneSnapshots() {
            File[] fs = snapshotDir().listFiles();
            if (fs == null || fs.length <= BACKUP_KEEP) return;
            java.util.Arrays.sort(fs, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            for (int i = 0; i < fs.length - BACKUP_KEEP; i++) {
                //noinspection ResultOfMethodCallIgnored
                fs[i].delete();
            }
        }

        /** 列出所有备份：第一条永远是最新那份，其余是历史快照，新的在前 */
        @JavascriptInterface
        public String listSnapshots() {
            JSONArray arr = new JSONArray();
            try {
                File latest = autoBackupFile();
                if (latest.exists()) {
                    JSONObject o = new JSONObject();
                    o.put("name", "latest");
                    o.put("at", latest.lastModified());
                    o.put("records", countRecords(readFileQuiet(latest)));
                    o.put("bytes", latest.length());
                    arr.put(o);
                }
                File[] fs = snapshotDir().listFiles();
                if (fs != null) {
                    java.util.Arrays.sort(fs, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
                    for (File f : fs) {
                        if (!f.getName().endsWith(".json")) continue;
                        JSONObject o = new JSONObject();
                        o.put("name", f.getName());
                        o.put("at", f.lastModified());
                        o.put("records", countRecords(readFileQuiet(f)));
                        o.put("bytes", f.length());
                        arr.put(o);
                    }
                }
            } catch (Exception ignored) {
            }
            return arr.toString();
        }

        /** 立刻把当前这份备份钉成历史快照。恢复旧备份前调用，保证当前状态也能退回来 */
        @JavascriptInterface
        public void pinSnapshot() {
            try {
                File latest = autoBackupFile();
                if (!latest.exists()) return;
                long now = System.currentTimeMillis();
                snapshotFrom(latest, now);
                prefs().edit().putLong(KEY_LAST_SNAPSHOT, now).apply();
                pruneSnapshots();
            } catch (Exception ignored) {
            }
        }

        /** 读某一份备份的内容，name 传 "latest" 读最新 */
        @JavascriptInterface
        public String loadSnapshot(String name) {
            try {
                if (name == null || name.isEmpty() || "latest".equals(name)) {
                    return readFileQuiet(autoBackupFile());
                }
                // 只认文件名，挡住 ../ 之类的路径穿越
                if (name.contains("..") || name.contains("/") || name.contains("\\")) return null;
                return readFileQuiet(new File(snapshotDir(), name));
            } catch (Exception e) {
                return null;
            }
        }

        @JavascriptInterface
        public String loadBackup() {
            try {
                File f = autoBackupFile();
                if (f.exists() && f.length() > 2) {
                    FileInputStream fis = new FileInputStream(f);
                    String s = readStream(fis);
                    if (s != null && s.length() > 2) return s;
                }
            } catch (Exception ignored) {
            }
            try {
                String s = readBackupFromDownloads();
                if (s != null && s.length() > 2) return s;
            } catch (Exception ignored) {
            }
            return "";
        }

        private File autoBackupFile() {
            return new File(backupDir(), AUTO_BACKUP_NAME);
        }

        /** 同时往「下载/记账本备份」放一份，卸载 App 也不会丢 */
        private void mirrorBackupToDownloads(byte[] bytes) throws Exception {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
            ContentResolver cr = getContentResolver();
            Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            try {
                cr.delete(collection,
                        MediaStore.MediaColumns.DISPLAY_NAME + "=?",
                        new String[]{AUTO_BACKUP_NAME});
            } catch (Exception ignored) {
            }
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, AUTO_BACKUP_NAME);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/记账本备份");
            Uri uri = cr.insert(collection, cv);
            if (uri == null) return;
            OutputStream os = cr.openOutputStream(uri, "wt");
            if (os == null) return;
            os.write(bytes);
            os.flush();
            os.close();
        }

        private String readBackupFromDownloads() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null;
            try {
                ContentResolver cr = getContentResolver();
                Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                String[] proj = {MediaStore.MediaColumns._ID};
                Cursor c = cr.query(collection, proj,
                        MediaStore.MediaColumns.DISPLAY_NAME + "=?",
                        new String[]{AUTO_BACKUP_NAME},
                        MediaStore.MediaColumns.DATE_MODIFIED + " DESC");
                if (c == null) return null;
                try {
                    if (!c.moveToFirst()) return null;
                    Uri uri = ContentUris.withAppendedId(collection, c.getLong(0));
                    InputStream in = cr.openInputStream(uri);
                    if (in == null) return null;
                    return readStream(in);
                } finally {
                    c.close();
                }
            } catch (Exception ignored) {
                return null;
            }
        }

        private String readStream(InputStream in) throws Exception {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            in.close();
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        }

        /* ---------- 打开外链（下载更新包） ---------- */

        @JavascriptInterface
        public void openUrl(final String url) {
            if (url == null || url.isEmpty()) return;
            runOnUiThread(() -> {
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "没有找到可用的浏览器", Toast.LENGTH_SHORT).show();
                }
            });
        }

        /* ---------- 检查更新（原生请求，绕开 WebView 的跨域限制） ---------- */

        /**
         * 发起一次版本检查，立刻返回一个查询号。
         * 真正的网络请求在后台线程里做，JS 侧用 pollCheckUpdate 轮询结果。
         * 之所以不在 JS 里直接 fetch：WebView 从 appassets 这个虚拟域名发跨域请求
         * 在很多机型上会被 CORS 拦掉（表现为 "Failed to fetch"），原生请求没有这个限制。
         */
        @JavascriptInterface
        public String startCheckUpdate() {
            String rid = "u" + System.currentTimeMillis();
            updateResults.put(rid, "{\"state\":\"pending\"}");
            new Thread(() -> {
                String out;
                try {
                    out = fetchLatestRelease();
                } catch (Throwable t) {
                    out = "{\"state\":\"done\",\"ok\":false,\"kind\":\"unknown\",\"error\":\""
                            + escapeJson(String.valueOf(t.getMessage())) + "\"}";
                }
                updateResults.put(rid, out);
            }).start();
            // 结果表只留最近 8 次，避免长时间运行后无限增长
            if (updateResults.size() > 8) {
                Iterator<String> it = updateResults.keySet().iterator();
                int drop = updateResults.size() - 8;
                while (it.hasNext() && drop > 0) {
                    it.next();
                    it.remove();
                    drop--;
                }
            }
            return rid;
        }

        @JavascriptInterface
        public String pollCheckUpdate(String rid) {
            if (rid == null) return "{\"state\":\"missing\"}";
            String v = updateResults.get(rid);
            return v == null ? "{\"state\":\"missing\"}" : v;
        }

        /** 真正的版本查询：短超时 + 一次重试 + 错误归类，国产网络环境下最稳的组合 */
        private String fetchLatestRelease() {
            final String url = "https://api.github.com/repos/chenziangloves/jizhang-android/releases/latest";
            String lastKind = "unknown";
            String lastMsg = "网络不通";

            for (int attempt = 1; attempt <= 2; attempt++) {
                HttpURLConnection conn = null;
                try {
                    URL u = new URL(url);
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(7000);
                    conn.setReadTimeout(7000);
                    conn.setInstanceFollowRedirects(true);
                    conn.setUseCaches(false);
                    // GitHub 对没有 UA 的请求会直接拒绝，必须显式带上
                    conn.setRequestProperty("User-Agent", "JiZhang-Android/" + versionNameSafe());
                    conn.setRequestProperty("Accept", "application/vnd.github+json");
                    conn.setRequestProperty("Cache-Control", "no-cache");

                    int code = conn.getResponseCode();
                    if (code == 200) {
                        InputStream in = conn.getInputStream();
                        String body = readStream(in);
                        return parseRelease(body);
                    }
                    if (code == 403 || code == 429) {
                        lastKind = "ratelimit";
                        lastMsg = "GitHub 接口访问过于频繁（HTTP " + code + "），请过几分钟再试";
                        if (code == 403) break; // 限流重试无意义
                    } else if (code == 404) {
                        lastKind = "notfound";
                        lastMsg = "找不到发布记录（HTTP 404）";
                        break;
                    } else {
                        lastKind = "http";
                        lastMsg = "服务器返回 HTTP " + code;
                    }
                } catch (UnknownHostException e) {
                    lastKind = "dns";
                    lastMsg = "域名 api.github.com 解析失败，请检查网络或 VPN 是否已连接";
                } catch (SocketTimeoutException e) {
                    lastKind = "timeout";
                    lastMsg = "连接 api.github.com 超时，当前网络可能无法稳定访问 GitHub";
                } catch (SSLException e) {
                    lastKind = "ssl";
                    lastMsg = "HTTPS 握手失败，网络可能被拦截";
                } catch (Exception e) {
                    lastKind = "connect";
                    lastMsg = "网络请求失败：" + String.valueOf(e.getMessage());
                } finally {
                    if (conn != null) conn.disconnect();
                }

                if (attempt == 1) {
                    try { Thread.sleep(800); } catch (InterruptedException ignored) { }
                }
            }

            return "{\"state\":\"done\",\"ok\":false,\"kind\":\"" + escapeJson(lastKind)
                    + "\",\"error\":\"" + escapeJson(lastMsg) + "\"}";
        }

        /** 把 GitHub 的 release JSON 精简成网页需要的那几个字段 */
        private String parseRelease(String body) {
            try {
                JSONObject d = new JSONObject(body);
                String tag = d.optString("tag_name", "");
                if (tag.isEmpty()) {
                    return "{\"state\":\"done\",\"ok\":false,\"kind\":\"parse\",\"error\":\"返回内容里没有版本号\"}";
                }
                String apkName = "";
                String apkUrl = "";
                long apkSize = 0;
                JSONArray assets = d.optJSONArray("assets");
                if (assets != null) {
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject a = assets.optJSONObject(i);
                        if (a == null) continue;
                        String name = a.optString("name", "");
                        if (name.toLowerCase().endsWith(".apk")) {
                            apkName = name;
                            apkUrl = a.optString("browser_download_url", "");
                            apkSize = a.optLong("size", 0);
                            break;
                        }
                    }
                }
                JSONObject o = new JSONObject();
                o.put("state", "done");
                o.put("ok", true);
                o.put("tag", tag);
                o.put("apkName", apkName);
                o.put("apkUrl", apkUrl);
                o.put("apkSize", apkSize);
                o.put("notes", d.optString("body", ""));
                o.put("pageUrl", d.optString("html_url", ""));
                o.put("publishedAt", d.optString("published_at", ""));
                return o.toString();
            } catch (Exception e) {
                return "{\"state\":\"done\",\"ok\":false,\"kind\":\"parse\",\"error\":\"返回内容无法解析\"}";
            }
        }

        private String versionNameSafe() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                return pi.versionName == null ? "0" : pi.versionName;
            } catch (Exception e) {
                return "0";
            }
        }
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        b.append(String.format("\\u%04x", (int) c));
                    } else {
                        b.append(c);
                    }
            }
        }
        return b.toString();
    }
}
