/* =========================================================
   P3 · 情绪日历页
   - 日历网格按「周一起始」渲染，天数取当月实际天数
   - 打卡数据存 localStorage：{ 'YYYY-MM-DD': 'emotionId' }
   - 另外记录最后保存的日期，供首页跳转过来时自动定位
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  var KEY_RECORDS = 'epb:records';   // 全部打卡数据
  var KEY_LAST    = 'epb:last';      // 最后一次保存的日期
  var KEY_MOOD    = 'selectedMood';  // 确认时选中的情绪类型（'HAPPY' 这样的大写名）

  var MONTH_NAMES = [
    '一月', '二月', '三月', '四月', '五月', '六月',
    '七月', '八月', '九月', '十月', '十一月', '十二月'
  ];

  /* 六种情绪，顺序即弹窗里的展示顺序。
     · id   —— 内部用的小写名，日历打卡数据（epb:records）里存的就是它
     · mood —— 确认后写进 localStorage('selectedMood') 的大写类型名 */
  var EMOTIONS = [
    { id: 'calm',  name: '平静', mood: 'CALM' },
    { id: 'cry',   name: '哭泣', mood: 'CRY' },
    { id: 'happy', name: '开心', mood: 'HAPPY' },
    { id: 'angry', name: '愤怒', mood: 'ANGRY' },
    { id: 'tired', name: '心累', mood: 'TIRED' },
    { id: 'heart', name: '心动', mood: 'HEART-FLUTTERING' }
  ];

  var EMO_NAME = {};
  var EMO_MOOD = {};
  EMOTIONS.forEach(function (e) {
    EMO_NAME[e.id] = e.name;
    EMO_MOOD[e.id] = e.mood;
  });

  /* 老存档里出现过的两个 id（大笑 / 沮丧）。弹窗已经换成上面这 6 种，
     旧记录打开时先折到最接近的一档，免得回显时一个选项都不选中 */
  var EMO_ALIAS = { laugh: 'happy', down: 'tired' };

  function normalizeMood(id) {
    return EMO_MOOD[id] ? id : (EMO_ALIAS[id] || 'calm');
  }

  /* ---------------- DOM ---------------- */
  var gridEl        = document.getElementById('grid');
  var yearLabel     = document.getElementById('yearLabel');
  var monthLabel    = document.getElementById('monthLabel');
  var statEl        = document.getElementById('stat');
  var makeCardBtn   = document.getElementById('makeCardBtn');
  var toastEl       = document.getElementById('toast');

  var picker        = document.getElementById('picker');
  var pickerTitle   = document.getElementById('pickerTitle');
  var emoList       = document.getElementById('emoList');
  var pickerOk      = document.getElementById('pickerOk');
  var pickerCancel  = document.getElementById('pickerCancel');



  /* ---------------- 状态 ---------------- */
  var now       = new Date();
  var curYear   = now.getFullYear();
  var curMonth  = now.getMonth();
  var records   = loadRecords();
  var activeKey = null;      // 当前正在编辑的日期
  var pending   = null;      // 当前选中的情绪 id
  var toastTimer = null;

  /* =========================================================
     工具
     ========================================================= */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function dayKey(y, m, d) {
    return y + '-' + pad2(m + 1) + '-' + pad2(d);
  }

  function todayKey() {
    var t = new Date();
    return dayKey(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function loadRecords() {
    try {
      var raw = localStorage.getItem(KEY_RECORDS);
      var data = raw ? JSON.parse(raw) : null;
      return (data && typeof data === 'object') ? data : {};
    } catch (e) {
      return {};   // 隐私模式 / 数据损坏时静默降级
    }
  }

  function saveRecords() {
    try {
      localStorage.setItem(KEY_RECORDS, JSON.stringify(records));
    } catch (e) { /* 忽略写入失败 */ }
  }

  function markLast(key) {
    try { localStorage.setItem(KEY_LAST, key); } catch (e) {}
  }

  /* 选中的情绪类型（'HAPPY' / 'ANGRY' / 'HEART-FLUTTERING'…）单独存一份，
     别的页面要按「类型」取情绪时读这个键就行 */
  function saveMood(id) {
    try {
      localStorage.setItem(KEY_MOOD, EMO_MOOD[id] || '');
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function readLast() {
    try { return localStorage.getItem(KEY_LAST); } catch (e) { return null; }
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-on');
    }, 1600);
  }

  /* ---------------- 情绪球 ----------------
     每颗球 = 圆底（CSS 的 border-radius: 50%）+ 若干个像素块。
     零件表、DOM 结构都搬到了 js/mood.js —— P3 弹窗和 P4 海报
     右上角共用同一份，形状只在 css/mood.css 里定义一处。
     -------------------------------------------- */
  function moodBallHTML(id) {
    return Mood.ballHTML(id);
  }

  /* =========================================================
     弹窗开关
     ========================================================= */
  function openModal(el) {
    el.hidden = false;
    void el.offsetWidth;      // 强制重排，让入场动画每次都播
  }

  function closeModal(el) {
    el.hidden = true;
  }

  /* =========================================================
     渲染日历
     ========================================================= */
  function buildDay(d) {
    var key = dayKey(curYear, curMonth, d);
    var emo = records[key];

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day';
    btn.dataset.key = key;

    if (emo) {
      btn.classList.add('is-recorded');
      btn.title = EMO_NAME[normalizeMood(emo)] || '';
    }
    if (key === todayKey()) btn.classList.add('is-today');

    btn.innerHTML =
      '<span class="day__hole"><span class="day__num">' + d + '</span></span>';

    btn.addEventListener('click', function () {
      openPicker(key, d);
    });

    return btn;
  }

  function render() {
    yearLabel.textContent = curYear;
    monthLabel.textContent = MONTH_NAMES[curMonth];

    gridEl.innerHTML = '';

    // 该月 1 号是周几（把周日的 0 换算成 6，让周一当第一列）
    var lead = (new Date(curYear, curMonth, 1).getDay() + 6) % 7;
    for (var i = 0; i < lead; i++) {
      var blank = document.createElement('span');
      blank.className = 'day day--empty';
      gridEl.appendChild(blank);
    }

    var total = new Date(curYear, curMonth + 1, 0).getDate();   // 当月天数
    for (var d = 1; d <= total; d++) {
      gridEl.appendChild(buildDay(d));
    }

    updateStat();
  }

  function updateStat() {
    var prefix = curYear + '-' + pad2(curMonth + 1);
    var n = 0;
    Object.keys(records).forEach(function (k) {
      if (k.indexOf(prefix) === 0) n++;
    });
    statEl.textContent = '本月已记录 ' + n + ' 天';
  }

  /* 洞口果冻一下 */
  function popDay(key) {
    var el = gridEl.querySelector('[data-key="' + key + '"]');
    if (!el) return;
    el.classList.remove('is-pop');
    void el.offsetWidth;
    el.classList.add('is-pop');
    setTimeout(function () { el.classList.remove('is-pop'); }, 520);
  }

  /* =========================================================
     情绪选择弹窗
     ========================================================= */
  function renderEmoList() {
    emoList.innerHTML = '';

    EMOTIONS.forEach(function (e) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emo' + (pending === e.id ? ' is-on' : '');
      btn.innerHTML = moodBallHTML(e.id) + '<span>' + e.name + '</span>';

      btn.addEventListener('click', function () {
        pending = e.id;
        Array.prototype.forEach.call(emoList.children, function (c) {
          c.classList.remove('is-on');
        });
        btn.classList.add('is-on');
      });

      emoList.appendChild(btn);
    });
  }

  function openPicker(key, d) {
    activeKey = key;
    pending = normalizeMood(records[key]);   // 已记录就回显（含旧 id），否则默认平静

    pickerTitle.textContent = (curMonth + 1) + ' 月 ' + d + ' 日';
    renderEmoList();
    openModal(picker);
  }

  function confirmPick() {
    if (!activeKey || !pending) return;

    records[activeKey] = pending;
    saveRecords();
    markLast(activeKey);
    saveMood(pending);      // 选中的情绪类型（大写名）单独存一份

    closeModal(picker);
    render();
    popDay(activeKey);

    // 保存后弹出「生成情绪卡片」
    makeCardBtn.hidden = false;
    makeCardBtn.style.animation = 'none';
    void makeCardBtn.offsetWidth;
    makeCardBtn.style.animation = '';

    toast('已保存 · ' + EMO_NAME[pending]);
  }

  /* =========================================================
     生成情绪卡片 → 带过渡动画进入 P4 海报页
     ========================================================= */
  function openCard() {
    var key = readLast();
    var emo = key ? records[key] : null;

    if (!emo) {
      toast('先记录一天情绪吧');
      return;
    }

    // 先去过渡页看吃豆人吃糖豆（2.5 秒），再由它跳 p4.html。
    // 过渡已经在那一页演完，所以 P4 不再带 ?play
    location.href = 'transition.html';
  }

  /* =========================================================
     从首页跳转过来时，自动定位到上次保存的日期
     ========================================================= */
  function autoFocus() {
    if (location.search.indexOf('focus') === -1) return;

    var last = readLast();
    if (!last || !records[last]) return;

    var parts = last.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;

    // 上次记录的日期不在当前月，就先翻过去
    if (y !== curYear || m !== curMonth) {
      curYear = y;
      curMonth = m;
      render();
    }

    var el = gridEl.querySelector('[data-key="' + last + '"]');
    if (!el) return;

    setTimeout(function () {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('is-focus');
      setTimeout(function () {
        el.classList.remove('is-focus');
      }, 3200);
    }, 220);

    // 已经有记录了，卡片按钮也该在
    makeCardBtn.hidden = false;
  }

  /* =========================================================
     事件绑定
     ========================================================= */
  function bindEvents() {
    document.getElementById('prevYear').addEventListener('click', function () {
      curYear--; render();
    });
    document.getElementById('nextYear').addEventListener('click', function () {
      curYear++; render();
    });

    document.getElementById('prevMonth').addEventListener('click', function () {
      curMonth--;
      if (curMonth < 0) { curMonth = 11; curYear--; }
      render();
    });
    document.getElementById('nextMonth').addEventListener('click', function () {
      curMonth++;
      if (curMonth > 11) { curMonth = 0; curYear++; }
      render();
    });

    pickerOk.addEventListener('click', confirmPick);
    pickerCancel.addEventListener('click', function () { closeModal(picker); });

    makeCardBtn.addEventListener('click', openCard);

    // 点遮罩关闭
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-close]'),
      function (mask) {
        mask.addEventListener('click', function () {
          closeModal(mask.parentNode);
        });
      }
    );

    // ESC 关闭
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal(picker);
    });
  }

  /* ---------------- 启动 ---------------- */
  render();
  bindEvents();
  autoFocus();
})();
