/* ============================================================
 * native.js — 与安卓外壳通信
 * 在普通浏览器里自动降级（所有方法安全空转），所以网页版可以直接用
 * 提供：自动备份、版本信息、打开外链、备份读取
 * ============================================================ */
(function (global) {
  'use strict';

  var bridge = global.AndroidBridge || null;
  var backupTimer = null;
  var backupAt = 0;
  var watchers = [];
  var BACKUP_DELAY = 4000;

  function available() { return !!bridge; }

  function safeJson(s, fallback) {
    try { return JSON.parse(s); } catch (e) { return fallback; }
  }

  function call(name) {
    if (!bridge || typeof bridge[name] !== 'function') return null;
    try {
      return bridge[name].apply(bridge, Array.prototype.slice.call(arguments, 1));
    } catch (e) {
      return null;
    }
  }

  /* ---------- 版本信息 ---------- */
  function info() {
    if (!bridge) return null;
    var raw = call('appInfo');
    var obj = safeJson(raw, null);
    if (obj) obj.platform = 'android';
    return obj;
  }

  /* ---------- 打开外链（更新下载） ---------- */
  function openUrl(url) {
    if (!url) return false;
    if (bridge) {
      call('openUrl', String(url));
      return true;
    }
    global.open(url, '_blank');
    return true;
  }

  /* ---------- 自动备份 ---------- */
  function notify(msg) {
    for (var i = 0; i < watchers.length; i++) {
      try { watchers[i](msg); } catch (e) { /* ignore */ }
    }
  }

  function backupNow(reason) {
    if (!bridge || !global.DB) return Promise.resolve(false);
    clearTimeout(backupTimer);
    backupTimer = null;
    return global.DB.exportAll().then(function (data) {
      var payload = {
        app: 'jizhang',
        kind: 'auto',
        schema: data.schema || 1,
        exportedAt: new Date().toISOString(),
        note: reason || '',
        categories: data.categories || [],
        records: data.records || []
      };
      call('autoBackup', JSON.stringify(payload));
      backupAt = Date.now();
      notify({ at: backupAt, count: payload.records.length });
      return true;
    }).catch(function () { return false; });
  }

  function scheduleBackup(reason) {
    if (!bridge) return;
    clearTimeout(backupTimer);
    backupTimer = setTimeout(function () { backupNow(reason); }, BACKUP_DELAY);
  }

  function loadBackup() {
    if (!bridge) return '';
    var s = call('loadBackup');
    return typeof s === 'string' ? s : '';
  }

  function onBackup(fn) { if (typeof fn === 'function') watchers.push(fn); }

  function lastBackupAt() { return backupAt || (info() || {}).backupAt || 0; }

  /* 切到后台时立刻落盘，避免刚记完账就被系统杀掉 */
  if (bridge) {
    global.addEventListener('visibilitychange', function () {
      if (global.document.hidden && backupTimer) backupNow('hidden');
    });
    global.addEventListener('pagehide', function () {
      if (backupTimer) backupNow('pagehide');
    });
  }

  /* ---------- 浏览器里“下载”改成存进手机下载目录 ---------- */
  var origCreate = global.document.createElement.bind(global.document);
  global.document.createElement = function (tag) {
    var el = origCreate(tag);
    if (!bridge || String(tag).toLowerCase() !== 'a') return el;

    var origClick = el.click.bind(el);
    var origDispatch = el.dispatchEvent.bind(el);

    function isBlob(u) { return typeof u === 'string' && u.indexOf('blob:') === 0; }

    function saveBlob(url, filename) {
      try {
        var xhr = new global.XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'blob';
        xhr.onload = function () {
          var fr = new global.FileReader();
          fr.onloadend = function () {
            var res = String(fr.result || '');
            var i = res.indexOf(',');
            call('saveFile', filename || 'jizhang-backup.json', i >= 0 ? res.slice(i + 1) : '');
          };
          fr.readAsDataURL(xhr.response);
        };
        xhr.onerror = function () { call('toast', '读取备份数据失败'); };
        xhr.send();
      } catch (e) { /* ignore */ }
    }

    function tryHandle() {
      try {
        if (el.download && isBlob(el.href)) { saveBlob(el.href, el.download); return true; }
      } catch (e) { /* ignore */ }
      return false;
    }

    el.click = function () { if (tryHandle()) return; origClick(); };
    el.dispatchEvent = function (ev) {
      if (ev && ev.type === 'click' && tryHandle()) return true;
      return origDispatch(ev);
    };
    return el;
  };

  global.JZ = {
    available: available,
    info: info,
    openUrl: openUrl,
    showToast: function (m) { call('toast', String(m)); },
    scheduleBackup: scheduleBackup,
    backupNow: backupNow,
    loadBackup: loadBackup,
    lastBackupAt: lastBackupAt,
    onBackup: onBackup
  };
})(window);
