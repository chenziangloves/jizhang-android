package com.chenziang.jizhang;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
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

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {

    private static final int REQ_FILE_CHOOSER = 1001;
    private static final String START_URL =
            "https://appassets.androidplatform.net/assets/www/index.html";
    /** 自动备份文件名：同时存在于 App 私有目录和「下载/记账本备份」里，卸载重装也能捞回来 */
    private static final String AUTO_BACKUP_NAME = "jizhang-autobackup.json";

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private long lastBackPress = 0L;

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
            new Thread(() -> {
                try {
                    File target = autoBackupFile();
                    File tmp = new File(target.getAbsolutePath() + ".tmp");
                    FileOutputStream fos = new FileOutputStream(tmp);
                    fos.write(bytes);
                    fos.flush();
                    fos.close();
                    if (target.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        target.delete();
                    }
                    if (!tmp.renameTo(target)) {
                        FileOutputStream f2 = new FileOutputStream(target);
                        f2.write(bytes);
                        f2.close();
                        //noinspection ResultOfMethodCallIgnored
                        tmp.delete();
                    }
                } catch (Exception ignored) {
                }
                try {
                    mirrorBackupToDownloads(bytes);
                } catch (Exception ignored) {
                }
            }).start();
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
            File base = getExternalFilesDir(null);
            if (base == null) base = getFilesDir();
            File dir = new File(base, "backup");
            if (!dir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
            }
            return new File(dir, AUTO_BACKUP_NAME);
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
    }
}
