/* ============================================================
 * app.js — 记账本主逻辑
 * ============================================================ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ================= 工具函数 ================= */

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayStr() { return toDateStr(new Date()); }
  function thisMonth() { return todayStr().slice(0, 7); }

  function monthLabel(m) {
    var p = String(m).split('-');
    return p[0] + '年' + Number(p[1]) + '月';
  }

  function shiftMonth(m, delta) {
    var p = String(m).split('-');
    var y = Number(p[0]), mo = Number(p[1]) + delta;
    while (mo > 12) { mo -= 12; y++; }
    while (mo < 1) { mo += 12; y--; }
    return y + '-' + pad2(mo);
  }

  function dayLabel(s) {
    if (!s) return '';
    var p = String(s).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    var y = new Date().getFullYear();
    if (s === todayStr()) return '今天 ' + w;
    if (String(y) !== p[0]) return p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日 ' + w;
    return Number(p[1]) + '月' + Number(p[2]) + '日 ' + w;
  }

  /** 分 -> "1,234.50" */
  function money(cents) {
    var neg = cents < 0;
    var n = Math.abs(Math.round(cents));
    var yuan = Math.floor(n / 100);
    var fen = String(n % 100);
    if (fen.length < 2) fen = '0' + fen;
    var s = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fen;
    return (neg ? '-' : '') + s;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function groupByDate(records) {
    var map = {}, order = [];
    records.forEach(function (r) {
      if (!map[r.date]) { map[r.date] = []; order.push(r.date); }
      map[r.date].push(r);
    });
    return order.map(function (d) { return { date: d, items: map[d] }; });
  }

  var PALETTE = [
    '#ff7a45', '#ffb020', '#4c9aff', '#7b61ff', '#00b8a9', '#f06595',
    '#8fbc5f', '#5ec8e8', '#c084fc', '#f9a8d4', '#34d399', '#fb923c',
    '#60a5fa', '#a78bfa', '#facc15', '#fb7185'
  ];

  /* ================= 状态 ================= */

  var state = {
    view: 'home',
    month: thisMonth(),
    categories: [],
    allRecords: [],
    monthRecords: [],
    filter: { type: 'all', categoryId: '' },
    editor: null
  };

  /* ================= 数据操作 ================= */

  function refresh() {
    return Promise.all([DB.listCategories(), DB.listRecords()]).then(function (res) {
      state.categories = res[0];
      state.allRecords = res[1];
      state.monthRecords = state.allRecords.filter(function (r) { return r.month === state.month; });
      render();
    }).catch(function (e) {
      toast('读取数据失败：' + (e && e.message ? e.message : e));
    });
  }

  function catOf(id) {
    for (var i = 0; i < state.categories.length; i++) {
      if (state.categories[i].id === id) return state.categories[i];
    }
    return null;
  }
  function catName(id) { var c = catOf(id); return c ? c.name : '未分类'; }
  function catEmoji(id) { var c = catOf(id); return c && c.emoji ? c.emoji : '🏷️'; }

  function monthTotals(records) {
    var income = 0, expense = 0;
    records.forEach(function (r) {
      if (r.type === 'income') income += r.amount;
      else expense += r.amount;
    });
    return { income: income, expense: expense, balance: income - expense };
  }

  /* ================= 渲染：首页 ================= */

  function viewHome() {
    var recs = state.monthRecords;
    var t = monthTotals(recs);

    var html = '';
    html += '<div class="topbar">' + monthSwitchHtml() + '</div>';

    html += '<div class="summary-card">' +
      '<div class="sum-label">本月支出</div>' +
      '<div class="sum-amount"><span class="unit">¥</span>' + money(t.expense) + '</div>' +
      '<div class="sum-row">' +
        '<div class="sum-item"><span class="k">收入</span><span class="v">¥' + money(t.income) + '</span></div>' +
        '<div class="sum-item"><span class="k">结余</span><span class="v">¥' + money(t.balance) + '</span></div>' +
      '</div>' +
    '</div>';

    // 支出构成
    var byCat = {};
    recs.forEach(function (r) {
      if (r.type !== 'expense') return;
      byCat[r.categoryId] = (byCat[r.categoryId] || 0) + r.amount;
    });
    var arr = Object.keys(byCat).map(function (id) {
      return { id: id, amount: byCat[id] };
    }).sort(function (a, b) { return b.amount - a.amount; });

    if (arr.length) {
      var cnt = recs.filter(function (r) { return r.type === 'expense'; }).length;
      html += '<div class="panel">' +
        '<div class="panel-head"><span>支出构成</span><span>共 ' + cnt + ' 笔</span></div>' +
        donutHtml(arr, t.expense) +
        legendHtml(arr, t.expense) +
      '</div>';
    }

    // 最近流水
    var recent = recs.slice(0, 15);
    html += '<div class="section-title"><span>最近流水</span><span>' + (recs.length ? '本月共 ' + recs.length + ' 笔' : '') + '</span></div>';

    if (!recent.length) {
      html += emptyHtml('🧾', '本月还没有记录',
        '点右下角的 + 号，记下第一笔<br>' + monthLabel(state.month) + '的钱去哪了，从这里开始清楚');
    } else {
      html += recordsHtml(recent);
    }

    return '<div class="view">' + html + '</div>';
  }

  function monthSwitchHtml() {
    return '<div class="month-switch">' +
      '<button class="ms-btn" data-act="prev-month" type="button" aria-label="上个月">‹</button>' +
      '<span class="ms-label">' + monthLabel(state.month) + '</span>' +
      '<button class="ms-btn" data-act="next-month" type="button" aria-label="下个月">›</button>' +
    '</div>';
  }

  /* ---------- 支出构成：环形饼图 ---------- */

  function pctText(p) {
    if (p >= 99.95) return '100%';
    if (p >= 10) return Math.round(p) + '%';
    if (p >= 1) return p.toFixed(1) + '%';
    return '&lt;1%';
  }

  function donutHtml(arr, total) {
    var CX = 100, CY = 100, RMID = 76, RING = 30, GAP = 2.6;
    var CIRC = 2 * Math.PI * RMID;
    var acc = 0;
    var body = '';

    if (arr.length === 1) {
      body = '<circle cx="' + CX + '" cy="' + CY + '" r="' + RMID + '" fill="none" stroke="' +
        PALETTE[0] + '" stroke-width="' + RING + '"/>';
    } else {
      arr.forEach(function (it, i) {
        var len = CIRC * (it.amount / total);
        var draw = Math.max(len - GAP, 0.8);
        body += '<circle cx="' + CX + '" cy="' + CY + '" r="' + RMID + '" fill="none" stroke="' +
          PALETTE[i % PALETTE.length] + '" stroke-width="' + RING + '"' +
          ' stroke-dasharray="' + draw.toFixed(2) + ' ' + (CIRC - draw).toFixed(2) + '"' +
          ' stroke-dashoffset="' + (-acc).toFixed(2) + '"' +
          ' transform="rotate(-90 ' + CX + ' ' + CY + ')"/>';
        acc += len;
      });
    }

    return '<div class="donut-wrap">' +
      '<svg viewBox="0 0 200 200" aria-hidden="true">' +
        '<circle cx="100" cy="100" r="' + RMID + '" fill="none" stroke="#f1f3f6" stroke-width="' + RING + '"/>' +
        body +
      '</svg>' +
      '<div class="donut-center">' +
        '<div class="dc-k">本月支出</div>' +
        '<div class="dc-v">¥' + money(total) + '</div>' +
      '</div>' +
    '</div>';
  }

  function legendHtml(arr, total) {
    var h = '<div class="cat-legend">';
    arr.forEach(function (it, i) {
      var pct = total > 0 ? (it.amount / total * 100) : 0;
      h += '<div class="cl-row">' +
        '<span class="cl-dot" style="background:' + PALETTE[i % PALETTE.length] + '"></span>' +
        '<span class="cl-emoji">' + catEmoji(it.id) + '</span>' +
        '<span class="cl-name">' + esc(catName(it.id)) + '</span>' +
        '<span class="cl-amt">¥' + money(it.amount) + '</span>' +
        '<span class="cl-pct">' + pctText(pct) + '</span>' +
      '</div>';
    });
    h += '</div>';
    return h;
  }

  function emptyHtml(ico, title, sub) {
    return '<div class="empty">' +
      '<div class="ico">' + ico + '</div>' +
      '<div class="t">' + esc(title) + '</div>' +
      '<div class="s">' + sub + '</div>' +
    '</div>';
  }

  function recordsHtml(records) {
    var groups = groupByDate(records);
    var html = '';
    groups.forEach(function (g) {
      var dayExpense = 0, dayIncome = 0;
      g.items.forEach(function (r) {
        if (r.type === 'income') dayIncome += r.amount; else dayExpense += r.amount;
      });
      var sumTxt = [];
      if (dayExpense) sumTxt.push('支出 ¥' + money(dayExpense));
      if (dayIncome) sumTxt.push('收入 ¥' + money(dayIncome));

      html += '<div class="day-group">';
      html += '<div class="day-head"><span>' + dayLabel(g.date) + '</span><span class="sum">' + sumTxt.join(' · ') + '</span></div>';
      html += '<div class="rec-list">';
      g.items.forEach(function (r) {
        html += '<div class="rec" data-act="open-rec" data-id="' + esc(r.id) + '">' +
          '<div class="rec-emoji">' + catEmoji(r.categoryId) + '</div>' +
          '<div class="rec-main">' +
            '<div class="rec-cat">' + esc(catName(r.categoryId)) + '</div>' +
            (r.note ? '<div class="rec-note">' + esc(r.note) + '</div>' : '') +
          '</div>' +
          '<div class="rec-amt ' + (r.type === 'income' ? 'income' : 'expense') + '">' +
            (r.type === 'income' ? '+' : '-') + '¥' + money(r.amount) +
          '</div>' +
        '</div>';
      });
      html += '</div></div>';
    });
    return html;
  }

  /* ================= 渲染：流水页 ================= */

  function viewList() {
    var f = state.filter;
    var recs = state.monthRecords.filter(function (r) {
      if (f.type !== 'all' && r.type !== f.type) return false;
      if (f.categoryId && r.categoryId !== f.categoryId) return false;
      return true;
    });

    var t = monthTotals(recs);

    var html = '<div class="topbar">' + monthSwitchHtml() + '</div>';

    // 类型筛选
    html += '<div class="chips" data-role="type-chips">' +
      chip('all', '全部', f.type === 'all') +
      chip('expense', '支出', f.type === 'expense') +
      chip('income', '收入', f.type === 'income') +
    '</div>';

    // 分类筛选
    if (f.type !== 'all') {
      var cats = state.categories.filter(function (c) { return c.type === f.type; });
      html += '<div class="chips" data-role="cat-chips">' +
        '<button class="chip' + (f.categoryId === '' ? ' on' : '') + '" data-act="fil-cat" data-cat="" type="button">全部分类</button>';
      cats.forEach(function (c) {
        html += '<button class="chip' + (f.categoryId === c.id ? ' on' : '') + '" data-act="fil-cat" data-cat="' + esc(c.id) + '" type="button">' +
          (c.emoji || '🏷️') + ' ' + esc(c.name) + '</button>';
      });
      html += '</div>';
    }

    html += '<div class="filter-summary">' +
      '<span>共 ' + recs.length + ' 笔</span>' +
      '<span>支出 ¥' + money(t.expense) + '　收入 ¥' + money(t.income) + '</span>' +
    '</div>';

    if (!recs.length) {
      html += emptyHtml('🔍', '这个条件下没有记录', '换个筛选条件，或者点右下角 + 记一笔');
    } else {
      html += recordsHtml(recs);
    }

    return '<div class="view">' + html + '</div>';
  }

  function chip(type, label, on) {
    return '<button class="chip' + (on ? ' on' : '') + '" data-act="fil-type" data-type="' + type + '" type="button">' + label + '</button>';
  }

  /* ================= 渲染：设置页 ================= */

  function viewSettings() {
    var counts = {};
    state.allRecords.forEach(function (r) {
      counts[r.categoryId] = (counts[r.categoryId] || 0) + 1;
    });

    function catBlock(type, title) {
      var cats = state.categories.filter(function (c) { return c.type === type; });
      var h = '<div class="set-group"><div class="set-head">' +
        '<span>' + title + '（' + cats.length + '）</span>' +
        '<button class="add-btn" data-act="add-cat" data-type="' + type + '" type="button">+ 新增</button>' +
      '</div>';
      cats.forEach(function (c) {
        h += '<div class="set-row">' +
          '<div class="s-emoji">' + (c.emoji || '🏷️') + '</div>' +
          '<div class="s-name">' + esc(c.name) + '</div>' +
          '<div class="s-cnt">' + (counts[c.id] || 0) + ' 笔</div>' +
          '<button class="s-btn" data-act="edit-cat" data-id="' + esc(c.id) + '" type="button">编辑</button>' +
          '<button class="s-btn danger" data-act="del-cat" data-id="' + esc(c.id) + '" type="button">删除</button>' +
        '</div>';
      });
      h += '</div>';
      return h;
    }

    var html = '<div class="page-title">设置</div>';

    html += '<div class="tip-box">' +
      '<b>你的账本只存在这台设备上。</b>不会上传到任何服务器，换手机或清理浏览器数据前，' +
      '请先到下面「导出备份」。' +
    '</div>';

    html += '<div class="set-group">' +
      '<div class="set-head"><span>装到手机桌面</span><span>像 App 一样用</span></div>' +
      '<div class="install-tip">' +
        '<div class="it-row"><span class="it-os">安卓</span><span>浏览器打开后点右上角 ⋮ →「安装应用」或「添加到主屏幕」</span></div>' +
        '<div class="it-row"><span class="it-os">iPhone</span><span>用 Safari 打开 → 底部「分享」→「添加到主屏幕」</span></div>' +
      '</div>' +
    '</div>';

    html += catBlock('expense', '支出分类');
    html += catBlock('income', '收入分类');

    html += '<div class="set-group">' +
      '<div class="set-head"><span>数据</span></div>' +
      '<button class="action-row" data-act="export" type="button">' +
        '<span class="a-icon">💾</span>' +
        '<span class="a-main">导出备份<span class="a-sub">保存为 JSON 文件，可传到网盘或电脑</span></span>' +
        '<span class="a-arrow">›</span>' +
      '</button>' +
      '<button class="action-row" data-act="import" type="button">' +
        '<span class="a-icon">📥</span>' +
        '<span class="a-main">导入恢复<span class="a-sub">从备份文件还原（会覆盖当前所有数据）</span></span>' +
        '<span class="a-arrow">›</span>' +
      '</button>' +
      '<button class="action-row danger" data-act="clear-records" type="button">' +
        '<span class="a-icon">🗑️</span>' +
        '<span class="a-main">清空所有账单<span class="a-sub">保留分类，删除全部收支记录</span></span>' +
        '<span class="a-arrow">›</span>' +
      '</button>' +
      '<button class="action-row danger" data-act="reset-all" type="button">' +
        '<span class="a-icon">♻️</span>' +
        '<span class="a-main">恢复出厂设置<span class="a-sub">清空账单并把分类重置为默认</span></span>' +
        '<span class="a-arrow">›</span>' +
      '</button>' +
    '</div>';

    html += '<div class="foot-note">' +
      '记账本 · 本地版 v1.0<br>' +
      '共 ' + state.allRecords.length + ' 笔记录 · ' + state.categories.length + ' 个分类' +
    '</div>';

    return '<div class="view">' + html + '</div>';
  }

  /* ================= 渲染主入口 ================= */

  function render() {
    var el = $('#views');
    if (state.view === 'home') el.innerHTML = viewHome();
    else if (state.view === 'list') el.innerHTML = viewList();
    else el.innerHTML = viewSettings();
  }

  function setView(v) {
    if (state.view === v) return;
    state.view = v;
    if (v !== 'list') state.filter = { type: 'all', categoryId: '' };
    render();
    var wrap = $('#views');
    wrap.classList.remove('anim');
    void wrap.offsetWidth;
    wrap.classList.add('anim');
    $$('.tab').forEach(function (t) { t.classList.toggle('on', t.dataset.view === v); });
    window.scrollTo(0, 0);
  }

  /* ================= 记一笔面板 ================= */

  var EMOJI_CHOICES = [
    '🍚', '🍜', '🍔', '☕', '🧋', '🛒', '⛽', '🔌', '🚗', '🚌', '🚕', '🅿️',
    '👕', '👟', '💄', '🧴', '🏠', '💡', '📱', '💊', '🏥', '🎮', '🎬', '🎤',
    '🎁', '🧧', '📚', '✈️', '🐱', '🐶', '💼', '🏆', '💻', '💰', '📈', '🏷️'
  ];

  function openEditor(record) {
    var e;
    if (record) {
      e = {
        id: record.id,
        type: record.type,
        amount: (record.amount / 100).toFixed(2),
        categoryId: record.categoryId,
        date: record.date,
        note: record.note || ''
      };
      e.amount = trimZero(e.amount);
    } else {
      e = {
        id: null,
        type: 'expense',
        amount: '',
        categoryId: '',
        date: todayStr(),
        note: ''
      };
    }
    state.editor = e;
    renderSheet();
    $('#sheet-backdrop').classList.add('on');
    $('#sheet').classList.add('on');
    document.body.style.overflow = 'hidden';
  }

  function trimZero(s) {
    s = String(s);
    if (s.indexOf('.') >= 0) {
      s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
    return s === '0' ? '' : s;
  }

  function closeSheet() {
    $('#sheet').classList.remove('on');
    $('#sheet-backdrop').classList.remove('on');
    document.body.style.overflow = '';
    state.editor = null;
  }

  function renderSheet() {
    var e = state.editor;
    if (!e) return;

    var cats = state.categories.filter(function (c) { return c.type === e.type; });
    if (!cats.length || !cats.some(function (c) { return c.id === e.categoryId; })) {
      e.categoryId = cats.length ? cats[0].id : '';
    }

    var h = '';
    h += '<div class="sheet-grip"></div>';

    h += '<div class="sheet-top">' +
      '<div class="seg">' +
        '<button data-act="ed-type" data-type="expense" class="' + (e.type === 'expense' ? 'on' : '') + '" type="button">支出</button>' +
        '<button data-act="ed-type" data-type="income" class="' + (e.type === 'income' ? 'on' : '') + '" type="button">收入</button>' +
      '</div>' +
      '<button class="sheet-x" data-act="ed-close" type="button" aria-label="关闭">✕</button>' +
    '</div>';

    h += '<div class="amt-display' + (e.type === 'income' ? ' is-income' : '') + '">' +
      '<span class="amt-cur">¥</span>' +
      '<span class="amt-num" id="amt-num">' + amountText(e.amount) + '</span>' +
    '</div>';

    h += '<div class="cat-grid" id="cat-grid">';
    cats.forEach(function (c) {
      h += '<button class="cat-item' + (c.id === e.categoryId ? ' on' : '') + '" data-act="ed-cat" data-id="' + esc(c.id) + '" type="button">' +
        '<span class="ce">' + (c.emoji || '🏷️') + '</span>' +
        '<span>' + esc(c.name) + '</span>' +
      '</button>';
    });
    h += '</div>';

    h += '<div class="meta-row">' +
      '<label class="meta-item">' +
        '<input type="date" id="ed-date" value="' + esc(e.date) + '" max="' + todayStr() + '">' +
      '</label>' +
      '<input class="note-input" id="ed-note" type="text" placeholder="备注（可选）" maxlength="40" value="' + esc(e.note) + '">' +
    '</div>';

    h += '<div class="keypad" id="keypad">' +
      keyBtn('1') + keyBtn('2') + keyBtn('3') +
      keyBtn('4') + keyBtn('5') + keyBtn('6') +
      keyBtn('7') + keyBtn('8') + keyBtn('9') +
      keyBtn('.', 'fn') + keyBtn('0') + keyBtn('del', 'fn', '⌫') +
    '</div>';

    h += '<button class="btn-save" data-act="ed-save" type="button">保存</button>';
    if (e.id) {
      h += '<button class="btn-del-rec" data-act="ed-delete" type="button">删除这笔记录</button>';
    }

    $('#sheet').innerHTML = h;

    // 输入事件
    var noteEl = $('#ed-note');
    noteEl.addEventListener('input', function () { state.editor.note = noteEl.value; });
    var dateEl = $('#ed-date');
    dateEl.addEventListener('change', function () {
      if (!state.editor) return;
      state.editor.date = dateEl.value || todayStr();
    });

    // 分类滚动到选中项
    var onEl = $('#cat-grid .cat-item.on');
    if (onEl) {
      var grid = $('#cat-grid');
      var gr = grid.getBoundingClientRect();
      var or = onEl.getBoundingClientRect();
      grid.scrollLeft += (or.left - gr.left) - (gr.width - or.width) / 2;
    }

    updateAmountView();
  }

  function keyBtn(k, cls, label) {
    return '<button class="key ' + (cls || '') + '" data-act="ed-key" data-key="' + k + '" type="button">' +
      (label || k) + '</button>';
  }

  function amountText(s) {
    if (!s) return '0.00';
    var p = String(s).split('.');
    var ip = p[0] ? p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '0';
    if (p.length > 1) return ip + '.' + p[1];
    return ip;
  }

  function updateAmountView() {
    var el = $('#amt-num');
    if (el && state.editor) el.textContent = amountText(state.editor.amount);
    var btn = $('#sheet .btn-save');
    if (btn && state.editor) {
      btn.disabled = !(parseFloat(state.editor.amount) > 0);
    }
  }

  function pressKey(k) {
    var e = state.editor;
    if (!e) return;
    var s = e.amount || '';

    if (k === 'del') {
      s = s.slice(0, -1);
    } else if (k === '.') {
      if (s.indexOf('.') >= 0) return;
      if (!s) s = '0';
      s += '.';
    } else {
      var dot = s.indexOf('.');
      if (dot >= 0) {
        if (s.length - dot - 1 >= 2) return;
      } else {
        if (s === '0') s = '';
        if (s.length >= 8) return;
      }
      s += k;
    }
    e.amount = s;
    updateAmountView();
  }

  function saveEditor() {
    var e = state.editor;
    if (!e) return;
    var val = parseFloat(e.amount);
    if (!(val > 0)) { toast('先输入金额'); return; }
    if (!e.categoryId) { toast('先选一个分类'); return; }

    var rec = {
      id: e.id || undefined,
      type: e.type,
      amount: Math.round(val * 100),
      categoryId: e.categoryId,
      date: e.date || todayStr(),
      note: (e.note || '').trim()
    };

    DB.putRecord(rec).then(function () {
      closeSheet();
      toast(e.id ? '已修改' : '已记下');
      return refresh();
    }).catch(function (err) {
      toast('保存失败：' + (err && err.message ? err.message : err));
    });
  }

  /* ================= 弹窗 ================= */

  function openDialog(html, onMount) {
    var d = $('#dialog');
    d.innerHTML = html;
    $('#dialog-backdrop').classList.add('on');
    d.classList.add('on');
    if (onMount) onMount(d);
  }

  function closeDialog() {
    $('#dialog').classList.remove('on');
    $('#dialog-backdrop').classList.remove('on');
  }

  function askConfirm(title, desc, okText, danger) {
    return new Promise(function (resolve) {
      openDialog(
        '<div class="dlg-title">' + esc(title) + '</div>' +
        '<div class="dlg-desc">' + desc + '</div>' +
        '<div class="dlg-actions">' +
          '<button class="dlg-btn" data-ok="0" type="button">取消</button>' +
          '<button class="dlg-btn ' + (danger ? 'danger' : 'primary') + '" data-ok="1" type="button">' + esc(okText) + '</button>' +
        '</div>',
        function (root) {
          $$('[data-ok]', root).forEach(function (b) {
            b.addEventListener('click', function () {
              closeDialog();
              resolve(b.dataset.ok === '1');
            });
          });
        }
      );
    });
  }

  /* ================= 分类编辑 ================= */

  function openCategoryDialog(cat, type) {
    var isEdit = !!cat;
    var catType = cat ? cat.type : type;
    var pickedEmoji = cat ? (cat.emoji || '🏷️') : '🏷️';
    var nameVal = cat ? cat.name : '';

    var emojiHtml = EMOJI_CHOICES.map(function (em) {
      return '<button type="button" data-em="' + em + '" class="' + (em === pickedEmoji ? 'on' : '') + '">' + em + '</button>';
    }).join('');

    openDialog(
      '<div class="dlg-title">' + (isEdit ? '编辑分类' : '新增分类') + '</div>' +
      '<div class="dlg-desc">' + (catType === 'income' ? '收入分类' : '支出分类') + '</div>' +
      '<input class="dlg-input" id="dlg-name" type="text" maxlength="10" placeholder="分类名称，如：烟酒、宠物" value="' + esc(nameVal) + '">' +
      '<div class="emoji-picker" id="dlg-emoji">' + emojiHtml + '</div>' +
      '<div class="dlg-actions">' +
        '<button class="dlg-btn" data-cancel="1" type="button">取消</button>' +
        '<button class="dlg-btn primary" data-save="1" type="button">保存</button>' +
      '</div>',
      function (root) {
        var input = $('#dlg-name', root);
        setTimeout(function () { input.focus(); }, 120);

        $$('#dlg-emoji button', root).forEach(function (b) {
          b.addEventListener('click', function () {
            pickedEmoji = b.dataset.em;
            $$('#dlg-emoji button', root).forEach(function (x) { x.classList.toggle('on', x === b); });
          });
        });

        $('[data-cancel]', root).addEventListener('click', closeDialog);

        $('[data-save]', root).addEventListener('click', function () {
          var name = input.value.trim();
          if (!name) { toast('请输入分类名称'); input.focus(); return; }

          var same = state.categories.filter(function (c) {
            return c.type === catType && c.name === name && (!cat || c.id !== cat.id);
          });
          if (same.length) { toast('已经有同名分类了'); return; }

          var order = 99;
          state.categories.forEach(function (c) {
            if (c.type === catType && typeof c.order === 'number' && c.order >= order) order = c.order + 1;
          });

          var obj = isEdit
            ? { id: cat.id, name: name, emoji: pickedEmoji, type: cat.type, order: cat.order, builtin: !!cat.builtin }
            : { name: name, emoji: pickedEmoji, type: catType, order: order, builtin: false };

          DB.putCategory(obj).then(function () {
            closeDialog();
            toast(isEdit ? '分类已更新' : '分类已添加');
            return refresh();
          }).catch(function (e) {
            toast('保存失败：' + (e && e.message ? e.message : e));
          });
        });
      }
    );
  }

  function deleteCategoryFlow(id) {
    var c = catOf(id);
    if (!c) return;
    DB.countByCategory(id).then(function (n) {
      var desc = n > 0
        ? '该分类下有 <b>' + n + '</b> 笔记录，删除后这些记录会变成「未分类」，金额仍然保留。'
        : '这个分类下还没有记录。';
      return askConfirm('删除「' + c.name + '」？', desc, '删除', true).then(function (ok) {
        if (!ok) return;
        return DB.deleteCategory(id).then(function () {
          toast('已删除');
          return refresh();
        });
      });
    });
  }

  /* ================= 备份 ================= */

  function doExport() {
    DB.exportAll().then(function (data) {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var d = new Date();
      a.href = url;
      a.download = '记账备份_' + toDateStr(d) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('备份已导出，共 ' + data.records.length + ' 笔');
    }).catch(function (e) {
      toast('导出失败：' + (e && e.message ? e.message : e));
    });
  }

  function doImport() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try {
          data = JSON.parse(reader.result);
        } catch (e) {
          toast('文件内容不是有效的备份文件');
          return;
        }
        if (!data || !Array.isArray(data.records)) {
          toast('文件内容不是有效的备份文件');
          return;
        }
        askConfirm('导入这份备份？',
          '将导入 <b>' + data.records.length + '</b> 笔记录、<b>' + (data.categories || []).length + '</b> 个分类。<br><b>当前设备上的所有数据会被覆盖</b>，无法撤销。',
          '确认导入', true
        ).then(function (ok) {
          if (!ok) return;
          return DB.importAll(data).then(function (r) {
            toast('已导入 ' + r.records + ' 笔记录');
            return refresh();
          });
        }).catch(function (e) {
          toast('导入失败：' + (e && e.message ? e.message : e));
        });
      };
      reader.readAsText(file);
    };
    input.click();
  }

  /* ================= Toast ================= */

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 1900);
  }

  /* ================= 事件绑定 ================= */

  function bindGlobal() {
    // 底部导航
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { setView(t.dataset.view); });
    });

    // 悬浮按钮
    $('#fab').addEventListener('click', function () { openEditor(null); });

    // 视图区委托
    $('#views').addEventListener('click', function (ev) {
      var el = ev.target.closest('[data-act]');
      if (!el) return;
      var act = el.dataset.act;

      if (act === 'prev-month') { state.month = shiftMonth(state.month, -1); refresh(); }
      else if (act === 'next-month') {
        var next = shiftMonth(state.month, 1);
        if (next > thisMonth()) { toast('还没到的月份'); return; }
        state.month = next; refresh();
      }
      else if (act === 'open-rec') {
        var id = el.dataset.id;
        var rec = state.allRecords.filter(function (r) { return r.id === id; })[0];
        if (rec) openEditor(rec);
      }
      else if (act === 'fil-type') {
        state.filter.type = el.dataset.type;
        state.filter.categoryId = '';
        render();
      }
      else if (act === 'fil-cat') {
        state.filter.categoryId = el.dataset.cat || '';
        render();
      }
      else if (act === 'add-cat') { openCategoryDialog(null, el.dataset.type); }
      else if (act === 'edit-cat') { openCategoryDialog(catOf(el.dataset.id), null); }
      else if (act === 'del-cat') { deleteCategoryFlow(el.dataset.id); }
      else if (act === 'export') { doExport(); }
      else if (act === 'import') { doImport(); }
      else if (act === 'clear-records') {
        askConfirm('清空所有账单？', '共 <b>' + state.allRecords.length + '</b> 笔记录将被删除，分类会保留。<br>此操作无法撤销。', '确认清空', true)
          .then(function (ok) {
            if (!ok) return;
            DB.clearRecords().then(function () { toast('已清空'); return refresh(); });
          });
      }
      else if (act === 'reset-all') {
        askConfirm('恢复出厂设置？', '所有账单和自定义分类都会被删除，分类恢复为默认。<br>此操作无法撤销，建议先导出备份。', '确认重置', true)
          .then(function (ok) {
            if (!ok) return;
            DB.resetAll().then(function () { toast('已重置'); return refresh(); });
          });
      }
    });

    // 面板委托
    $('#sheet').addEventListener('click', function (ev) {
      var el = ev.target.closest('[data-act]');
      if (!el || !state.editor) return;
      var act = el.dataset.act;

      if (act === 'ed-key') { pressKey(el.dataset.key); }
      else if (act === 'ed-type') {
        var t = el.dataset.type;
        if (state.editor.type === t) return;
        state.editor.type = t;
        state.editor.categoryId = '';
        renderSheet();
      }
      else if (act === 'ed-cat') {
        state.editor.categoryId = el.dataset.id;
        $$('#cat-grid .cat-item').forEach(function (b) { b.classList.toggle('on', b === el); });
        updateAmountView();
      }
      else if (act === 'ed-close') { closeSheet(); }
      else if (act === 'ed-save') { saveEditor(); }
      else if (act === 'ed-delete') {
        var id = state.editor.id;
        askConfirm('删除这笔记录？', '删除后无法恢复。', '删除', true).then(function (ok) {
          if (!ok) return;
          DB.deleteRecord(id).then(function () {
            closeSheet();
            toast('已删除');
            return refresh();
          });
        });
      }
    });

    // 遮罩关闭
    $('#sheet-backdrop').addEventListener('click', closeSheet);
    $('#dialog-backdrop').addEventListener('click', closeDialog);

    // 键盘支持（电脑上调试方便）
    document.addEventListener('keydown', function (ev) {
      if (!state.editor) return;

      var tag = (ev.target && ev.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';

      if (ev.key === 'Escape') { closeSheet(); return; }
      if (typing) {
        if (ev.key === 'Enter') { saveEditor(); ev.preventDefault(); }
        return;
      }
      if (ev.key >= '0' && ev.key <= '9') { pressKey(ev.key); ev.preventDefault(); }
      else if (ev.key === '.') { pressKey('.'); ev.preventDefault(); }
      else if (ev.key === 'Backspace') { pressKey('del'); ev.preventDefault(); }
      else if (ev.key === 'Enter') { saveEditor(); ev.preventDefault(); }
    });
  }

  /* ================= 启动 ================= */

  function boot() {
    bindGlobal();
    $$('.tab').forEach(function (t) { t.classList.toggle('on', t.dataset.view === 'home'); });

    refresh();

    // 注册 Service Worker（PWA 离线可用）
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* 忽略 */ });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
