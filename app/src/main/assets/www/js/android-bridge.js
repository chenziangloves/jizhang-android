(function () {
  if (!window.AndroidBridge) return;

  function isBlobUrl(u) {
    return typeof u === 'string' && u.indexOf('blob:') === 0;
  }

  function send(url, filename) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.onload = function () {
        var fr = new FileReader();
        fr.onloadend = function () {
          var res = String(fr.result || '');
          var i = res.indexOf(',');
          var b64 = i >= 0 ? res.slice(i + 1) : '';
          try {
            AndroidBridge.saveFile(filename || 'jizhang-backup.json', b64);
          } catch (e) {
            try { AndroidBridge.toast('保存失败'); } catch (e2) {}
          }
        };
        fr.readAsDataURL(xhr.response);
      };
      xhr.onerror = function () {
        try { AndroidBridge.toast('读取备份数据失败'); } catch (e) {}
      };
      xhr.send();
    } catch (e) {}
  }

  var origCreate = document.createElement.bind(document);
  document.createElement = function (tag) {
    var el = origCreate(tag);
    if (String(tag).toLowerCase() !== 'a') return el;

    var origClick = el.click.bind(el);
    var origDispatch = el.dispatchEvent.bind(el);

    function tryHandle() {
      try {
        if (el.download && isBlobUrl(el.href)) {
          send(el.href, el.download);
          return true;
        }
      } catch (e) {}
      return false;
    }

    el.click = function () {
      if (tryHandle()) return;
      origClick();
    };
    el.dispatchEvent = function (ev) {
      if (ev && ev.type === 'click' && tryHandle()) return true;
      return origDispatch(ev);
    };
    return el;
  };
})();
