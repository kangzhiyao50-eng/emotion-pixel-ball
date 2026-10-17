/* =========================================================
   P2 · 情绪捏脸页交互
   - 像素球圆环：由 12x12 掩码生成 box-shadow 点阵
   - 眼睛 / 嘴巴：mousedown → mousemove → mouseup 拖拽
     · 拖拽中自由跟随鼠标（不设限）
     · 松手时算出边界内的落点，用 jelly 曲线弹回去
   - 嘴巴：水平拖动改位置，垂直拖动改弧度
   - 配件：从右侧托盘拖出幽灵方块，放到球上生成配件
            已放置的配件可再拖动，拖出球外即丢弃
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  var CELL = 20;                 // 五官像素块尺寸：眼睛占 2 格、每个嘴块占 1 格
  var BALL_SIZE = 240;           // 逻辑基准边长。人脸内部坐标一律以它为基准
  var CENTER = BALL_SIZE / 2;    // 球心坐标 (120, 120)
  var MOUTH_CURVE_RANGE = 64;    // 垂直拖动多少像素 = 满弧度
  var POP_MS = 520;              // 落地弹跳动画时长

  /* 拼豆涂色栅格：和人脸里那把 24×24 的圆环画布同一套栅格，
     所以一个「拼豆」= 10 逻辑单位，正好是圆环 1 格的四分之一。
     想换更粗/更细的颗粒，改 PAINT_N 一处即可（48 就要同步改 .paint-cursor 的 --u 倍数） */
  var PAINT_N = 24;
  var PAINT_CELL = BALL_SIZE / PAINT_N;   // 单个拼豆的逻辑边长 = 10
  var PAINT_R = 88;                       // 只铺圆环内部：环内侧离球心最近约 89.4
  var PAINT_TOTAL = PAINT_N * PAINT_N;

  /* 底色盘半径（逻辑单位）：圆环内圈最靠里的那批空格子约在 99，
     再往外（四角那些 127 左右的格子）就已经在脸外面了，不能铺底色 */
  var BASE_R = 100;

  /* 人脸尺寸吸附到 SNAP_UNIT 的整数倍。
     48 是「圆环 12 格 / 拼豆 24 格 / 配件像素 48 格」三套栅格的公倍数，
     吸附之后三套栅格每一格都是整数屏幕像素，边缘不会被抹出灰边 */
  var SNAP_UNIT = 48;

  /* 配件的像素格：1 格 = 5 逻辑单位 = 240 / 48 */
  var PROP_CELL = BALL_SIZE / SNAP_UNIT;
  var SWATCH_CELL = 2;                    // 托盘缩略图每格 2px（定点大小，不随人脸变）
  var PROP_MIN_SCALE = 0.4;
  var PROP_MAX_SCALE = 4;

  /* 调色盘：白 红 蓝 紫 黑 绿 黄 粉 橘。
     mark 是这个颜色在存档里的字符，拼豆每个格子只存一个字符，
     576 个字符就是一整张脸；'.' 表示这个格子是空的 */
  var EMPTY = '.';

  var PALETTE = [
    { name: '白色', mark: 'w', hex: '#ffffff' },
    { name: '红色', mark: 'r', hex: '#ff3b3b' },
    { name: '蓝色', mark: 'b', hex: '#2f8fff' },
    { name: '紫色', mark: 'p', hex: '#a06bff' },
    { name: '黑色', mark: 'k', hex: '#000000' },
    { name: '绿色', mark: 'g', hex: '#3fcf5e' },
    { name: '黄色', mark: 'y', hex: '#ffd93d' },
    { name: '粉色', mark: 'i', hex: '#ffa8d8' },
    { name: '橘色', mark: 'o', hex: '#ff9a3d' }
  ];

  var PALETTE_HEX = (function () {
    var map = {};
    for (var i = 0; i < PALETTE.length; i++) map[PALETTE[i].mark] = PALETTE[i].hex;
    return map;
  })();

  /* mark → 颜色值，空格子返回空串（等于恢复透明） */
  function colorHex(mark) {
    return PALETTE_HEX[mark] || '';
  }

  var PART_INK = '#000000';       // 五官、圆环、底色的出厂值
  var FACE_PAPER = '#ffffff';


  /* ---------------- 渲染缩放 ----------------
     人脸的渲染尺寸由 CSS 的 --size 决定（随窗口变化），但内部坐标
     始终是 240 基准的逻辑坐标 —— 这正是 localStorage 里存着、
     P4 海报页要读的那套数据。这里只管换算：
     存进去的是逻辑坐标，乘上 renderScale 才是屏幕像素。
     -------------------------------------------- */
  var renderScale = 1;

  /* 人脸边长由 CSS 的 --size 算出来，偏偏 50vh / 40vw 在大多数屏幕上都是小数。
     小数边长铺格子，浏览器只能把余数摊给其中几格，于是格子宽度参差不齐，
     像素块的边界就被"抹"出半像素灰边。这里把尺寸吸附到 SNAP_UNIT 的整数倍：
     48 格 × 整数像素 = 每格都是整数，边缘永远是硬切。
     顺带让鼠标坐标换算、涂色落点也全部落在整数像素上，点哪格就是哪格。

     每次先删掉内联值再量，量到的才是 CSS 公式（含窄屏媒体查询）的真实结果。 */
  function syncScale() {
    ballEl.style.removeProperty('--size');

    var target = ballEl.getBoundingClientRect().width;
    if (target > 0) {
      var snapped = Math.max(SNAP_UNIT, Math.round(target / SNAP_UNIT) * SNAP_UNIT);
      ballEl.style.setProperty('--size', snapped + 'px');
    }

    var w = ballEl.getBoundingClientRect().width;
    renderScale = w > 0 ? w / BALL_SIZE : 1;
    return renderScale;
  }

  /* 逻辑长度 → 屏幕像素 */
  function px(logical) {
    return logical * renderScale;
  }

  /* 12×12 像素圆环掩码，'#' 为黑色像素 */
  var RING_MASK = [
    '....####....',
    '..##....##..',
    '.#........#.',
    '.#........#.',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '.#........#.',
    '.#........#.',
    '..##....##..',
    '....####....'
  ];

  /* 嘴巴 6 个像素的弧度权重：两端不动，中间 4 个随弧度起伏 */
  var MOUTH_SHAPE = [0, 1, 1, 1, 1, 0];

  /* 五官初始位置与可活动范围 */
  var PARTS = {
    'eye-l': { x: 80,  y: 80,  limit: 78 },
    'eye-r': { x: 160, y: 80,  limit: 78 },
    'mouth': { x: 120, y: 160, rx: 22, ry: 60 }
  };

  /* ---------------- DOM ---------------- */
  var ballEl = document.getElementById('ball');
  var ringEl = document.getElementById('ballRing');
  var paintEl = document.getElementById('ballPaint');
  var tipEl = document.getElementById('studioTip');
  var paintTool = document.getElementById('modePaint');
  var moveTool = document.getElementById('modeMove');
  var clearBtn = document.getElementById('paintClear');
  var resetBtn = document.getElementById('resetAll');
  var saveBtn = document.getElementById('saveBtn');
  var nextBtn = document.getElementById('nextBtn');
  var toastEl = document.getElementById('toast');
  var bucketTool = document.getElementById('modeBucket');
  var palette = document.getElementById('palette');
  var paletteBtn = document.getElementById('paletteBtn');
  var palettePanel = document.getElementById('palettePanel');
  var palettePip = document.getElementById('palettePip');
  var brushEl = null;            // 笔刷方块，initPaint 里建
  var recordsBtn = document.getElementById('recordsBtn');
  var recordsEl = document.getElementById('records');
  var recordsGrid = document.getElementById('recordsGrid');
  var recordsEmpty = document.getElementById('recordsEmpty');
  var recordsClose = document.getElementById('recordsClose');

  /* 脸部配色：底色 + 圆环描边色。
     两者都挂成 CSS 变量，改一次整张脸跟着变 */
  var faceSkin = { base: FACE_PAPER, ring: PART_INK };

  function applySkin() {
    ballEl.style.setProperty('--face-base', faceSkin.base);
    ballEl.style.setProperty('--face-ring', faceSkin.ring);
  }

  function setSkin(which, hex) {
    faceSkin[which] = hex;
    applySkin();
  }

  /* 五官的颜色挂在各自的 .part 上，两只眼睛和嘴巴互不影响 */
  function setPartColor(key, hex) {
    var cur = partState[key];
    var el = ballEl.querySelector('[data-part="' + key + '"]');
    if (!cur || !el) return;

    cur.color = hex;
    el.style.setProperty('--face-part', hex);
    syncPartFlags();          // 上过色的五官就不再是「初始表情」了
  }

  /* ---------------- 顶部提示条 ----------------
     文案是可变的，用完还原成 HTML 里写的那句 */
  var TOAST_TEXT = toastEl.textContent;
  var toastTimer = null;

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-on');
      toastEl.textContent = TOAST_TEXT;
    }, 1600);
  }

  /* ---------------- 表情状态（供保存到 localStorage 用） ---------------- */
  var FACE_KEY = 'epb:face';
  var RECORDS_KEY = 'epb:faces';   // 表情记录：和 P4 海报页读的 epb:face 分开存
  var RECORDS_MAX = 24;            // 最多留 24 条，超了从最旧的开始丢
  /* 导出图的 Base64（PNG dataURL）。P3 选完心情进 P4 生成海报时，
     海报中心贴的就是这张图 —— 涂的像素、拖的配件一个不差 */
  var EMOTION_KEY = 'savedEmotion';

  var partState = {};    // { 'eye-l': {x,y}, 'eye-r': {x,y}, 'mouth': {x,y,curve} }
  var propState = [];    // [ { prop, color, x, y } ]
  var savedFace = null;  // 上次存在 localStorage 里的表情

  /* ---------------- 表情存取 ----------------
     存一份到 localStorage，P4 海报页会读同一份数据来复现这张脸 */
  function loadFace() {
    try {
      var raw = localStorage.getItem(FACE_KEY);
      var data = raw ? JSON.parse(raw) : null;
      return (data && data.v === 1) ? data : null;
    } catch (e) {
      return null;
    }
  }

  /* 五官的快照：只留要存的那几个字段，避免把 DOM 相关的属性也带进去 */
  function clonePart(key) {
    var cur = partState[key] || {};

    return {
      x: cur.x,
      y: cur.y,
      curve: cur.curve || 0,
      color: cur.color || PART_INK
    };
  }

  /* 把当前这张脸序列化成一份存档。
     保存到 localStorage、导出 PNG、追加一条表情记录，三处共用这一份，
     格式完全一致 —— 存下来的记录才能原样载回画布 */
  function makeFaceData() {
    return {
      v: 1,
      parts: {
        'eye-l': clonePart('eye-l'),
        'eye-r': clonePart('eye-r'),
        'mouth': clonePart('mouth')
      },
      /* 配件：必须是「快照」而不是 propState 里的活对象，
         否则记录会跟着画布上的拖拽一起变 */
      props: propState.map(function (p) {
        return {
          prop: p.prop,
          color: p.color,
          x: p.x,
          y: p.y,
          rot: p.rot,
          scale: p.scale
        };
      }),
      /* 脸部配色：底色 / 圆环描边色 */
      skin: { base: faceSkin.base, ring: faceSkin.ring },
      /* 拼豆涂色：24×24 = 576 个字符，行优先展开。
         每个字符是颜色的 mark（白 w 红 r 蓝 b 紫 p 黑 k 绿 g 黄 y
         粉 i 橘 o），'.' 表示这一格是空的。
         P4 海报页读同一份数据照着铺格子即可 */
      paint: paintData.join('')
    };
  }

  function saveFace() {
    try {
      localStorage.setItem(FACE_KEY, JSON.stringify(makeFaceData()));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  /* ---------------- 工具函数 ---------------- */
  function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  /* 鼠标是否落在球体圆形范围内（不是外接矩形） */
  function isOverBall(ev) {
    var r = ballEl.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var dx = ev.clientX - cx;
    var dy = ev.clientY - cy;
    return Math.sqrt(dx * dx + dy * dy) <= r.width / 2;
  }

  /* =========================================================
     1. 生成像素画布
     24×24 的 CSS Grid 里，把 RING_MASK 点亮的那几格填黑。
     掩码是 12×12，映射时每个像素块跨 2×2 格，
     所以底层网格细了一倍，颗粒大小和原来完全一样。
     ========================================================= */
  function buildCanvas() {
    var frag = document.createDocumentFragment();
    var blocks = RING_MASK.length;
    var unit = BALL_SIZE / blocks;        // 掩码 1 格 = 20 逻辑单位

    for (var row = 0; row < blocks; row++) {
      var line = RING_MASK[row];
      for (var col = 0; col < blocks; col++) {
        var isRing = line.charAt(col) === '#';

        if (!isRing) {
          // 掩码里的空格子：圆环内圈的铺成「底色盘」（颜色由 --face-base 控制），
          // 圆环外面的不铺 —— 否则脸的方形四角也会跟着变色
          var dx = (col + 0.5) * unit - CENTER;
          var dy = (row + 0.5) * unit - CENTER;
          if (Math.sqrt(dx * dx + dy * dy) > BASE_R) continue;
        }

        var dot = document.createElement('i');
        if (!isRing) dot.className = 'base-px';

        // 掩码 1 格 = 画布 2 格；grid-area 的行列号都从 1 开始数
        dot.style.gridArea =
          (row * 2 + 1) + ' / ' + (col * 2 + 1) + ' / span 2 / span 2';
        frag.appendChild(dot);
      }
    }

    ringEl.appendChild(frag);
  }

  /* =========================================================
     2. 通用拖拽绑定
     onStart()          → 返回本次拖拽的上下文
     onMove(dx, dy, c)  → 相对按下点的位移
     onEnd(ctx, ev)     → 松手
     ========================================================= */
  function bindDrag(el, onStart, onMove, onEnd) {
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();

      var startX = e.clientX;
      var startY = e.clientY;
      var ctx = onStart();

      el.classList.remove('is-landing');
      el.classList.add('is-dragging');

      function move(ev) {
        onMove(ev.clientX - startX, ev.clientY - startY, ctx, ev);
      }

      function up(ev) {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        el.classList.remove('is-dragging');
        onEnd(ctx, ev);
      }

      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  /* 松手落地：重新触发一次弹跳动画 */
  function playPop(el) {
    el.classList.remove('is-landing');
    void el.offsetWidth;              // 强制重排，让动画可以重播
    el.classList.add('is-landing');
    clearTimeout(el._popTimer);
    el._popTimer = setTimeout(function () {
      el.classList.remove('is-landing');
    }, POP_MS);
  }

  function setPartPos(el, x, y) {
    el.style.transform = 'translate(' + px(x) + 'px, ' + px(y) + 'px)';
    syncPartFlags();          // 拖过的五官不再算「初始表情」
  }

  /* 按弧度把 6 个嘴块上下错开。offset 是逻辑长度，交给 px() 换算 */
  function renderMouth(el, curve) {
    var spans = el.querySelectorAll('.mouth__px > span');
    for (var i = 0; i < spans.length; i++) {
      var offset = -curve * MOUTH_SHAPE[i] * CELL;
      spans[i].style.transform = 'translateY(' + px(offset) + 'px)';
    }
  }

  /* ---------------- 「初始表情」判定 ----------------
     出厂的方眼睛 + 一字嘴只是页面自带的一个起点，不是用户的作品。
     只要用户动过一下（拖过位置 / 拉过嘴巴弧度 / 换过颜色），
     它就算用户自己的五官，之后一切照旧。

     这个判定影响两处：
     · 移动 / 缩放模式：初始表情不显示 —— 脸内空白（只剩外轮廓），
       留给用户自己涂的像素和要摆的配件；
     · 导出 PNG：初始表情不画 —— 绝不会混进用户的作品里。
     -------------------------------------------------- */
  function isDefaultExpr(key, cur) {
    var cfg = PARTS[key];
    if (!cfg || !cur) return true;

    var moved = Math.abs(cur.x - cfg.x) > 0.5 ||
                Math.abs(cur.y - cfg.y) > 0.5;
    var curved = key === 'mouth' && Math.abs(cur.curve || 0) > 0.001;

    return !moved && !curved && (cur.color || PART_INK) === PART_INK;
  }

  /* 把判定结果同步成元素上的 is-default 类（显示与否交给 CSS 管）。
     拖拽 / 上色 / 读档 / 恢复起始之后都会自动刷一次 */
  function syncPartFlags() {
    Object.keys(PARTS).forEach(function (key) {
      var el = ballEl.querySelector('[data-part="' + key + '"]');
      if (el) {
        el.classList.toggle('is-default', isDefaultExpr(key, partState[key]));
      }
    });
  }

  /* 把五官中心收回允许范围内 */
  function clampPart(key, cur) {
    var cfg = PARTS[key];

    if (key === 'mouth') {
      var mx = clamp(cur.x - cfg.x, -cfg.rx, cfg.rx);
      var my = clamp(cur.y - cfg.y, -cfg.ry, cfg.ry);
      return { x: cfg.x + mx, y: cfg.y + my };
    }

    var ox = cur.x - CENTER;
    var oy = cur.y - CENTER;
    var d = Math.sqrt(ox * ox + oy * oy);
    if (d <= cfg.limit) return { x: cur.x, y: cur.y };

    var k = cfg.limit / d;
    return { x: CENTER + ox * k, y: CENTER + oy * k };
  }

  /* =========================================================
     3. 眼睛 / 嘴巴拖拽
     ========================================================= */
  function initParts() {
    Object.keys(PARTS).forEach(function (key) {
      var el = ballEl.querySelector('[data-part="' + key + '"]');
      var cfg = PARTS[key];

      /* 当前状态：位置 + 弧度。挂到 partState 上，
         后面 save 时直接序列化即可（同一对象引用，拖拽时同步变化） */
      var old = (savedFace && savedFace.parts && savedFace.parts[key]) || null;
      var cur = old
        ? { x: old.x, y: old.y, curve: old.curve || 0,
            color: old.color || PART_INK }
        : { x: cfg.x, y: cfg.y, curve: 0, color: PART_INK };
      partState[key] = cur;

      // 五官各自的颜色（油漆桶可以单独改）挂在元素上，子元素继承
      el.style.setProperty('--face-part', cur.color);

      // 注意：这里必须用顶层的 renderMouth(el, curve)，
      // 它会用 px() 把逻辑长度换算成屏幕像素；本地再写一份会漏掉缩放
      setPartPos(el, cur.x, cur.y);
      if (key === 'mouth') renderMouth(el, cur.curve);

      bindDrag(
        el,
        function () {
          return { x: cur.x, y: cur.y, curve: cur.curve };
        },
        function (dx, dy, base) {
          // bindDrag 给的是屏幕像素位移，先换算回 240 基准的逻辑单位，
          // 否则人脸缩放后，拖拽速度会和鼠标对不上
          dx = dx / renderScale;
          dy = dy / renderScale;

          if (key === 'mouth') {
            // 水平拖动改位置，垂直拖动改弧度，两个维度互不干扰
            cur.x = base.x + dx;
            cur.y = base.y;
            cur.curve = clamp(base.curve - dy / MOUTH_CURVE_RANGE, -1, 1);
            renderMouth(el, cur.curve);
          } else {
            cur.x = base.x + dx;
            cur.y = base.y + dy;
          }
          setPartPos(el, cur.x, cur.y);
        },
        function () {
          // 松手：先算边界内的目标点，靠 CSS transition 弹回去
          var safe = clampPart(key, cur);
          cur.x = safe.x;
          cur.y = safe.y;
          setPartPos(el, cur.x, cur.y);
          playPop(el);
        }
      );
    });

    // 出厂位置 / 出厂颜色就是「初始表情」，这里先标一次
    syncPartFlags();
  }

  /* =========================================================
     4. 配件：纯 div 画的像素图形
     ---------------------------------------------------------
     PROP_ART 里一张字符掩码 = 一个配件：'#' 是实心像素，'.' 是空。
     托盘缩略图、拖拽幽灵、落到脸上的实体，全都由这一张掩码经
     buildPixels() 铺格子画出来 —— 没有一张外部图片，形状和颜色
     只有一处定义，改掩码三处同时变。

     一个像素格 = PROP_CELL 个逻辑单位（= 人脸 240 基准的 1/48）。
     syncScale() 把脸的实际尺寸吸附到 48 的整数倍，所以每格永远
     是整数屏幕像素，边缘是硬切的，放大缩小都不会糊。
     ========================================================= */
  var PROP_ART = {
    'heart': {
      color: '#ff3b3b',
      mask: [
        '.##..##.',
        '########',
        '########',
        '########',
        '.######.',
        '..####..',
        '...##...'
      ]
    },
    'tear-long': {
      color: '#2f8fff',
      mask: [
        '..#..',
        '..#..',
        '.###.',
        '.###.',
        '#####',
        '#####',
        '#####',
        '#####',
        '#####',
        '.###.',
        '.###.',
        '..#..'
      ]
    },
    'tear-drop': {
      color: '#2f8fff',
      mask: [
        '..#..',
        '.###.',
        '#####',
        '#####',
        '#####',
        '.###.',
        '..#..'
      ]
    },
    'blush': {
      color: '#ffa8d8',
      mask: [
        '..######..',
        '.########.',
        '##########',
        '##########',
        '.########.',
        '..######..'
      ]
    },
    'ring': {
      color: '#2f8fff',
      mask: [
        '..########..',
        '.#........#.',
        '#..........#',
        '#..........#',
        '#..........#',
        '#..........#',
        '.#........#.',
        '..########..'
      ]
    },
    'glasses': {
      color: '#000000',
      mask: [
        '.########..########.',
        '####################',
        '####################',
        '####################',
        '.########..########.'
      ]
    },
    'hat': {
      color: '#000000',
      mask: [
        '...############...',
        '...############...',
        '...############...',
        '...############...',
        '...############...',
        '...############...',
        '...############...',
        '..##############..',
        '..##############..',
        '##################',
        '##################'
      ]
    },
    'anger': {
      color: '#ff3b3b',
      mask: [
        '##....##',
        '###..###',
        '..####..',
        '..#..#..',
        '..#..#..',
        '..####..',
        '###..###',
        '##....##'
      ]
    }
  };

  // 旧存档里用过 'drop' 这个名字，指过去免得老数据丢失
  PROP_ART['drop'] = PROP_ART['tear-drop'];

  /* 把一张掩码铺成一格一个 <i> 的像素图。
     fill 为真时不写死尺寸，交给 CSS 撑满父盒子（脸上的实体用它，
     人脸缩放时只改父盒子就行，不用重建 DOM）；
     color 不给就用配件自带的颜色 */
  function buildPixels(art, cell, fill, color) {
    var ink = color || art.color;
    var mask = art.mask;
    var cols = mask[0].length;
    var rows = mask.length;

    var box = document.createElement('span');   // span 才能合法地塞进缩略图那个 <i> 里
    box.className = 'px-art';
    box.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    box.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';
    if (!fill) {
      box.style.width = (cols * cell) + 'px';
      box.style.height = (rows * cell) + 'px';
    }

    var frag = document.createDocumentFragment();
    for (var r = 0; r < rows; r++) {
      var line = mask[r];
      for (var c = 0; c < cols; c++) {
        if (line.charAt(c) !== '#') continue;

        var dot = document.createElement('i');
        dot.style.background = ink;
        dot.style.gridArea = (r + 1) + ' / ' + (c + 1);
        frag.appendChild(dot);
      }
    }
    box.appendChild(frag);
    return box;
  }

  function artSize(art) {
    return {
      w: art.mask[0].length * PROP_CELL,
      h: art.mask.length * PROP_CELL
    };
  }

  function createGhost(art, ev) {
    var size = artSize(art);
    var ghost = document.createElement('div');

    ghost.className = 'ghost';
    // 幽灵就是配件本体，尺寸按人脸当前缩放算，落点预览所见即所得
    ghost.style.width = px(size.w) + 'px';
    ghost.style.height = px(size.h) + 'px';
    ghost.appendChild(buildPixels(art, px(PROP_CELL)));
    ghost.style.transform = 'translate(-200px, -200px)';

    document.body.appendChild(ghost);
    moveGhost(ghost, ev.clientX, ev.clientY);
    return ghost;
  }

  function moveGhost(ghost, cx, cy) {
    ghost.style.transform =
      'translate(' + cx + 'px, ' + cy + 'px) translate(-50%, -50%)';
  }

  /* ---------------- 位置 / 缩放 / 旋转 ----------------
     三个状态合成一条 transform，顺序不能换：
       translate 定位 → translate(-50%,-50%) 把中心对准坐标 →
       scale → rotate
     scale/rotate 在 -50% 之后，才会绕配件自身的中心进行，
     不管放大多少倍、转多少度，中心点都钉在 (x, y) 上不跑。
     -------------------------------------------------- */
  function applyProp(el, scaleOverride) {
    var s = (scaleOverride === undefined) ? el._scale : scaleOverride;

    el.style.transform =
      'translate(' + px(el._x) + 'px, ' + px(el._y) + 'px) ' +
      'translate(-50%, -50%) scale(' + s + ') rotate(' + el._rot + 'deg)';

    if (el === selectedProp) updateHandle();
  }

  function setPropPos(el, x, y) {
    el._x = x;
    el._y = y;
    if (el._data) {          // 同步到待保存的数据（存的始终是逻辑坐标）
      el._data.x = x;
      el._data.y = y;
    }
    applyProp(el);
  }

  function setPropScale(el, s) {
    el._scale = s;
    if (el._data) el._data.scale = s;
    applyProp(el);
  }

  function setPropRot(el, deg) {
    // 归一化到 (-180, 180]，存进 localStorage 的数字干净一点
    deg = ((deg + 180) % 360 + 360) % 360 - 180;
    el._rot = deg;
    if (el._data) el._data.rot = deg;
    applyProp(el);
  }

  /* 人脸尺寸变了，配件的盒子要重新按新缩放定尺寸
     （内部格子是 1fr，会自己跟着盒子变） */
  function sizeProp(el) {
    el.style.width = px(el._w) + 'px';
    el.style.height = px(el._h) + 'px';
  }

  /* 油漆桶：把整个配件的像素换成新颜色（批量，逐个格子改背景） */
  function applyPropColor(el, hex) {
    el._color = hex;
    if (el._data) el._data.color = hex;

    var dots = el.querySelectorAll('.px-art > i');
    for (var i = 0; i < dots.length; i++) {
      dots[i].style.background = hex;
    }
  }

  /* 从待保存数据里摘掉一个配件 */
  function removePropData(el) {
    var i = propState.indexOf(el._data);
    if (i > -1) propState.splice(i, 1);
  }

  /* 在球上落一个配件（坐标为球内坐标，尺寸由掩码决定）
     color 不给就用配件自带的颜色；改过色的配件靠它还原 */
  function placeProp(prop, x, y, rot, scale, color) {
    var art = PROP_ART[prop];
    if (!art) return;

    var ink = color || art.color;
    var size = artSize(art);
    var el = document.createElement('div');

    el.className = 'prop';
    el.dataset.prop = prop;
    el.style.opacity = '0';
    el.appendChild(buildPixels(art, 0, true, ink));   // fill：撑满盒子

    el._x = x;
    el._y = y;
    el._w = size.w;
    el._h = size.h;
    el._rot = rot || 0;
    el._scale = scale || 1;
    el._color = ink;
    el._data = {
      prop: prop,
      color: ink,                // 给 P4 海报页用
      x: x,
      y: y,
      rot: el._rot,
      scale: el._scale
    };
    propState.push(el._data);

    sizeProp(el);
    applyProp(el, 0.2);          // 先缩成一点，再弹开
    ballEl.appendChild(el);

    // 下一帧再改终点，触发弹性出现
    requestAnimationFrame(function () {
      el.style.opacity = '1';
      applyProp(el);
    });

    makePropDraggable(el);
  }

  /* 已放置的配件：点一下选中并能拖，滚轮缩放，拖出球外丢掉 */
  function makePropDraggable(el) {
    el.addEventListener('wheel', function (e) {
      e.preventDefault();               // 别让页面跟着一起滚
      selectProp(el);
      bumpPropScale(el, e.deltaY < 0 ? 1 : -1);
    }, { passive: false });

    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      selectProp(el);

      var startX = e.clientX;
      var startY = e.clientY;
      var x = el._x;
      var y = el._y;

      el.classList.add('is-dragging');
      el.style.transition = 'none';

      function move(ev) {
        // 鼠标位移是屏幕像素，换算回逻辑单位再累加
        x += (ev.clientX - startX) / renderScale;
        y += (ev.clientY - startY) / renderScale;
        startX = ev.clientX;
        startY = ev.clientY;

        setPropPos(el, x, y);
        el.classList.toggle('is-discard', !isOverBall(ev));
      }

      function up(ev) {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        el.classList.remove('is-dragging');

        if (isOverBall(ev)) {
          el.classList.remove('is-discard');
          el.style.transition = '';
        } else {
          /* 就地缩没：位置/旋转必须一起写进 transform，
             否则只剩 scale(0)，元素会跳回原点 */
          el.style.transition = 'transform .24s ease, opacity .24s ease';
          el.style.opacity = '0';
          applyProp(el, 0);
          removePropData(el);
          if (selectedProp === el) selectProp(null);
          setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
          }, 260);
        }
      }

      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  /* =========================================================
     选中 / 旋转手柄 / 滚轮缩放
     ========================================================= */
  var selectedProp = null;
  var propHandle = null;

  /* 手柄不是配件的子元素，而是脸的独立子元素，位置由
     「配件中心 + 沿旋转方向外移半个配件高」算出来。
     好处：手柄大小恒定（放大配件时不会大到抓不住），
     而且永远是个正着的方块，不会被旋转带歪。 */
  function updateHandle() {
    if (!propHandle || !selectedProp || !selectedProp.parentNode) return;

    var reach = selectedProp._h / 2 * selectedProp._scale + 18;
    var rad = selectedProp._rot * Math.PI / 180;
    var hx = selectedProp._x + Math.sin(rad) * reach;
    var hy = selectedProp._y - Math.cos(rad) * reach;

    propHandle.style.transform =
      'translate(' + px(hx) + 'px, ' + px(hy) + 'px) translate(-50%, -50%)';
  }

  function selectProp(el) {
    if (selectedProp === el) {
      updateHandle();
      return;
    }

    if (selectedProp) selectedProp.classList.remove('is-selected');
    selectedProp = el;

    if (!propHandle) return;

    if (el) {
      el.classList.add('is-selected');
      propHandle.classList.add('is-on');
      updateHandle();
    } else {
      propHandle.classList.remove('is-on');
    }
  }

  /* 滚轮缩放按「一格配件像素 = 整数屏幕像素」分档：
     step = 一格占多少缩放量，档位都是 step 的整数倍，
     所以每一档下方格的屏幕边长都是整数，缩放时像素不会糊。
     人脸多大就自动换一套档位（人脸尺寸也是 48 的整数倍）。 */
  function propScaleLevels() {
    var w = ballEl.getBoundingClientRect().width || BALL_SIZE;
    var step = SNAP_UNIT / w;
    return {
      step: step,
      min: Math.ceil(PROP_MIN_SCALE / step),
      max: Math.floor(PROP_MAX_SCALE / step)
    };
  }

  function bumpPropScale(el, dir) {
    var lv = propScaleLevels();
    var n = clamp(Math.round(el._scale / lv.step) + dir, lv.min, lv.max);

    el.style.transition = 'none';       // 滚轮要即时跟手，不要果冻拖尾
    setPropScale(el, n * lv.step);
    requestAnimationFrame(function () {
      if (!el.classList.contains('is-dragging')) el.style.transition = '';
    });
  }

  function initPropTools() {
    propHandle = document.createElement('div');
    propHandle.className = 'prop-handle';
    ballEl.appendChild(propHandle);

    /* 拖手柄 = 绕配件中心旋转。
       角度 = 「配件中心 → 鼠标」这个方向相对正上方的夹角，
       正好和 CSS rotate() 同向（正数顺时针）。
       按住 Shift 吸附到 15° 的整数倍。 */
    propHandle.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || !selectedProp) return;
      e.preventDefault();
      e.stopPropagation();

      var el = selectedProp;
      el.style.transition = 'none';

      function move(ev) {
        var r = ballEl.getBoundingClientRect();
        var mx = (ev.clientX - r.left) / renderScale;
        var my = (ev.clientY - r.top) / renderScale;
        var deg = Math.atan2(mx - el._x, -(my - el._y)) * 180 / Math.PI;

        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        setPropRot(el, deg);
      }

      function up() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        el.style.transition = '';
      }

      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    // 点空白处取消选中（点配件或手柄不算，它们各自处理）
    document.addEventListener('mousedown', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('.prop, .prop-handle')) return;
      selectProp(null);
    });
  }

  function initTray() {
    var chips = document.querySelectorAll('.chip');

    Array.prototype.forEach.call(chips, function (chip) {
      var prop = chip.dataset.prop;
      var art = PROP_ART[prop];
      if (!art) return;

      // 缩略图用同一张掩码画，和拖到脸上的东西长得一模一样
      var swatch = chip.querySelector('.chip__swatch');
      if (swatch) swatch.appendChild(buildPixels(art, SWATCH_CELL));

      chip.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();

        selectProp(null);          // 从托盘里拿新的，先把旧的取消选中

        var ghost = createGhost(art, e);

        function move(ev) {
          moveGhost(ghost, ev.clientX, ev.clientY);
          ballEl.classList.toggle('is-target', isOverBall(ev));
        }

        function up(ev) {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          ballEl.classList.remove('is-target');

          ghost.classList.add('is-gone');
          setTimeout(function () {
            if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
          }, 200);

          if (isOverBall(ev)) {
            var rect = ballEl.getBoundingClientRect();
            // 鼠标位置相对球左上角是屏幕像素，除以缩放才是球内逻辑坐标
            placeProp(
              prop,
              (ev.clientX - rect.left) / renderScale,
              (ev.clientY - rect.top) / renderScale
            );
          }
        }

        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    });
  }

  /* =========================================================
     5. 拼豆涂色层
     ---------------------------------------------------------
     24×24 栅格，一格 = 1 个拼豆。只铺圆环内部的格子，
     环外涂上去会变成悬在脸外的像素，所以那些下标干脆不生成 DOM，
     setPaint() 遇到没有节点的格子直接拒绝，环外永远涂不出去。

     paintData 就是最终存进 localStorage 的那份数据：
     576 个字符，行优先展开，每格存一个颜色的 mark
     （'.' = 空格子），跟坐标、缩放全都没关系。
     ========================================================= */
  var paintData = (function () {
    var arr = [];
    for (var i = 0; i < PAINT_TOTAL; i++) arr.push(EMPTY);
    return arr;
  })();

  var paintCells = {};           // 平铺下标 → 格子节点（环外的下标没有节点）

  function paintIndex(row, col) {
    return row * PAINT_N + col;
  }

  /* 铺格子：只铺圆环内部，行列号直接写进 grid-area */
  function buildPaint() {
    var frag = document.createDocumentFragment();

    for (var row = 0; row < PAINT_N; row++) {
      for (var col = 0; col < PAINT_N; col++) {
        var dx = (col + 0.5) * PAINT_CELL - CENTER;
        var dy = (row + 0.5) * PAINT_CELL - CENTER;
        if (Math.sqrt(dx * dx + dy * dy) > PAINT_R) continue;

        var cell = document.createElement('i');
        cell.className = 'paint-px';
        cell.style.gridArea = (row + 1) + ' / ' + (col + 1);
        paintCells[paintIndex(row, col)] = cell;
        frag.appendChild(cell);
      }
    }

    paintEl.appendChild(frag);
  }

  /* 单格上色 / 擦除（mark 传 EMPTY 就是擦掉），返回有没有真的变化 */
  function setPaint(row, col, mark) {
    var idx = paintIndex(row, col);
    var cell = paintCells[idx];
    if (!cell || paintData[idx] === mark) return false;

    paintData[idx] = mark;
    cell.style.background = colorHex(mark);
    return true;
  }

  /* 两点之间补齐格子：鼠标甩快了会跳格，不补就会涂出一条虚线 */
  function paintLine(r0, c0, r1, c1, mark) {
    var dr = r1 - r0;
    var dc = c1 - c0;
    var steps = Math.max(Math.abs(dr), Math.abs(dc));

    if (steps === 0) {
      setPaint(r1, c1, mark);
      return;
    }

    for (var i = 1; i <= steps; i++) {
      setPaint(
        Math.round(r0 + dr * i / steps),
        Math.round(c0 + dc * i / steps),
        mark
      );
    }
  }

  /* 把 paintData 全量刷回 DOM（读档、清空时用） */
  function renderPaint() {
    for (var i = 0; i < PAINT_TOTAL; i++) {
      var cell = paintCells[i];
      if (cell) cell.style.background = colorHex(paintData[i]);
    }
  }

  function clearPaint() {
    for (var i = 0; i < PAINT_TOTAL; i++) paintData[i] = EMPTY;
    renderPaint();
  }

  /* 把一串颜料字符刷回拼豆（读档、载入记录共用）。
     长度对不上就当作没涂过，不猜格式。
     老存档是 576 个 '0'/'1'（黑/空），识别出来转换成现在的颜色字符，
     免得之前画的脸一升级就没了 */
  function applyPaintString(s) {
    var i;

    if (typeof s !== 'string' || s.length !== PAINT_TOTAL) {
      for (i = 0; i < PAINT_TOTAL; i++) paintData[i] = EMPTY;
      renderPaint();
      return;
    }

    var legacy = /^[01]+$/.test(s);

    for (i = 0; i < PAINT_TOTAL; i++) {
      paintData[i] = legacy
        ? (s.charAt(i) === '1' ? 'k' : EMPTY)
        : s.charAt(i);
    }
    renderPaint();
  }

  function loadPaint() {
    applyPaintString(savedFace && savedFace.paint);
  }

  /* 屏幕坐标 → 球内逻辑坐标（240 基准） */
  function ballPointAt(ev) {
    var r = ballEl.getBoundingClientRect();
    if (r.width <= 0) return null;

    return {
      x: (ev.clientX - r.left) / renderScale,
      y: (ev.clientY - r.top) / renderScale
    };
  }

  /* 屏幕坐标 → 栅格行列。用球的包围盒换算，天然跟 renderScale 无关，
     而且鼠标跑到脸外时返回 null，涂抹会自动停手 */
  function paintCellAt(ev) {
    var r = ballEl.getBoundingClientRect();
    if (r.width <= 0) return null;

    var col = Math.floor((ev.clientX - r.left) / r.width * PAINT_N);
    var row = Math.floor((ev.clientY - r.top) / r.height * PAINT_N);
    if (row < 0 || row >= PAINT_N || col < 0 || col >= PAINT_N) return null;

    return { row: row, col: col };
  }

  /* =========================================================
     5.5 油漆桶：判断点到了谁
     ---------------------------------------------------------
     这一整套都用「逻辑坐标 + 纯数学」判定，不依赖 DOM 命中测试 ——
     上色模式下配件和五官都是 pointer-events: none，
     点击本来就只会落到涂色层上，由这里算坐标决定改谁。

     优先级：配件 > 五官 > 已涂色的拼豆 > 圆环 > 底色
     （压在上面的先被点到，和视觉层级一致）
     ========================================================= */

  /* 配件命中：把点逆着旋转转回配件自己的坐标系，再比矩形。
     旋转过的配件也能点得准，不用 AABB 近似 */
  function propAt(mx, my) {
    var list = ballEl.querySelectorAll('.prop');

    for (var i = list.length - 1; i >= 0; i--) {   // 后放的在上层，从上层往下找
      var el = list[i];
      var dx = mx - el._x;
      var dy = my - el._y;
      var a = -el._rot * Math.PI / 180;
      var lx = dx * Math.cos(a) - dy * Math.sin(a);
      var ly = dx * Math.sin(a) + dy * Math.cos(a);

      if (Math.abs(lx) <= el._w * el._scale / 2 &&
          Math.abs(ly) <= el._h * el._scale / 2) {
        return el;
      }
    }
    return null;
  }

  /* 五官命中：眼睛是 40×40 的方块，嘴巴是 6 个 20×20 的块（按弧度错开） */
  function partAt(mx, my) {
    var keys = ['eye-l', 'eye-r', 'mouth'];

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var cur = partState[key];
      if (!cur) continue;

      if (key !== 'mouth') {
        if (Math.abs(mx - cur.x) <= CELL && Math.abs(my - cur.y) <= CELL) {
          return key;
        }
        continue;
      }

      for (var j = 0; j < MOUTH_SHAPE.length; j++) {
        var bx = cur.x + (j - 2.5) * CELL;
        var by = cur.y - cur.curve * MOUTH_SHAPE[j] * CELL;
        if (Math.abs(mx - bx) <= CELL / 2 && Math.abs(my - by) <= CELL / 2) {
          return key;
        }
      }
    }
    return null;
  }

  /* 圆环命中：查 12×12 掩码 */
  function ringAt(mx, my) {
    var unit = BALL_SIZE / RING_MASK.length;
    var col = Math.floor(mx / unit);
    var row = Math.floor(my / unit);
    if (row < 0 || row >= RING_MASK.length) return false;
    if (col < 0 || col >= RING_MASK.length) return false;

    return RING_MASK[row].charAt(col) === '#';
  }

  /* 连通填充：把和起点相连、同色的那一片拼豆整块换成 mark。
     用显式栈而不是递归 —— 整张脸填满时递归会爆栈 */
  function fillPaint(row, col, mark) {
    var start = paintIndex(row, col);
    var from = paintData[start];
    if (!paintCells[start] || from === EMPTY || from === mark) return 0;

    var stack = [start];
    var count = 0;

    while (stack.length) {
      var idx = stack.pop();
      if (paintData[idx] !== from) continue;

      paintData[idx] = mark;
      paintCells[idx].style.background = colorHex(mark);
      count++;

      var r = Math.floor(idx / PAINT_N);
      var c = idx % PAINT_N;
      if (r > 0) stack.push(idx - PAINT_N);
      if (r < PAINT_N - 1) stack.push(idx + PAINT_N);
      if (c > 0) stack.push(idx - 1);
      if (c < PAINT_N - 1) stack.push(idx + 1);
    }
    return count;
  }

  /* 上色模式的一次点击：按优先级找目标下手 */
  function recolorAt(ev) {
    var p = ballPointAt(ev);
    if (!p) return null;

    var hex = selectedHex();

    var prop = propAt(p.x, p.y);
    if (prop) {
      applyPropColor(prop, hex);          // 整个配件批量换色
      return prop;
    }

    var key = partAt(p.x, p.y);
    if (key) {
      setPartColor(key, hex);
      return key;
    }

    var cell = paintCellAt(ev);
    if (cell && paintData[paintIndex(cell.row, cell.col)] !== EMPTY) {
      fillPaint(cell.row, cell.col, selectedMark);   // 相连的同色拼豆一起换
      return cell;
    }

    if (ringAt(p.x, p.y)) {
      setSkin('ring', hex);
      return 'ring';
    }

    setSkin('base', hex);                 // 剩下的都算点了脸部底色
    return 'base';
  }

  /* ---------------- 鼠标涂抹 ---------------- */
  function initPaint() {
    var drawing = false;
    var value = EMPTY;             // 这一笔画什么颜色（EMPTY = 擦）
    var lastRow = -1;
    var lastCol = -1;

    brushEl = document.createElement('div');
    brushEl.className = 'paint-cursor';
    ballEl.appendChild(brushEl);

    function showBrush(row, col) {
      // 环外的格子不存在节点，笔刷也就不显示，等于告诉用户这里涂不到
      if (!paintCells[paintIndex(row, col)]) {
        hideBrush();
        return;
      }
      brushEl.style.transform =
        'translate(' + px(col * PAINT_CELL) + 'px, ' +
        px(row * PAINT_CELL) + 'px)';
      brushEl.classList.add('is-on');
    }

    function hideBrush() {
      brushEl.classList.remove('is-on');
    }

    function stop() {
      drawing = false;
      lastRow = -1;
      lastCol = -1;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    function onMove(ev) {
      var c = paintCellAt(ev);

      if (!c) {
        hideBrush();
        lastRow = -1;              // 断点，回脸里也不要跨过脸外连线
        return;
      }

      showBrush(c.row, c.col);
      if (!drawing) return;

      if (lastRow < 0) setPaint(c.row, c.col, value);
      else paintLine(lastRow, lastCol, c.row, c.col, value);

      lastRow = c.row;
      lastCol = c.col;
    }

    function onUp() {
      stop();
    }

    paintEl.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();

      // 上色模式：同样由这一层收点击，但只做「给整块换色」，不画格子
      if (ballEl.classList.contains('is-recolor')) {
        recolorAt(e);
        return;
      }

      var c = paintCellAt(e);
      if (!c) return;

      // 第一下决定这一笔的性质：按在「当前颜色」的格子上就一路擦，
      // 按在别的颜色或空格上就一路画成当前颜色
      value = paintData[paintIndex(c.row, c.col)] === selectedMark
        ? EMPTY
        : selectedMark;
      drawing = true;
      lastRow = c.row;
      lastCol = c.col;

      setPaint(c.row, c.col, value);
      showBrush(c.row, c.col);

      // 监听挂到 document，鼠标甩出脸外也不会半路丢笔
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // 没按住时只挪笔刷方块，不做任何修改
    paintEl.addEventListener('mousemove', function (ev) {
      if (drawing) return;         // 涂抹中交给 document 上的 onMove

      var c = paintCellAt(ev);
      if (!c) {
        hideBrush();
        return;
      }
      showBrush(c.row, c.col);
    });

    paintEl.addEventListener('mouseleave', hideBrush);

    clearBtn.addEventListener('click', function () {
      clearPaint();
      clearBtn.classList.remove('is-flash');
      void clearBtn.offsetWidth;
      clearBtn.classList.add('is-flash');
      setTimeout(function () {
        clearBtn.classList.remove('is-flash');
      }, POP_MS);
    });
  }

  /* ---------------- 模式切换 ----------------
     三种模式：涂色（画拼豆）、上色（油漆桶换色）、移动缩放。
     涂色和上色都由涂色层收脸上的点击，差别只在 JS 里怎么处理；
     模式之间靠 CSS 的 pointer-events 让路，不会互相抢事件。
     -------------------------------------------- */
  var TIPS = {
    paint: '选好颜色再点 / 拖：点空格涂色，点同色格子擦掉',
    recolor: '选好颜色后点一下：底色 / 圆环 / 五官 / 配件 / 已涂的拼豆，整块换色',
    move: '拖配件移位置 · 点选配件后滚轮缩放 · 拖顶部方块旋转（初始表情已收起，动过的五官才显示）'
  };

  function setMode(mode) {
    var isPaint = mode === 'paint';
    var isRecolor = mode === 'recolor';
    var isMove = !isPaint && !isRecolor;

    ballEl.classList.toggle('is-paint', isPaint);
    ballEl.classList.toggle('is-recolor', isRecolor);
    ballEl.classList.toggle('is-move', isMove);
    paintTool.classList.toggle('is-on', isPaint);
    bucketTool.classList.toggle('is-on', isRecolor);
    moveTool.classList.toggle('is-on', isMove);

    tipEl.textContent = TIPS[mode] || TIPS.move;

    if (brushEl) brushEl.classList.remove('is-on');
    // 这两种模式下配件本来就不吃鼠标，选中框留着只会碍眼
    if (isPaint || isRecolor) selectProp(null);

    /* ---------------- 状态清理 ----------------
       每次切模式都重新判定「哪些五官还是出厂的」，结果写回 is-default 类。

       点「上色」时再用 JS 强行抹一遍：凡是仍处于出厂状态的眼 / 嘴，
       直接写 opacity: 0 —— 就算样式表没生效、或者别的路径漏刷过状态，
       画布上也只剩轮廓和底色，绝不会冒出一对默认眼睛和一条默认嘴巴。
       切到别的模式时把内联样式清掉，交回 CSS 管。

       只改显示状态，绝不动 partState：用户拖过 / 上过色的五官
       照常显示（不带 is-default），颜色、位置、弧度一个都不会丢；
       点它们原来的位置照样能上色（命中靠坐标算），颜色一换就重新显示。 */
    syncPartFlags();

    Object.keys(PARTS).forEach(function (key) {
      var el = ballEl.querySelector('[data-part="' + key + '"]');
      if (!el) return;

      if (isRecolor && isDefaultExpr(key, partState[key])) {
        el.classList.add('is-default');
        el.style.opacity = '0';       // 强行清空：上色模式下默认五官绝不出现
      } else {
        el.style.opacity = '';        // 交回 CSS（移动模式下 hover 还能透出来）
      }
    });
  }

  function initTools() {
    var tools = document.querySelectorAll('.tool[data-mode]');

    Array.prototype.forEach.call(tools, function (btn) {
      btn.addEventListener('click', function () {
        setMode(btn.dataset.mode);
      });
    });
  }

  /* =========================================================
     5.6 油漆桶调色盘
     ---------------------------------------------------------
     选中的颜色：涂色模式下就是笔刷颜色，上色模式下就是换成的颜色。
     按钮点开色板，选完自动收起；点别处或按 Esc 也能收起。
     ========================================================= */
  var selectedMark = 'k';        // 默认黑，跟以前的涂色行为一致

  function selectedHex() {
    return colorHex(selectedMark) || PART_INK;
  }

  function selectColor(mark) {
    selectedMark = mark;
    palettePip.style.background = selectedHex();

    var swatches = palettePanel.querySelectorAll('.swatch');
    Array.prototype.forEach.call(swatches, function (sw) {
      sw.classList.toggle('is-on', sw.dataset.mark === mark);
    });
  }

  function togglePalette(force) {
    var open = (force === undefined)
      ? !palette.classList.contains('is-open')
      : force;

    palette.classList.toggle('is-open', open);
    paletteBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function initPalette() {
    PALETTE.forEach(function (c) {
      var sw = document.createElement('button');

      sw.type = 'button';
      sw.className = 'swatch';
      sw.dataset.mark = c.mark;
      sw.title = c.name;
      sw.style.background = c.hex;
      sw.setAttribute('role', 'option');

      sw.addEventListener('click', function () {
        selectColor(c.mark);
        togglePalette(false);        // 选完就收起来，别挡着脸
      });

      palettePanel.appendChild(sw);
    });

    // 点按钮开关色板；stopPropagation 免得下面的"点外面收起"立刻又关掉
    paletteBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePalette();
    });

    document.addEventListener('mousedown', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('.palette')) return;
      togglePalette(false);
    });

    // Esc / 退格键 = 「后退」：收起色板，顺便取消配件选中
    document.addEventListener('keydown', function (e) {
      var isEsc = e.key === 'Escape' || e.key === 'Esc';
      var isBack = e.key === 'Backspace';
      if (!isEsc && !isBack) return;

      if (isBack) e.preventDefault();   // 拦住退格可能触发的页面回退
      togglePalette(false);
      selectProp(null);
    });

    selectColor(selectedMark);
  }

  /* =========================================================
     6. 保存
    ---------------------------------------------------------
     一次点击做四件事：
     ① 落库到 epb:face（表情数据，P4 的矢量兜底用它）
     ② 追加一条表情记录（左下角「表情记录」里能翻回来改）
     ③ 导出透明背景 PNG 下载到本地
     ④ 把同一张 PNG 的 Base64 存进 savedEmotion —— P4 海报的中心图案
     ========================================================= */
  function initSave() {
    var timer = null;

    saveBtn.addEventListener('click', function () {
      saveBtn.classList.remove('is-saved');
      void saveBtn.offsetWidth;
      saveBtn.classList.add('is-saved');

      saveFace();                        // ① 落库

      var face = makeFaceData();
      addRecord(face);                   // ② 记录（内部会重画列表）

      var stored = exportFacePNG(face);  // ③ 导出下载 ④ 顺带存 savedEmotion

      var old = saveBtn.textContent;
      saveBtn.textContent = '已保存';

      showToast(stored
        ? '表情已保存 · PNG 已下载'
        : 'PNG 已下载（浏览器没存下海报图案）');

      clearTimeout(timer);
      timer = setTimeout(function () {
        saveBtn.classList.remove('is-saved');
        saveBtn.textContent = old || '保存';
      }, 1800);
    });
  }

  /* =========================================================
     6.1 下一步：直接进 P3 选今天的心情
     ---------------------------------------------------------
     这里只是「换一页」，不落库、不导图 —— 想留档或存海报图案还是走
     「保存」。表情数据本身挂在全局的 localStorage 上，
     跳过去之后 P3 / P4 读同一份，所以不需要在这里额外传参。
     ========================================================= */
  function initNext() {
    if (!nextBtn) return;

    nextBtn.addEventListener('click', function () {
      window.location.href = 'p3.html';
    });
  }

  /* 脸部配色读档（老存档没这个字段，保持出厂值） */
  function loadSkin() {
    if (!savedFace || !savedFace.skin) return;

    if (savedFace.skin.base) faceSkin.base = savedFace.skin.base;
    if (savedFace.skin.ring) faceSkin.ring = savedFace.skin.ring;
  }

  /* 把上次保存过的配件重新摆回脸上
     （位置、缩放、旋转、颜色全都要还原） */
  function restoreProps() {
    if (!savedFace || !savedFace.props) return;
    savedFace.props.forEach(function (p) {
      placeProp(p.prop, p.x, p.y, p.rot, p.scale, p.color);
    });
  }

  /* =========================================================
     7. 恢复起始
     把这张脸退回「刚打开页面」的空白样：涂色、五官位置、已经放上去的
     配件全部清掉。

     注意这里只改当前编辑状态，不动 localStorage —— 和别处的规矩一致，
     落库只由「保存」按钮决定。所以恢复起始之后再按一下保存，
     海报页读到的才会是这张空白脸。
     ========================================================= */
  function resetAll() {
    // 1) 拼豆涂色清零
    clearPaint();

    // 2) 五官回到 PARTS 里的初始位置与弧度。
    //    必须就地改 partState 里那个对象 —— initParts 里的拖拽闭包
    //    一直引用它，换成新对象的话，下次拖拽会从旧坐标开始算
    Object.keys(PARTS).forEach(function (key) {
      var cfg = PARTS[key];
      var cur = partState[key];
      var el = ballEl.querySelector('[data-part="' + key + '"]');
      if (!cur || !el) return;

      cur.x = cfg.x;
      cur.y = cfg.y;
      cur.curve = 0;

      setPartPos(el, cur.x, cur.y);
      if (key === 'mouth') renderMouth(el, cur.curve);
      setPartColor(key, PART_INK);    // 五官颜色也回到出厂黑
      playPop(el);                    // 弹一下，让"归位"看得见
    });

    // 3) 配色回到出厂：底色白、圆环黑
    setSkin('base', FACE_PAPER);
    setSkin('ring', PART_INK);

    // 4) 配件：先解除选中（手柄才收得回去），再就地缩没、摘掉数据
    selectProp(null);

    Array.prototype.forEach.call(ballEl.querySelectorAll('.prop'), function (el) {
      el.style.transition = 'transform .24s ease, opacity .24s ease';
      el.style.opacity = '0';
      applyProp(el, 0);
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 260);
    });

    propState.length = 0;
  }

  function initReset() {
    if (!resetBtn) return;

    resetBtn.addEventListener('click', function () {
      resetAll();

      resetBtn.classList.remove('is-flash');
      void resetBtn.offsetWidth;
      resetBtn.classList.add('is-flash');
      setTimeout(function () {
        resetBtn.classList.remove('is-flash');
      }, POP_MS);

      showToast('已恢复起始状态');
    });
  }

  /* =========================================================
     8. 尺寸变化时重画
     人脸边长由 CSS 的 --size 决定（随窗口变化），renderScale 跟着变。
     这时所有内部坐标都得按新比例重画一遍。
     涂色层不用管：格子是 CSS Grid 的 1fr，跟着脸一起缩放。
     ========================================================= */
  function renderAll() {
    Object.keys(PARTS).forEach(function (key) {
      var cur = partState[key];
      var el = ballEl.querySelector('[data-part="' + key + '"]');
      if (!el || !cur) return;
      setPartPos(el, cur.x, cur.y);
      if (key === 'mouth') renderMouth(el, cur.curve);
    });

    // 配件：盒子尺寸按新的 --u 重算（内部格子是 1fr，自己跟着变），
    // 再把位置/缩放/旋转重新合成一次，顺带把旋转手柄归位
    Array.prototype.forEach.call(ballEl.querySelectorAll('.prop'), function (el) {
      sizeProp(el);
      setPropPos(el, el._x, el._y);
    });
  }

  /* 收集所有会被重画的元素（嘴巴还要算上 6 个像素块），
     临时掐掉过渡 —— 否则整张脸会带着弹性「滑」到新位置 */
  function animatedEls() {
    var list = [];

    Object.keys(PARTS).forEach(function (key) {
      var el = ballEl.querySelector('[data-part="' + key + '"]');
      if (!el || !partState[key]) return;
      list.push(el);
      if (key === 'mouth') {
        Array.prototype.push.apply(
          list,
          el.querySelectorAll('.mouth__px > span')
        );
      }
    });

    Array.prototype.forEach.call(ballEl.querySelectorAll('.prop'), function (el) {
      list.push(el);
    });

    return list;
  }

  function relayout() {
    syncScale();

    var list = animatedEls();
    list.forEach(function (el) { el.style.transition = 'none'; });

    renderAll();

    // 读一次 offsetWidth 强制重排，让新位置在无过渡的状态下落定，再恢复过渡
    list.forEach(function (el) {
      void el.offsetWidth;
      el.style.transition = '';
    });

    // 笔刷方块的位置是按旧比例算的，先收起来，等鼠标再动时重新贴上去
    if (brushEl) brushEl.classList.remove('is-on');
  }

  /* =========================================================
     9. 载入一份存档
    ---------------------------------------------------------
     把 makeFaceData() 存下来的快照原样铺回画布：五官位置与颜色、
     脸部配色、拼豆、配件（位置 / 缩放 / 旋转 / 颜色）。
     「表情记录」里点开某一张，走的就是这里。
     ========================================================= */
  /* 清掉脸上所有配件：记录是从零重铺，不能和现在这些叠在一起 */
  function removeAllProps() {
    selectProp(null);        // 手柄先收回去，否则它会指着一个已删掉的配件

    Array.prototype.forEach.call(ballEl.querySelectorAll('.prop'), function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    propState.length = 0;
  }

  /* 成功返回 true，数据不对就当没点过 */
  function applyFaceData(face) {
    if (!face || face.v !== 1) return false;

    selectProp(null);

    // 1) 五官：记录里有的按记录摆，没提到的回出厂位置
    Object.keys(PARTS).forEach(function (key) {
      var cfg = PARTS[key];
      var cur = partState[key];
      var el = ballEl.querySelector('[data-part="' + key + '"]');
      var src = (face.parts && face.parts[key]) || null;
      if (!cur || !el) return;

      cur.x = src ? src.x : cfg.x;
      cur.y = src ? src.y : cfg.y;
      cur.curve = src ? (src.curve || 0) : 0;

      setPartColor(key, (src && src.color) || PART_INK);   // 顺带把 cur.color 写好
      setPartPos(el, cur.x, cur.y);
      if (key === 'mouth') renderMouth(el, cur.curve);
      playPop(el);
    });

    // 2) 脸部配色：底色 / 圆环
    var skin = face.skin || {};
    setSkin('base', skin.base || FACE_PAPER);
    setSkin('ring', skin.ring || PART_INK);

    // 3) 拼豆涂色
    applyPaintString(face.paint);

    // 4) 配件：先清空再按记录逐个摆回（含缩放与旋转）
    removeAllProps();
    (face.props || []).forEach(function (p) {
      placeProp(p.prop, p.x, p.y, p.rot, p.scale, p.color);
    });

    return true;
  }

  /* =========================================================
     10. 导出透明 PNG
     ---------------------------------------------------------
     这一支「画笔」是原生 Canvas，直接在离屏画布上重画，不引任何第三方库，
     所以导出这一步压根不碰页面上的 DOM：
       · 不需要 #export-area 之类的截图容器 —— 想导出什么，就在下面画什么；
       · 也不需要临时把白色人脸、网格线 visibility: hidden 再恢复 ——
         它们根本没进画布，不存在被截进去的可能，也就不会有闪烁。
     （页面上的网格线本来就是 CSS 的 inset box-shadow，只在涂色模式显示，
       属于「编辑辅助」，从来不算表情内容。）

      画的内容，顺序 = 页面上的层级顺序，配件永远在最上层：
       ① 黑色圆环外轮廓（人脸的边界，必须有）
       ② 用户涂的拼豆像素（他自己画出来的五官）
       ③ 用户动过的五官（拖过 / 上过色 / 拉过弧度的眼睛嘴巴）
       ④ 拖上去的配件
     不画的：白色底盘（会压住透明背景、还自带方块网格感），
     以及没动过的初始表情（出厂方眼睛 + 一字嘴，不算用户的作品）。
     两个开关见下面的 EXPORT_BASE / EXPORT_RING。

     具体实现：
     ① 按「人脸 240 基准」的逻辑坐标算包围盒（配件放大、旋转后可能探到
        脸外，也要一起框进来，不能裁掉）；
     ② 逐个像素填矩形，两条边用同一个取整公式，相邻格子严丝合缝不露缝；
     ③ 配件先轴对齐画成一张小图，再整体旋转贴上去 ——
        直接填旋转后的矩形会被抗锯齿糊掉边，这样旋转也还是硬边像素。
     画布从头到尾不铺底色，所以导出就是全透明背景。
     ========================================================= */
  var EXPORT_SCALE = 4;     // 1 个逻辑单位 = 4 个设备像素，几何全落在整数上
  var EXPORT_PAD = 12;      // 逻辑单位：内容四周留一圈透明呼吸位，免得贴边

  /* 脸部本体拆成两半，导出时分别开关：
     · EXPORT_BASE —— 脸部底色层（人脸那层皮肤）。出厂白 = 透明底，不画；
       用户用油漆桶给脸上过色之后（底色不再是白），这层会自动跟着导出 ——
       否则保存下来的 PNG 会丢掉用户涂的所有底色。
       它是 12×12 个小方块拼的，同色的相邻块严丝合缝，不会出现网格线；
       颜色相同的块填满整个环内，看上去就是一块圆的底色。
     · EXPORT_RING —— 黑色圆环外轮廓。它是人脸的边界，必须画：
       少了它，导出图就只剩几个五官孤零零浮在透明底上。
     所以导出结果 = 透明背景（有底色时是底色层）+ 黑色外轮廓 +
     用户涂的像素（五官）+ 拖上去的配件，和网页里看到的是同一张脸。
     （记录缩略图和导出共用这一支画笔，所以缩略图看到的就是 PNG 的样子。） */
  var EXPORT_BASE = false;   // 强制画底盘；正常走「底色不是白」的自动判断
  var EXPORT_RING = true;

  /* 这个颜色算不算「没上色的白」：
     出厂底色就是纯白，它代表「透明底」，不该在导出图里铺一层白板。
     用户用油漆桶换过的任何颜色都不算白，必须画出来。 */
  function isPaperColor(color) {
    if (!color) return true;

    var s = String(color).replace(/\s/g, '').toLowerCase();
    if (s === 'white' || s === '#fff' || s === '#ffffff') return true;

    var m = s.match(/^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/);
    if (!m) return false;

    var alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
    return +m[1] === 255 && +m[2] === 255 && +m[3] === 255 && alpha > .99;
  }

  /* 一个逻辑矩形 → 设备像素的填充 */
  function fillBlock(ctx, k, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(
      Math.round(x * k), Math.round(y * k),
      Math.round((x + w) * k) - Math.round(x * k),
      Math.round((y + h) * k) - Math.round(y * k)
    );
  }

  /* 内容包围盒：只框「真正会被画出来的像素」，不是整个画布容器。
     白色底盘和外轮廓不画的时候，也不给它们留位置，
     所以导出的是紧贴表情内容的一张小图，四周只有一圈透明呼吸位。
     四类内容一律按逻辑坐标累加：
       ① 圆环外轮廓（占满 0~240 那个方框）
       ② 眼睛 / 嘴巴      ③ 涂过的拼豆      ④ 配件（含旋转、缩放后的外接矩形） */
  function faceBounds(data) {
    var box = null;

    function grow(x0, y0, x1, y1) {
      if (!box) {
        box = { x0: x0, y0: y0, x1: x1, y1: y1 };
        return;
      }
      box.x0 = Math.min(box.x0, x0);
      box.y0 = Math.min(box.y0, y0);
      box.x1 = Math.max(box.x1, x1);
      box.y1 = Math.max(box.y1, y1);
    }

    var parts = data.parts || {};
    var i, r, c;

    // 1) 圆环外轮廓：12×12 掩码的最外圈正好贴到脸的四边，占满 0~240 整个方框
    if (EXPORT_RING) grow(0, 0, BALL_SIZE, BALL_SIZE);

    // 2) 眼睛：以中心为基准的 2×2 格（初始表情不算内容，不占位置）
    ['eye-l', 'eye-r'].forEach(function (key) {
      var cur = parts[key];
      if (!cur || isDefaultExpr(key, cur)) return;
      grow(cur.x - CELL, cur.y - CELL, cur.x + CELL, cur.y + CELL);
    });

    // 3) 嘴巴：6 个 1 格方块，中间 4 个按弧度错开
    var m = parts.mouth;
    if (m && !isDefaultExpr('mouth', m)) {
      for (i = 0; i < MOUTH_SHAPE.length; i++) {
        var my = m.y - CELL / 2 - (m.curve || 0) * MOUTH_SHAPE[i] * CELL;
        grow(m.x + (i - 3) * CELL, my, m.x + (i - 2) * CELL, my + CELL);
      }
    }

    // 4) 涂色的拼豆：判定条件与 drawFace 完全一致，框到的就是画出来的
    var paint = data.paint || '';
    var legacy = /^[01]+$/.test(paint);

    for (r = 0; r < PAINT_N; r++) {
      for (c = 0; c < PAINT_N; c++) {
        var ch = paint.charAt(paintIndex(r, c));
        var mark = legacy ? (ch === '1' ? 'k' : EMPTY) : ch;
        if (!mark || mark === EMPTY || !colorHex(mark)) continue;

        var dx = (c + 0.5) * PAINT_CELL - CENTER;
        var dy = (r + 0.5) * PAINT_CELL - CENTER;
        if (Math.sqrt(dx * dx + dy * dy) > PAINT_R) continue;

        grow(c * PAINT_CELL, r * PAINT_CELL,
             (c + 1) * PAINT_CELL, (r + 1) * PAINT_CELL);
      }
    }

    // 5) 配件：旋转 + 缩放后的外接矩形
    (data.props || []).forEach(function (p) {
      var art = PROP_ART[p.prop];
      if (!art) return;

      var s = p.scale || 1;
      var hw = art.mask[0].length * PROP_CELL * s / 2;
      var hh = art.mask.length * PROP_CELL * s / 2;
      var a = (p.rot || 0) * Math.PI / 180;
      var ca = Math.abs(Math.cos(a));
      var sa = Math.abs(Math.sin(a));
      var ex = ca * hw + sa * hh;      // 旋转后的外接矩形半宽 / 半高
      var ey = sa * hw + ca * hh;

      grow(p.x - ex, p.y - ey, p.x + ex, p.y + ey);
    });

    // 兜底：眼睛和嘴巴永远在，正常走不到这里
    if (!box) box = { x0: 0, y0: 0, x1: BALL_SIZE, y1: BALL_SIZE };

    return {
      x0: Math.floor(box.x0 - EXPORT_PAD),
      y0: Math.floor(box.y0 - EXPORT_PAD),
      x1: Math.ceil(box.x1 + EXPORT_PAD),
      y1: Math.ceil(box.y1 + EXPORT_PAD)
    };
  }

  /* 配件画成一张轴对齐的小位图：1 格 = 5 逻辑单位 × 缩放 × k */
  function propSprite(art, color, scale, k) {
    var mask = art.mask;
    var cols = mask[0].length;
    var rows = mask.length;
    var cell = PROP_CELL * scale * k;

    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(cols * cell));
    cv.height = Math.max(1, Math.round(rows * cell));

    var ctx = cv.getContext('2d');
    ctx.fillStyle = color;

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (mask[r].charAt(c) !== '#') continue;

        var bx = Math.round(c * cell);
        var by = Math.round(r * cell);
        ctx.fillRect(
          bx, by,
          Math.round((c + 1) * cell) - bx,
          Math.round((r + 1) * cell) - by
        );
      }
    }
    return cv;
  }

  /* 把一份存档画进 ctx。k = 1 个逻辑单位占多少设备像素 */
  function drawFace(ctx, data, k) {
    var unit = BALL_SIZE / RING_MASK.length;      // 圆环 1 格 = 20 逻辑单位
    var skin = data.skin || {};
    var paint = data.paint || '';
    var legacy = /^[01]+$/.test(paint);           // 远古存档：'1' 就是黑
    var r, c, i, qx, qy, mark;

    /* 1) 脸部底色层（油漆桶上的颜色）：
       出厂白 = 透明底，照旧不画；一旦用户给脸上过色，就必须画出来，
       不然导出图只剩轮廓和五官，颜色全丢。
       掩码与半径判定跟 buildCanvas 完全一致，导出的就是页面上那块皮肤；
       同色相邻块用同一个取整公式，严丝合缝，不会出现网格线。 */
    var baseColor = skin.base || FACE_PAPER;
    var showBase = EXPORT_BASE || !isPaperColor(baseColor);

    if (showBase) {
      for (r = 0; r < RING_MASK.length; r++) {
        for (c = 0; c < RING_MASK.length; c++) {
          if (RING_MASK[r].charAt(c) === '#') continue;   // 圆环那几格归下一步画

          qx = (c + 0.5) * unit - CENTER;
          qy = (r + 0.5) * unit - CENTER;
          if (Math.sqrt(qx * qx + qy * qy) > BASE_R) continue;

          fillBlock(ctx, k, c * unit, r * unit, unit, unit, baseColor);
        }
      }
    }

    // 2) 黑色圆环外轮廓：人脸的边界，导出必须带上（颜色跟随「上色」改过的值）
    if (EXPORT_RING) {
      var ringColor = skin.ring || PART_INK;

      for (r = 0; r < RING_MASK.length; r++) {
        for (c = 0; c < RING_MASK.length; c++) {
          if (RING_MASK[r].charAt(c) !== '#') continue;

          fillBlock(ctx, k, c * unit, r * unit, unit, unit, ringColor);
        }
      }
    }

    // 3) 拼豆涂色：只画环内（和 buildPaint 同一套半径判定）
    for (r = 0; r < PAINT_N; r++) {
      for (c = 0; c < PAINT_N; c++) {
        var ch = paint.charAt(paintIndex(r, c));
        mark = legacy ? (ch === '1' ? 'k' : EMPTY) : ch;
        if (!mark || mark === EMPTY) continue;

        // 认不出的 mark 当作空格：留在循环里会继承上一次的填充色
        var hex = colorHex(mark);
        if (!hex) continue;

        qx = (c + 0.5) * PAINT_CELL - CENTER;
        qy = (r + 0.5) * PAINT_CELL - CENTER;
        if (Math.sqrt(qx * qx + qy * qy) > PAINT_R) continue;

        fillBlock(ctx, k, c * PAINT_CELL, r * PAINT_CELL,
                  PAINT_CELL, PAINT_CELL, hex);
      }
    }

    // 4) 眼睛：以中心为基准的 2×2 格方块。
    //    没动过的初始表情直接跳过，绝不混进导出图
    ['eye-l', 'eye-r'].forEach(function (key) {
      var cur = (data.parts || {})[key];
      if (!cur || isDefaultExpr(key, cur)) return;

      fillBlock(ctx, k, cur.x - CELL, cur.y - CELL,
                CELL * 2, CELL * 2, cur.color || PART_INK);
    });

    // 5) 嘴巴：6 个 1 格方块，中间 4 个按弧度上下错开
    var m = (data.parts || {}).mouth;
    if (m && !isDefaultExpr('mouth', m)) {
      for (i = 0; i < MOUTH_SHAPE.length; i++) {
        fillBlock(ctx, k,
                  m.x + (i - 3) * CELL,
                  m.y - CELL / 2 - (m.curve || 0) * MOUTH_SHAPE[i] * CELL,
                  CELL, CELL, m.color || PART_INK);
      }
    }

    // 6) 配件：贴一张转好角的位图（最近邻采样，边缘保持硬像素）
    (data.props || []).forEach(function (p) {
      var art = PROP_ART[p.prop];
      if (!art) return;

      var sprite = propSprite(art, p.color || art.color, p.scale || 1, k);

      ctx.save();
      ctx.translate(p.x * k, p.y * k);
      ctx.rotate((p.rot || 0) * Math.PI / 180);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
      ctx.restore();
    });
  }

  /* 渲染成一张 canvas。k 不给就按导出的清晰度取，
     缩略图传小一点，一张记录的内存开销就下来了 */
  function buildFaceCanvas(data, k) {
    var box = faceBounds(data);
    var cv = document.createElement('canvas');

    cv.width = Math.max(1, Math.round((box.x1 - box.x0) * k));
    cv.height = Math.max(1, Math.round((box.y1 - box.y0) * k));

    var ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(-box.x0 * k), Math.round(-box.y0 * k));
    drawFace(ctx, data, k);

    return cv;
  }

  function two(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function fileName() {
    var d = new Date();
    return 'emotion-face-' + d.getFullYear() + two(d.getMonth() + 1) +
           two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) +
           two(d.getSeconds()) + '.png';
  }

  /* ---------------------------------------------------------
     持久化：把这张导出图转成 Base64 字符串存进 localStorage。
     P2 → P3 → P4 就靠它串起来：P4 生成海报时读同一个键，
     把这张透明 PNG 直接贴在海报中心，不需要在那边按数据重画。
     存不下（隐私模式 / 配额满）不算致命：PNG 照常下载，
     P4 会退回它自己那套用 epb:face 现画的矢量表情。
     --------------------------------------------------------- */
  function saveEmotion(cv) {
    try {
      localStorage.setItem(EMOTION_KEY, cv.toDataURL('image/png'));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* 返回值 = 「海报图案有没有存进浏览器」，提示条按它换文案 */
  function exportFacePNG(face) {
    var cv = buildFaceCanvas(face || makeFaceData(), EXPORT_SCALE);
    var name = fileName();
    var stored = saveEmotion(cv);

    function download(url, revoke) {
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (revoke) setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }

    // toBlob 不可用时退回 dataURL（导出的是纯画布，不含跨域图片，不会被污染）
    if (cv.toBlob) {
      cv.toBlob(function (blob) {
        if (!blob) {
          showToast('导出失败，请再试一次');
          return;
        }
        download(URL.createObjectURL(blob), true);
      }, 'image/png');
    } else {
      download(cv.toDataURL('image/png'), false);
    }

    return stored;
  }

  /* =========================================================
     11. 表情记录
     ---------------------------------------------------------
     每次点「保存」都会追加一条快照到 localStorage（最新的排最前）。
     点左下角「表情记录」弹出小窗口，缩略图用的就是导出那一支画笔，
     所见即所得；点一张就把它原样载回画布继续改。
     存储写不进去（隐私模式 / 配额满）也不影响本页使用 ——
     记录同时留在内存数组里。
     ========================================================= */
  var records = [];            // [{ id, time, face }]

  function loadRecords() {
    try {
      var raw = localStorage.getItem(RECORDS_KEY);
      var data = raw ? JSON.parse(raw) : null;

      records = (data && data.v === 1 && Object.prototype.toString.call(data.list) === '[object Array]')
        ? data.list
        : [];
    } catch (e) {
      records = [];
    }
  }

  function persistRecords() {
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify({ v: 1, list: records }));
    } catch (e) { /* 写不进去就算了，本页还能翻 */ }
  }

  function addRecord(face) {
    records.unshift({
      id: 'f' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      time: Date.now(),
      face: face
    });

    if (records.length > RECORDS_MAX) records.length = RECORDS_MAX;

    persistRecords();
    renderRecords();
  }

  function removeRecord(id) {
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === id) {
        records.splice(i, 1);
        break;
      }
    }
    persistRecords();
    renderRecords();
  }

  /* 'MM.DD HH:MM' */
  function timeText(t) {
    var d = new Date(t);
    return two(d.getMonth() + 1) + '.' + two(d.getDate()) + ' ' +
           two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function renderRecords() {
    recordsGrid.innerHTML = '';
    recordsEmpty.classList.toggle('is-on', records.length === 0);

    records.forEach(function (rec) {
      var item = document.createElement('div');
      item.className = 'record';

      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'record__open';
      open.title = '载入这条记录继续修改';

      // 缩略图：半分辨率（原尺寸在这里也不会被拉伸，像素不糊）
      var thumb = buildFaceCanvas(rec.face, 0.5);
      thumb.className = 'record__thumb';
      open.appendChild(thumb);

      var time = document.createElement('span');
      time.className = 'record__time';
      time.textContent = timeText(rec.time);
      open.appendChild(time);

      open.addEventListener('click', function () {
        if (applyFaceData(rec.face)) {
          toggleRecords(false);
          showToast('已载入这条记录，改完记得保存');
        }
      });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'record__del';
      del.textContent = '删除';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        removeRecord(rec.id);
        showToast('已删除一条记录');
      });

      item.appendChild(open);
      item.appendChild(del);
      recordsGrid.appendChild(item);
    });
  }

  function toggleRecords(force) {
    var open = (force === undefined)
      ? !recordsEl.classList.contains('is-open')
      : force;

    recordsEl.classList.toggle('is-open', open);
    recordsEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) renderRecords();
  }

  function initRecords() {
    loadRecords();

    // 老用户第一次打开：把上次保存过的那张脸补成第一条记录，别让窗口空着
    // （此时 loadPaint / loadSkin / restoreProps 都已跑过，makeFaceData 拿到的正是那张脸）
    if (!records.length && savedFace) {
      addRecord(makeFaceData());     // 内部会 persist + render
    } else {
      renderRecords();
    }

    recordsBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePalette(false);          // 色板跟弹窗不同时开着，免得叠成一团
      toggleRecords();
    });

    recordsClose.addEventListener('click', function () {
      toggleRecords(false);
    });

    // 点弹窗外的暗底关掉；点面板本身不算
    recordsEl.addEventListener('mousedown', function (e) {
      if (e.target === recordsEl) toggleRecords(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') toggleRecords(false);
    });
  }

  /* ---------------- 启动 ---------------- */
  savedFace = loadFace();
  syncScale();          // 必须在摆放五官/配件之前，renderScale 才知道该乘多少
  buildCanvas();
  buildPaint();
  loadPaint();
  renderPaint();
  loadSkin();
  applySkin();
  initParts();
  initPropTools();      // 手柄要先建好，placeProp 合成 transform 时会引用它
  restoreProps();
  initPaint();
  initTray();
  initSave();
  initNext();           // 「下一步」→ p3.html
  initRecords();
  initReset();
  initTools();
  initPalette();
  setMode('paint');     // 默认进「拼豆涂色」，最不容易误操作

  window.addEventListener('resize', relayout);
})();
