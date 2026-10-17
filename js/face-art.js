/* =========================================================
   情绪脸 · 导出画笔（与 P2 同源）
   ---------------------------------------------------------
   这份画笔是从 js/p2.js 的导出逻辑（EXPORT_* / fillBlock /
   faceBounds / propSprite / drawFace / buildFaceCanvas）原样搬过来的：
   12×12 圆环掩码、24×24 拼豆栅格、五官、配件（含旋转缩放）
   一律按 240 基准的逻辑坐标绘制，k = 1 个逻辑单位占多少设备像素。

   为什么要有这一份：
   P4 海报页中心优先贴 P2 存下的 savedEmotion（透明 PNG），
   读不到（没保存过 / 存储被禁用 / 数据坏了）时用这份画笔按
   epb:face 的数据现画一遍 —— 画出来的就是用户在 P2 里捏的
   那张脸，而不会是任何「初始表情」。
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------------- 几何基准（与 p2.js 完全一致） ---------------- */
  var BALL_SIZE = 240;                 // 逻辑基准边长
  var CENTER = BALL_SIZE / 2;          // 球心 (120, 120)
  var CELL = 20;                       // 五官像素块尺寸
  var PAINT_N = 24;                    // 拼豆栅格 24×24
  var PAINT_CELL = BALL_SIZE / PAINT_N;   // 单个拼豆 10 逻辑单位
  var PAINT_R = 88;                    // 拼豆只铺环内
  var BASE_R = 100;                    // 底色盘半径
  var PROP_CELL = BALL_SIZE / 48;      // 配件 1 格 = 5 逻辑单位

  var PART_INK = '#000000';
  var FACE_PAPER = '#ffffff';

  /* 12×12 像素圆环掩码 */
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

  /* 嘴巴 6 个像素的弧度权重 */
  var MOUTH_SHAPE = [0, 1, 1, 1, 1, 0];

  /* 五官出厂位置：用来判断「初始表情」（初始的绝不画进导出图） */
  var PARTS = {
    'eye-l': { x: 80,  y: 80  },
    'eye-r': { x: 160, y: 80  },
    'mouth': { x: 120, y: 160 }
  };

  /* 调色盘：mark → 颜色 */
  var PALETTE_HEX = {
    w: '#ffffff', r: '#ff3b3b', b: '#2f8fff', p: '#a06bff', k: '#000000',
    g: '#3fcf5e', y: '#ffd93d', i: '#ffa8d8', o: '#ff9a3d'
  };

  var EMPTY = '.';
  var PAINT_TOTAL = PAINT_N * PAINT_N;

  /* 配件图案：掩码 + 出厂色（与 p2.js 的 PROP_ART 同一份） */
  var PROP_ART = {
    'heart': {
      color: '#ff3b3b',
      mask: ['.##..##.', '########', '########', '########', '.######.', '..####..', '...##...']
    },
    'tear-long': {
      color: '#2f8fff',
      mask: ['..#..', '..#..', '.###.', '.###.', '#####', '#####', '#####', '#####', '#####', '.###.', '.###.', '..#..']
    },
    'tear-drop': {
      color: '#2f8fff',
      mask: ['..#..', '.###.', '#####', '#####', '#####', '.###.', '..#..']
    },
    'blush': {
      color: '#ffa8d8',
      mask: ['..######..', '.########.', '##########', '##########', '.########.', '..######..']
    },
    'ring': {
      color: '#2f8fff',
      mask: ['..########..', '.#........#.', '#..........#', '#..........#', '#..........#', '#..........#', '.#........#.', '..########..']
    },
    'glasses': {
      color: '#000000',
      mask: ['.########..########.', '####################', '####################', '####################', '.########..########.']
    },
    'hat': {
      color: '#000000',
      mask: ['...############...', '...############...', '...############...', '...############...', '...############...', '...############...', '...############...', '..##############..', '..##############..', '##################', '##################']
    },
    'anger': {
      color: '#ff3b3b',
      mask: ['##....##', '###..###', '..####..', '..#..#..', '..#..#..', '..####..', '###..###', '##....##']
    }
  };
  PROP_ART['drop'] = PROP_ART['tear-drop'];   // 旧存档用过的名字

  /* 导出开关与留白（与 p2.js 一致：不铺底盘、带圆环外轮廓） */
  var EXPORT_BASE = false;
  var EXPORT_RING = true;
  var EXPORT_PAD  = 12;        // 逻辑单位：四周留一圈透明呼吸位

  /* ---------------- 小工具 ---------------- */
  function colorHex(mark) {
    return PALETTE_HEX[mark] || '';
  }

  function paintIndex(row, col) {
    return row * PAINT_N + col;
  }

  /* 初始表情判定：出厂的方眼睛 + 一字嘴不是用户的作品，导出不画 */
  function isDefaultExpr(key, cur) {
    var cfg = PARTS[key];
    if (!cfg || !cur) return true;

    var moved = Math.abs(cur.x - cfg.x) > 0.5 ||
                Math.abs(cur.y - cfg.y) > 0.5;
    var curved = key === 'mouth' && Math.abs(cur.curve || 0) > 0.001;

    return !moved && !curved && (cur.color || PART_INK) === PART_INK;
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

  /* 内容包围盒：只框真正画出来的像素，四周各留 EXPORT_PAD 透明边 */
  function faceBounds(data) {
    var box = null;

    function grow(x0, y0, x1, y1) {
      if (!box) { box = { x0: x0, y0: y0, x1: x1, y1: y1 }; return; }
      box.x0 = Math.min(box.x0, x0);
      box.y0 = Math.min(box.y0, y0);
      box.x1 = Math.max(box.x1, x1);
      box.y1 = Math.max(box.y1, y1);
    }

    var parts = data.parts || {};
    var i, r, c;

    if (EXPORT_RING) grow(0, 0, BALL_SIZE, BALL_SIZE);

    ['eye-l', 'eye-r'].forEach(function (key) {
      var cur = parts[key];
      if (!cur || isDefaultExpr(key, cur)) return;
      grow(cur.x - CELL, cur.y - CELL, cur.x + CELL, cur.y + CELL);
    });

    var m = parts.mouth;
    if (m && !isDefaultExpr('mouth', m)) {
      for (i = 0; i < MOUTH_SHAPE.length; i++) {
        var my = m.y - CELL / 2 - (m.curve || 0) * MOUTH_SHAPE[i] * CELL;
        grow(m.x + (i - 3) * CELL, my, m.x + (i - 2) * CELL, my + CELL);
      }
    }

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

    (data.props || []).forEach(function (p) {
      var art = PROP_ART[p.prop];
      if (!art) return;

      var s = p.scale || 1;
      var hw = art.mask[0].length * PROP_CELL * s / 2;
      var hh = art.mask.length * PROP_CELL * s / 2;
      var a = (p.rot || 0) * Math.PI / 180;
      var ca = Math.abs(Math.cos(a));
      var sa = Math.abs(Math.sin(a));
      var ex = ca * hw + sa * hh;
      var ey = sa * hw + ca * hh;

      grow(p.x - ex, p.y - ey, p.x + ex, p.y + ey);
    });

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
        ctx.fillRect(bx, by,
          Math.round((c + 1) * cell) - bx,
          Math.round((r + 1) * cell) - by);
      }
    }
    return cv;
  }

  /* 把一份存档画进 ctx。k = 1 个逻辑单位占多少设备像素 */
  function drawFace(ctx, data, k) {
    var unit = BALL_SIZE / RING_MASK.length;      // 圆环 1 格 = 20 逻辑单位
    var skin = data.skin || {};
    var paint = data.paint || '';
    var legacy = /^[01]+$/.test(paint);
    var r, c, i, qx, qy, mark;

    // 1) 白色底盘（默认不画，导出图不要白底）
    if (EXPORT_BASE) {
      var baseColor = skin.base || FACE_PAPER;

      for (r = 0; r < RING_MASK.length; r++) {
        for (c = 0; c < RING_MASK.length; c++) {
          if (RING_MASK[r].charAt(c) === '#') continue;

          qx = (c + 0.5) * unit - CENTER;
          qy = (r + 0.5) * unit - CENTER;
          if (Math.sqrt(qx * qx + qy * qy) > BASE_R) continue;

          fillBlock(ctx, k, c * unit, r * unit, unit, unit, baseColor);
        }
      }
    }

    // 2) 黑色圆环外轮廓
    if (EXPORT_RING) {
      var ringColor = skin.ring || PART_INK;

      for (r = 0; r < RING_MASK.length; r++) {
        for (c = 0; c < RING_MASK.length; c++) {
          if (RING_MASK[r].charAt(c) !== '#') continue;
          fillBlock(ctx, k, c * unit, r * unit, unit, unit, ringColor);
        }
      }
    }

    // 3) 拼豆涂色：只画环内
    for (r = 0; r < PAINT_N; r++) {
      for (c = 0; c < PAINT_N; c++) {
        var ch = paint.charAt(paintIndex(r, c));
        mark = legacy ? (ch === '1' ? 'k' : EMPTY) : ch;
        if (!mark || mark === EMPTY) continue;

        var hex = colorHex(mark);
        if (!hex) continue;

        qx = (c + 0.5) * PAINT_CELL - CENTER;
        qy = (r + 0.5) * PAINT_CELL - CENTER;
        if (Math.sqrt(qx * qx + qy * qy) > PAINT_R) continue;

        fillBlock(ctx, k, c * PAINT_CELL, r * PAINT_CELL,
                  PAINT_CELL, PAINT_CELL, hex);
      }
    }

    // 4) 眼睛：以中心为基准的 2×2 格
    ['eye-l', 'eye-r'].forEach(function (key) {
      var cur = (data.parts || {})[key];
      if (!cur || isDefaultExpr(key, cur)) return;

      fillBlock(ctx, k, cur.x - CELL, cur.y - CELL,
                CELL * 2, CELL * 2, cur.color || PART_INK);
    });

    // 5) 嘴巴：6 个 1 格方块，中间 4 个按弧度错开
    var m = (data.parts || {}).mouth;
    if (m && !isDefaultExpr('mouth', m)) {
      for (i = 0; i < MOUTH_SHAPE.length; i++) {
        fillBlock(ctx, k,
                  m.x + (i - 3) * CELL,
                  m.y - CELL / 2 - (m.curve || 0) * MOUTH_SHAPE[i] * CELL,
                  CELL, CELL, m.color || PART_INK);
      }
    }

    // 6) 配件：贴一张转好角的位图
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

  /* 渲染成一张紧贴内容的 canvas（与 P2 导出同一套尺寸规则） */
  function buildCanvas(data, k) {
    var box = faceBounds(data);
    var cv = document.createElement('canvas');

    cv.width  = Math.max(1, Math.round((box.x1 - box.x0) * k));
    cv.height = Math.max(1, Math.round((box.y1 - box.y0) * k));

    var ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(-box.x0 * k), Math.round(-box.y0 * k));
    drawFace(ctx, data, k);

    return cv;
  }

  global.FaceArt = {
    BALL_SIZE: BALL_SIZE,
    EXPORT_SCALE: 4,          // 与 P2 的导出清晰度一致：1 逻辑单位 = 4 设备像素
    drawFace: drawFace,
    buildCanvas: buildCanvas,
    faceBounds: faceBounds,
    hasContent: function (data) {
      if (!data || data.v !== 1 || !data.parts) return false;
      var b = faceBounds(data);
      // 圆环始终在，所以「有没有内容」看的是涂色 / 五官 / 配件
      return !!((data.paint || '').replace(/\./g, '') ||
                !isDefaultExpr('eye-l', data.parts['eye-l']) ||
                !isDefaultExpr('mouth', data.parts.mouth) ||
                (data.props || []).length);
    }
  };
})(window);
