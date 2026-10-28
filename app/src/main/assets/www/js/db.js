/* ============================================================
 * db.js — 本地数据库层（IndexedDB）
 * 所有数据只存在当前浏览器本地，不上传任何服务器
 * ============================================================ */
(function (global) {
  'use strict';

  var DB_NAME = 'jizhang_db';
  var DB_VERSION = 1;
  var S_RECORDS = 'records';
  var S_CATS = 'categories';

  /* ---------- 预置分类 ---------- */
  var PRESET_CATEGORIES = [
    // 支出
    { id: 'e_food',    name: '吃饭',     emoji: '🍚', type: 'expense', order: 1,  builtin: true },
    { id: 'e_fuel',    name: '加油充电', emoji: '⛽', type: 'expense', order: 2,  builtin: true },
    { id: 'e_traffic', name: '交通费',   emoji: '🚗', type: 'expense', order: 3,  builtin: true },
    { id: 'e_cloth',   name: '买衣服',   emoji: '👕', type: 'expense', order: 4,  builtin: true },
    { id: 'e_daily',   name: '日用百货', emoji: '🧴', type: 'expense', order: 5,  builtin: true },
    { id: 'e_rent',    name: '房租水电', emoji: '🏠', type: 'expense', order: 6,  builtin: true },
    { id: 'e_phone',   name: '通讯话费', emoji: '📱', type: 'expense', order: 7,  builtin: true },
    { id: 'e_health',  name: '医疗健康', emoji: '💊', type: 'expense', order: 8,  builtin: true },
    { id: 'e_fun',     name: '娱乐',     emoji: '🎮', type: 'expense', order: 9,  builtin: true },
    { id: 'e_gift',    name: '人情往来', emoji: '🎁', type: 'expense', order: 10, builtin: true },
    { id: 'e_study',   name: '学习提升', emoji: '📚', type: 'expense', order: 11, builtin: true },
    { id: 'e_other',   name: '其他支出', emoji: '💰', type: 'expense', order: 12, builtin: true },
    // 收入
    { id: 'i_salary',  name: '工资',     emoji: '💼', type: 'income',  order: 1,  builtin: true },
    { id: 'i_bonus',   name: '奖金',     emoji: '🏆', type: 'income',  order: 2,  builtin: true },
    { id: 'i_part',    name: '兼职副业', emoji: '💻', type: 'income',  order: 3,  builtin: true },
    { id: 'i_red',     name: '红包礼金', emoji: '🧧', type: 'income',  order: 4,  builtin: true },
    { id: 'i_other',   name: '其他收入', emoji: '💰', type: 'income',  order: 5,  builtin: true }
  ];

  var dbPromise = null;

  /* 数据一变就通知上层：安卓外壳据此做自动备份（浏览器里是空操作） */
  function touch() {
    try {
      if (global.JZ && typeof global.JZ.scheduleBackup === 'function') {
        global.JZ.scheduleBackup('write');
      }
    } catch (e) { /* ignore */ }
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('当前浏览器不支持本地数据库（IndexedDB）'));
        return;
      }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function () {
        var db = req.result;

        if (!db.objectStoreNames.contains(S_RECORDS)) {
          var rs = db.createObjectStore(S_RECORDS, { keyPath: 'id' });
          rs.createIndex('date', 'date', { unique: false });
          rs.createIndex('month', 'month', { unique: false });
          rs.createIndex('type', 'type', { unique: false });
          rs.createIndex('categoryId', 'categoryId', { unique: false });
        }

        if (!db.objectStoreNames.contains(S_CATS)) {
          var cs = db.createObjectStore(S_CATS, { keyPath: 'id' });
          cs.createIndex('type', 'type', { unique: false });
          PRESET_CATEGORIES.forEach(function (c) { cs.add(c); });
        }
      };

      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function store(name, mode) {
    return open().then(function (db) {
      return db.transaction(name, mode).objectStore(name);
    });
  }

  /* ---------- ID ---------- */
  function uid(prefix) {
    var rnd;
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      rnd = global.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    } else {
      rnd = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    }
    return (prefix || 'x') + '_' + rnd;
  }

  /* ---------- 分类 ---------- */
  function listCategories() {
    return store(S_CATS, 'readonly')
      .then(function (s) { return wrap(s.getAll()); })
      .then(function (arr) {
        arr.sort(function (a, b) {
          if (a.type !== b.type) return a.type === 'expense' ? -1 : 1;
          if (a.order !== b.order) return a.order - b.order;
          return a.name.localeCompare(b.name, 'zh-Hans-CN');
        });
        return arr;
      });
  }

  function putCategory(cat) {
    if (!cat.id) cat.id = uid('c');
    return store(S_CATS, 'readwrite')
      .then(function (s) { return wrap(s.put(cat)); })
      .then(function () { touch(); return cat; });
  }

  function deleteCategory(id) {
    // 删除分类，同时把该分类下的记录改为「未分类」
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction([S_CATS, S_RECORDS], 'readwrite');
        t.objectStore(S_CATS).delete(id);

        var idx = t.objectStore(S_RECORDS).index('categoryId');
        var cursorReq = idx.openCursor(IDBKeyRange.only(id));
        cursorReq.onsuccess = function () {
          var cur = cursorReq.result;
          if (cur) {
            var rec = cur.value;
            rec.categoryId = '';
            rec.updatedAt = Date.now();
            cur.update(rec);
            cur.continue();
          }
        };

        t.oncomplete = function () { touch(); resolve(true); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function countByCategory(id) {
    return store(S_RECORDS, 'readonly')
      .then(function (s) { return wrap(s.index('categoryId').getAll(IDBKeyRange.only(id))); })
      .then(function (arr) { return arr.filter(alive).length; });
  }

  /* ---------- 记录 ---------- */

  /* 软删除标记：没有 deletedAt（或为 0）表示正常，有值表示在回收站。
     旧数据没有这个字段，读出来是 undefined，自然也属于「正常」——
     所以不需要升 DB_VERSION，也就不存在迁移失败把账本搞坏的风险。 */
  function alive(r) { return !r.deletedAt; }

  function listRecords(month) {
    return store(S_RECORDS, 'readonly')
      .then(function (s) {
        if (month) {
          return wrap(s.index('month').getAll(IDBKeyRange.only(month)));
        }
        return wrap(s.getAll());
      })
      .then(function (arr) {
        var out = arr.filter(alive);
        out.sort(function (a, b) {
          if (a.date !== b.date) return a.date < b.date ? 1 : -1;
          return (b.createdAt || 0) - (a.createdAt || 0);
        });
        return out;
      });
  }

  function putRecord(rec) {
    var now = Date.now();
    if (!rec.id) rec.id = uid('r');
    rec.month = String(rec.date || '').slice(0, 7);
    rec.updatedAt = now;
    if (!rec.createdAt) rec.createdAt = now;
    if (rec.deletedAt === undefined) rec.deletedAt = 0;
    return store(S_RECORDS, 'readwrite')
      .then(function (s) { return wrap(s.put(rec)); })
      .then(function () { touch(); return rec; });
  }

  /** 删除 = 进回收站。真正抹掉要用 purgeRecord 或 emptyTrash */
  function deleteRecord(id) {
    return getRecord(id).then(function (rec) {
      if (!rec) return false;
      rec.deletedAt = Date.now();
      rec.updatedAt = rec.deletedAt;
      return store(S_RECORDS, 'readwrite')
        .then(function (s) { return wrap(s.put(rec)); })
        .then(function () { touch(); return true; });
    });
  }

  function getRecord(id) {
    return store(S_RECORDS, 'readonly')
      .then(function (s) { return wrap(s.get(id)); })
      .then(function (r) { return r || null; });
  }

  function restoreRecord(id) {
    return getRecord(id).then(function (rec) {
      if (!rec) return false;
      rec.deletedAt = 0;
      rec.updatedAt = Date.now();
      return store(S_RECORDS, 'readwrite')
        .then(function (s) { return wrap(s.put(rec)); })
        .then(function () { touch(); return true; });
    });
  }

  /** 彻底删除单条，不可恢复 */
  function purgeRecord(id) {
    return store(S_RECORDS, 'readwrite')
      .then(function (s) { return wrap(s.delete(id)); })
      .then(function () { touch(); });
  }

  /** 回收站里的记录，按删除时间倒序 */
  function listTrash() {
    return store(S_RECORDS, 'readonly')
      .then(function (s) { return wrap(s.getAll()); })
      .then(function (arr) {
        var out = arr.filter(function (r) { return !!r.deletedAt; });
        out.sort(function (a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0); });
        return out;
      });
  }

  /** 把当前所有正常记录一次性移入回收站，返回处理条数 */
  function trashAllRecords() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(S_RECORDS, 'readwrite');
        var s = t.objectStore(S_RECORDS);
        var now = Date.now();
        var n = 0;
        var cursorReq = s.openCursor();
        cursorReq.onsuccess = function () {
          var cur = cursorReq.result;
          if (!cur) return;
          var rec = cur.value;
          if (!rec.deletedAt) {
            rec.deletedAt = now;
            rec.updatedAt = now;
            cur.update(rec);
            n++;
          }
          cur.continue();
        };
        t.oncomplete = function () { touch(); resolve(n); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  /** 清空回收站：只对真正想彻底删掉的人用 */
  function emptyTrash() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(S_RECORDS, 'readwrite');
        var s = t.objectStore(S_RECORDS);
        var n = 0;
        var cursorReq = s.openCursor();
        cursorReq.onsuccess = function () {
          var cur = cursorReq.result;
          if (!cur) return;
          if (cur.value.deletedAt) {
            cur.delete();
            n++;
          }
          cur.continue();
        };
        t.oncomplete = function () { touch(); resolve(n); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  /* ---------- 备份 ---------- */
  function exportAll() {
    return Promise.all([listRecords(), listCategories()]).then(function (r) {
      return {
        app: 'jizhang',
        schema: 1,
        exportedAt: new Date().toISOString(),
        categories: r[1],
        records: r[0]
      };
    });
  }

  function importAll(data) {
    if (!data || !Array.isArray(data.records)) {
      return Promise.reject(new Error('备份文件格式不正确'));
    }
    var cats = Array.isArray(data.categories) ? data.categories : [];
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction([S_CATS, S_RECORDS], 'readwrite');
        var cs = t.objectStore(S_CATS);
        var rs = t.objectStore(S_RECORDS);

        cs.clear();
        rs.clear();

        cats.forEach(function (c) {
          if (c && c.id && c.name) {
            cs.put({
              id: c.id,
              name: String(c.name),
              emoji: c.emoji || '🏷️',
              type: c.type === 'income' ? 'income' : 'expense',
              order: typeof c.order === 'number' ? c.order : 99,
              builtin: !!c.builtin
            });
          }
        });

        data.records.forEach(function (r) {
          if (!r || !r.id || !r.date) return;
          if (r.deletedAt) return;   // 备份里已标记删除的，不再导回来
          rs.put({
            id: r.id,
            type: r.type === 'income' ? 'income' : 'expense',
            amount: Math.round(Number(r.amount) || 0),
            categoryId: r.categoryId || '',
            date: String(r.date).slice(0, 10),
            month: String(r.date).slice(0, 7),
            note: r.note || '',
            createdAt: r.createdAt || Date.now(),
            updatedAt: r.updatedAt || Date.now(),
            deletedAt: 0
          });
        });

        t.oncomplete = function () {
          touch();
          resolve({ records: data.records.length, categories: cats.length });
        };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function clearRecords() {
    return store(S_RECORDS, 'readwrite')
      .then(function (s) { return wrap(s.clear()); })
      .then(function () { touch(); });
  }

  function resetAll() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction([S_CATS, S_RECORDS], 'readwrite');

        // 账单只是移入回收站，不会真的消失
        var rs = t.objectStore(S_RECORDS);
        var now = Date.now();
        var curReq = rs.openCursor();
        curReq.onsuccess = function () {
          var cur = curReq.result;
          if (!cur) return;
          var rec = cur.value;
          if (!rec.deletedAt) {
            rec.deletedAt = now;
            rec.updatedAt = now;
            cur.update(rec);
          }
          cur.continue();
        };

        var cs = t.objectStore(S_CATS);
        cs.clear();
        PRESET_CATEGORIES.forEach(function (c) { cs.put(c); });

        t.oncomplete = function () { touch(); resolve(true); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  global.DB = {
    PRESET_CATEGORIES: PRESET_CATEGORIES,
    uid: uid,
    open: open,
    listCategories: listCategories,
    putCategory: putCategory,
    deleteCategory: deleteCategory,
    countByCategory: countByCategory,
    listRecords: listRecords,
    getRecord: getRecord,
    putRecord: putRecord,
    deleteRecord: deleteRecord,
    restoreRecord: restoreRecord,
    purgeRecord: purgeRecord,
    listTrash: listTrash,
    trashAllRecords: trashAllRecords,
    emptyTrash: emptyTrash,
    exportAll: exportAll,
    importAll: importAll,
    clearRecords: clearRecords,
    resetAll: resetAll
  };
})(window);
