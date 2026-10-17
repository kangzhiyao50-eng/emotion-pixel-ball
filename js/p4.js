/* =========================================================
   P4 · 情绪海报页
   - 过渡：黑色像素球从右到左吃糖球，吃完露出海报
   - 海报（从上到下）：
       折行的大字像素英文（Press Start 2P）→ 浅灰小号中文提示 →
       P2 捏出来的大表情 → 底部居中（日期 + 右侧的情绪小圆球）
   - 导出：原生 Canvas 重绘一遍，不依赖任何第三方库
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  var KEY_LAST    = 'epb:last';
  var KEY_RECORDS = 'epb:records';
  var KEY_FACE    = 'epb:face';
  var KEY_MOOD    = 'selectedMood';     // P3 确认打卡时写入的情绪类型（大写名）
  var KEY_EMOTION = 'savedEmotion';     // P2 点「保存」时写入的透明 PNG（Base64）

  /* 海报底色：整站唯一使用彩色的地方。
     前四个是原配色，后面依次加了红、灰 —— 都压过明度，
     保证纯黑标题字压在上面照样清楚，也不会抢中心那张表情 */
  var PALETTE = [
    '#ffe14d',   // 黄
    '#ffa8d8',   // 粉
    '#c9a7ff',   // 紫
    '#ffffff',   // 白
    '#7ec8ff',   // 蓝
    '#86e29b',   // 绿
    '#ffae6b',   // 橙
    '#ff6b6b',   // 红
    '#d9d9d9'    // 灰
  ];

  /* 情绪 id → 海报上的英文名。前四个和 P3 弹窗一一对应，
     tired / heart 是 P3 新加的两种情绪（心累 / 心动）；
     laugh / down 是旧数据里用过的 id，留着免得老打卡记录在海报上变成 'MOOD' */
  var EMO_EN = {
    calm: 'CALM', happy: 'HAPPY', laugh: 'LAUGH',
    cry: 'CRY', down: 'DOWN', angry: 'ANGRY',
    tired: 'TIRED', heart: 'HEART-FLUTTERING'
  };

  /* 英文正下方那句中文提示（浅灰） */
  var QUOTES = {
    calm:  '慢一点也没关系，你今天已经走得很好。',
    happy: '把这份开心存好，它会在下雨天派上用场。',
    laugh: '笑得这么大声，今天算是赢了。',
    cry:   '眼泪流完，眼睛会看得更清楚一点。',
    down:  '今天低一点没关系，明天自然会抬头。',
    angry: '生气是一股力气，记得用在值得的地方。',
    tired: '累了就歇一会儿，今天的账可以明天再算。',
    heart: '心跳漏一拍的那一下，值得被记下来。'
  };

  /* ---------------- 海报版式（逻辑尺寸 480×640，与 p4.css 对齐） ---------------- */
  var POSTER_W     = 480;
  var POSTER_H     = 640;
  var EXPORT_SCALE = 2.5;            // 导出 1200×1600

  var HEAD_X    = 48;                // 顶部文字块左边距
  var HEAD_Y    = 48;                // 顶部文字块上边距
  var HEAD_W    = POSTER_W - HEAD_X * 2;

  /* 英文：固定大号像素字。放不下就按字符折行（CSS 那边是 word-break），
     不再靠缩小字号来硬塞 —— 长词永远是两行大字 */
  var EMO_SIZE  = 36;
  var EMO_LINE  = 1.24;

  var NOTE_GAP  = 16;                // 英文和中文字之间的间距
  var NOTE_SIZE = 12;                // 辅助信息，小一号
  var NOTE_LINE = 1.7;

  var FACE_CY   = 372;               // 中心大表情的视觉中心（CSS 里同值）
  /* 脸的实体放到海报宽的 65%。P2 的 240 逻辑基准就是「脸的实体」，
     所以放大系数直接用 312 / 240（导出图那 264 里的 12 是透明呼吸位） */
  var FACE_W    = POSTER_W * .65;    // 312
  var FACE_ZOOM = FACE_W / 240;

  var FOOT_BOTTOM = 44;              // 底部一行距海报底边
  var DATE_SIZE   = 10;              // 日期字号
  var DATE_TRACK  = 2.8;             // 日期的字距（.28em × 10px）
  var BALL_SIZE   = 20;              // 情绪小圆球：72px 整颗缩到 20px
  var BALL_GAP    = 8;               // 日期和球之间的间距

  var EMO_FONT  = '"Press Start 2P", "Courier New", Consolas, monospace';
  var NOTE_FONT = '"SimSun", "Songti SC", "STSong", serif';

  /* ---------------- DOM ---------------- */
  var eaterEl    = document.getElementById('eater');
  var eaterTrack = document.getElementById('eaterTrack');
  var eaterMouth = document.getElementById('eaterMouth');
  var stageEl    = document.getElementById('stage');
  var wrapEl     = document.getElementById('posterWrap');
  var posterEl   = document.getElementById('poster');
  var emoEl      = document.getElementById('posterEmo');
  var noteEl     = document.getElementById('posterNote');
  var ballEl     = document.getElementById('posterBall');
  var faceEl     = document.getElementById('posterFace');
  var dateEl     = document.getElementById('posterDate');
  var toastEl    = document.getElementById('toast');

  /* ---------------- 数据 ---------------- */
  var lastKey  = readStr(KEY_LAST);
  var records  = readJSON(KEY_RECORDS) || {};
  var emoId    = (lastKey && records[lastKey]) || 'calm';

  /* P3 日历里最终选中的那颗球：优先读 selectedMood（大写类型名），
     没有就退回当天打卡记下的 id */
  var ballId   = Mood.idFromMood(readStr(KEY_MOOD)) || emoId;
  if (!Mood.isId(ballId)) ballId = 'calm';

  /* P2 存下来的表情数据（矢量兜底用）—— 出厂那份默认表情不再使用 */
  var faceData = readJSON(KEY_FACE);
  if (!faceData || faceData.v !== 1 || !faceData.parts) faceData = null;

  var faceImg  = null;      // 最终挂上去的那张表情（导出时直接 drawImage）
  var faceState = 'loading';   // loading 取图中 / ready 有图 / empty 确实没有
  var bgColor  = '';
  var toastTimer = null;

  /* ---------------- 小工具 ---------------- */
  function readStr(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /* 'YYYY-MM-DD' → 'YYYY.MM.DD'，没有记录就用今天 */
  function dateText(key) {
    if (!key) {
      var t = new Date();
      return t.getFullYear() + '.' + pad2(t.getMonth() + 1) + '.' + pad2(t.getDate());
    }
    var p = key.split('-');
    return p[0] + '.' + p[1] + '.' + p[2];
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-on');
    }, 1800);
  }

  /* =========================================================
     1. 中心表情 —— 只认 P2 捏出来的那张
     ---------------------------------------------------------
     ① 有 savedEmotion（P2 点保存时存的透明 PNG）→ 直接贴那张图；
     ② 读不到或者数据坏了 → 用 epb:face 的数据 + 和 P2 同一支画笔
        现画一遍（涂色、五官、配件一个不差）；
     ③ 两者都没有 → 只说一句「还没有表情」，绝不放初始表情。
     ========================================================= */
  function mountFace(img) {
    faceImg = img;
    faceState = 'ready';
    img.className = 'pface__img';
    img.alt = '我在捏脸页做的表情';

    /* P2 用 1 逻辑单位 = EXPORT_SCALE 像素导出，
       所以 naturalWidth / EXPORT_SCALE 就是这张图的逻辑边长，
       再乘 FACE_ZOOM 撑到海报上那一档 */
    var logical = img.naturalWidth / FaceArt.EXPORT_SCALE;
    var w = logical * FACE_ZOOM;
    var h = (img.naturalHeight / img.naturalWidth) * w;

    img.style.width  = w + 'px';
    img.style.height = h + 'px';

    faceEl.innerHTML = '';
    faceEl.appendChild(img);
  }

  /* 确实没有可用的表情时，页面和导出图都只说这一句，绝不放初始表情 */
  var NO_FACE_TEXT = ['还没有捏出表情', '回捏脸页做一个再保存吧'];

  function mountFromData() {
    if (!faceData || !FaceArt.hasContent(faceData)) {
      faceImg = null;
      faceState = 'empty';
      faceEl.innerHTML = '<p class="pface__none">' +
        NO_FACE_TEXT.join('<br>') + '</p>';
      return;
    }

    var cv = FaceArt.buildCanvas(faceData, FaceArt.EXPORT_SCALE);
    var img = new Image();
    img.onload = function () { mountFace(img); };
    img.src = cv.toDataURL('image/png');
  }

  function renderFace() {
    var url = readStr(KEY_EMOTION);

    if (!url) {
      mountFromData();
      return;
    }

    var probe = new Image();
    probe.onload = function () { mountFace(probe); };
    probe.onerror = function () { mountFromData(); };   // 存的数据坏了
    probe.src = url;
  }

  /* =========================================================
     2. 版面文字与情绪小圆球
     ========================================================= */
  function renderText() {
    emoEl.textContent  = EMO_EN[emoId] || 'MOOD';
    noteEl.textContent = QUOTES[emoId] || '';
    dateEl.textContent = dateText(lastKey);

    /* 字号以这里的常量为准：导出 canvas 用的是同一个值，两边不会脱节 */
    emoEl.style.fontSize = EMO_SIZE + 'px';

    /* 情绪小圆球：DOM 由共享模块拼（形状定义在 css/mood.css），
       位置就摆在底部日期的右边，由 .poster__foot 的 flex 排 ——
       页面和导出图都是这一颗 */
    ballEl.innerHTML = Mood.ballHTML(ballId);
  }

  function setColor(color) {
    bgColor = color;
    posterEl.style.setProperty('--pbg', color);
  }

  function pickColor(exclude) {
    var pool = PALETTE.filter(function (c) { return c !== exclude; });
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /* 按屏幕大小缩放海报 */
  function fitPoster() {
    var availW = window.innerWidth - 48;
    var availH = window.innerHeight - 220;

    var s = Math.min(1, availW / POSTER_W, availH / POSTER_H);
    if (s < 0.34) s = 0.34;

    wrapEl.style.width  = (POSTER_W * s) + 'px';
    wrapEl.style.height = (POSTER_H * s) + 'px';
    posterEl.style.setProperty('--pscale', s);
  }

  /* =========================================================
     3. 导出 PNG —— 原生 Canvas 重绘，不引任何库
     ========================================================= */
  /* 把文本切成「可断块」：连字符后、空格后都是合法断点。
     中文没有空格，整句就是一个断块 */
  function breakTokens(text) {
    var tokens = [];
    var cur = '';

    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      cur += ch;
      if (ch === '-' || ch === ' ') { tokens.push(cur); cur = ''; }
    }
    if (cur) tokens.push(cur);

    return tokens;
  }

  /* 按最大宽度折行，尽量落在单词边界上：
     HEART-FLUTTERING 会折成 HEART- / FLUTTERING，而不是从中间劈开
     （和页面上 .poster__emo 的 overflow-wrap: break-word 同一套规则）；
     万一有单个断块本身就超宽，才按字符硬断，保证永远不越界 */
  function wrapText(ctx, text, maxWidth) {
    var lines = [];
    var line = '';

    function flush() {
      while (line.length > 1 && ctx.measureText(line).width > maxWidth) {
        var cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
      if (line) { lines.push(line); line = ''; }
    }

    breakTokens(text).forEach(function (tk) {
      if (line && ctx.measureText(line + tk).width > maxWidth) flush();
      line += tk;
    });

    if (line) flush();

    return lines;
  }

  /* 中心表情：和页面上那张是同一张图，等比贴过去 */
  function drawFaceOnCanvas(ctx, cx, cy) {
    if (!faceImg || !faceImg.complete || !faceImg.naturalWidth) return;

    var w = (faceImg.naturalWidth / FaceArt.EXPORT_SCALE) * FACE_ZOOM;
    var h = (faceImg.naturalHeight / faceImg.naturalWidth) * w;

    // 4 倍清晰度缩到 65% 那一档：平滑缩放，形状和颜色原样（与页面上一致）
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(faceImg, cx - w / 2, cy - h / 2, w, h);
  }

  /* 没有表情可贴时，导出图上也写同一句（和页面上的 .pface__none 对齐） */
  function drawNoFace(ctx) {
    var lh = NOTE_SIZE * 1.9;
    var top = FACE_CY - (NO_FACE_TEXT.length * lh) / 2;

    ctx.fillStyle = '#999999';
    ctx.textAlign = 'center';
    ctx.font = NOTE_SIZE + 'px ' + NOTE_FONT;

    NO_FACE_TEXT.forEach(function (line, i) {
      ctx.fillText(line, POSTER_W / 2, top + i * lh + (lh - NOTE_SIZE) / 2);
    });

    ctx.textAlign = 'left';
  }

  /* 页面上的字距（letter-spacing）在 canvas 里得自己加 */
  function trackedWidth(ctx, text, track) {
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      w += ctx.measureText(text.charAt(i)).width + track;
    }
    return Math.max(0, w - track);
  }

  function drawTracked(ctx, text, x, y, track) {
    var cx = x;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + track;
    }
  }

  /* 底部一行：日期 + 右边紧挨着的情绪小圆球，整体水平居中
     （和 .poster__foot 的 flex 版对齐） */
  function drawFoot(ctx) {
    var dateStr = dateText(lastKey);
    var cy = POSTER_H - FOOT_BOTTOM - BALL_SIZE / 2;      // 这一行的中线

    ctx.font = DATE_SIZE + 'px ' + EMO_FONT;              // 日期同样走像素字
    var dw = trackedWidth(ctx, dateStr, DATE_TRACK);
    var left = POSTER_W / 2 - (dw + BALL_GAP + BALL_SIZE) / 2;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#999999';
    drawTracked(ctx, dateStr, left, cy, DATE_TRACK);

    // 球直接读页面上那颗真实渲染出来的球（形状只有 css/mood.css 一处定义）
    Mood.drawBall(ctx, ballEl.firstChild,
      left + dw + BALL_GAP + BALL_SIZE / 2, cy, BALL_SIZE);

    ctx.textBaseline = 'top';
  }

  /* 字体没加载完就导出，画出来的是回退字体 —— 先等字体就绪 */
  function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();

    // 中文提示现在是宋体（系统自带，不用等），只有像素英文需要等
    return document.fonts.load(EMO_SIZE + 'px "Press Start 2P"')
      .catch(function () { /* 连不上字体服务就用回退字体 */ });
  }

  function paintPoster() {
    var canvas = document.createElement('canvas');
    canvas.width  = Math.round(POSTER_W * EXPORT_SCALE);
    canvas.height = Math.round(POSTER_H * EXPORT_SCALE);

    var ctx = canvas.getContext('2d');
    ctx.scale(EXPORT_SCALE, EXPORT_SCALE);

    // 底色
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // ① 顶部像素英文：保持大号，放不下就按字符折行（与 CSS 的 word-break 同一套）
    ctx.fillStyle = '#000000';
    ctx.font = EMO_SIZE + 'px ' + EMO_FONT;

    var emoLh = EMO_SIZE * EMO_LINE;
    var emoLines = wrapText(ctx, EMO_EN[emoId] || 'MOOD', HEAD_W);
    emoLines.forEach(function (line, i) {
      ctx.fillText(line, HEAD_X, HEAD_Y + i * emoLh);
    });

    // ② 中文提示：起点跟着英文的最终行数走（一行一行，全是浅灰小字）
    var noteTop = HEAD_Y + emoLines.length * emoLh + NOTE_GAP;
    ctx.fillStyle = '#999999';
    ctx.font = NOTE_SIZE + 'px ' + NOTE_FONT;   // 宋体，与页面一致

    var noteLines = wrapText(ctx, QUOTES[emoId] || '', HEAD_W);
    noteLines.forEach(function (line, i) {
      ctx.fillText(line, HEAD_X, noteTop + i * NOTE_SIZE * NOTE_LINE);
    });

    // ③ 中心大表情：P2 捏的那张，放最后画 = 最上层
    if (faceImg && faceImg.complete && faceImg.naturalWidth) {
      drawFaceOnCanvas(ctx, POSTER_W / 2, FACE_CY);
    } else {
      drawNoFace(ctx);
    }

    // ④ 底部一行：日期 + 右侧紧挨着的情绪小圆球
    drawFoot(ctx);

    return canvas;
  }

  function exportPNG(tries) {
    tries = tries || 0;

    /* 表情是异步取来的（savedEmotion 解码 / 现画一张都要时间），
       还没就位就导出，海报中心会是空的 —— 先等它，最多等 3 秒 */
    if ((faceState === 'loading' || (faceImg && !faceImg.complete)) && tries < 30) {
      setTimeout(function () { exportPNG(tries + 1); }, 100);
      return;
    }

    ensureFonts().then(function () {
      var canvas = paintPoster();

      canvas.toBlob(function (blob) {
        if (!blob) {
          toast('导出失败，请再试一次');
          return;
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'emotion-poster-' + dateText(lastKey).replace(/\./g, '') + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        toast('海报已下载');
      }, 'image/png');
    });
  }

  /* =========================================================
     4. 过渡：从右到左吃糖球
     ========================================================= */
  /* 实心像素圆（吃糖球的那个黑球） */
  function buildDisk(el, n, cell) {
    var c = (n - 1) / 2;
    var shadows = [];

    for (var row = 0; row < n; row++) {
      for (var col = 0; col < n; col++) {
        var dx = col - c;
        var dy = row - c;
        if (Math.sqrt(dx * dx + dy * dy) <= c + 0.35) {
          shadows.push(
            (col * cell + cell / 2) + 'px ' +
            (row * cell + cell / 2) + 'px 0 ' +
            (cell / 2) + 'px var(--ink)'
          );
        }
      }
    }
    el.style.boxShadow = shadows.join(', ');
  }

  function playTransition(done) {
    buildDisk(eaterMouth, 8, 14);      // 8×8 像素圆，112px

    var COUNT = 11;
    var positions = [];
    var candies = [];
    var i;

    for (i = 0; i < COUNT; i++) {
      var vw = 8 + (84 * i) / (COUNT - 1);   // 8vw ~ 92vw
      positions.push(vw);

      var c = document.createElement('span');
      c.className = 'candy';
      c.style.left = vw + 'vw';
      eaterTrack.appendChild(c);
      candies.push(c);
    }

    var DURATION = 2400;   // 2.4s，落在要求的 2~4 秒里
    var FROM = 114;        // 起点（视口宽百分比，完全在屏幕外）
    var TO   = 0;          // 终点：扫到屏幕左边缘，最后一颗糖刚好被吃掉
    var CHOMP_MS = 220;    // 咀嚼一下的时长
    var t0 = null;
    var lastEat = -1e9;

    function frame(t) {
      if (t0 === null) t0 = t;

      var p = Math.min(1, (t - t0) / DURATION);
      var x = FROM + (TO - FROM) * p;

      // 黑球越过哪颗糖球，哪颗就被吃掉
      for (var k = 0; k < COUNT; k++) {
        if (!candies[k]._eaten && x <= positions[k]) {
          candies[k]._eaten = true;
          candies[k].classList.add('is-eaten');
          lastEat = t;
        }
      }

      // 刚吞下一颗时鼓一下，让「吃」有反馈
      var dt = t - lastEat;
      var chomp = dt < CHOMP_MS
        ? 1 + 0.14 * Math.sin((1 - dt / CHOMP_MS) * Math.PI)
        : 1;

      eaterMouth.style.transform =
        'translate(' + x + 'vw, -50%) scale(' + chomp.toFixed(3) + ')';

      if (p < 1) {
        requestAnimationFrame(frame);
      } else {
        eaterEl.classList.add('is-done');
        setTimeout(done, 340);
      }
    }

    requestAnimationFrame(frame);
  }

  /* =========================================================
     5. 启动
     ========================================================= */
  function showStage() {
    stageEl.hidden = false;
  }

  function init() {
    fitPoster();
    renderText();
    renderFace();
    setColor(pickColor(null));

    document.getElementById('shuffleBtn').addEventListener('click', function () {
      setColor(pickColor(bgColor));      // 换一个跟当前不同的颜色
    });

    document.getElementById('downloadBtn').addEventListener('click', function () {
      exportPNG();     // 包一层：别把事件对象当成重试次数传进去
    });

    window.addEventListener('resize', fitPoster);

    // 从 P3 点进来才播过渡，直接刷新页面就直接看海报
    if (location.search.indexOf('play') !== -1) {
      playTransition(showStage);
    } else {
      eaterEl.hidden = true;
      showStage();
    }
  }

  init();
})();
