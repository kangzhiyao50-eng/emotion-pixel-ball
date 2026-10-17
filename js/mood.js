/* =========================================================
   情绪球 · 共享模块
   ---------------------------------------------------------
   一颗球 = 圆底 + 若干像素块。形状（每个零件摆在哪、由哪几个
   像素块组成）只有一处定义：css/mood.css 里的 .mood--xxx 规则。
   这里只做两件事：

   1. ballHTML(id) —— 按「有哪些零件」拼出球的 DOM
      （P3 的弹窗、P4 的海报都用它，顺序 = 叠放顺序）

   2. drawBall(ctx, el, cx, cy, size) —— 把页面上那颗真实渲染出来的球
      原样画进 canvas：直接读元素的 computed style（背景色 / 尺寸 /
      box-shadow 偏移），所以 CSS 改一次，页面和导出图同时跟着变，
      不存在第二份坐标表。
   ========================================================= */
(function (global) {
  'use strict';

  /* 每种情绪有哪些零件。零件顺序 = DOM 顺序 = 叠放顺序
     （后写的压在上面，舌头就是这么压在嘴巴上的） */
  var PARTS = {
    calm:  ['eye-l', 'eye-r', 'mouth'],
    cry:   ['brow-l', 'brow-r', 'eye-l', 'eye-r', 'tear-l', 'tear-r', 'mouth'],
    happy: ['eye-l', 'eye-r', 'mouth', 'tongue'],
    angry: ['brow-l', 'brow-r', 'vein', 'eye-l', 'eye-r', 'mouth'],
    tired: ['eye-l', 'eye-r', 'mouth'],
    heart: ['eye-l', 'eye-r', 'mouth', 'spark-a', 'spark-b', 'spark-c']
  };

  var IDS = ['calm', 'cry', 'happy', 'angry', 'tired', 'heart'];

  /* P3 存进 localStorage('selectedMood') 的是大写类型名，
     海报页要按它取球，这里给出「类型名 → id」的对照 */
  var MOOD_TO_ID = {
    'CALM': 'calm', 'CRY': 'cry', 'HAPPY': 'happy',
    'ANGRY': 'angry', 'TIRED': 'tired', 'HEART-FLUTTERING': 'heart',
    'LAUGH': 'happy', 'DOWN': 'tired'          // 老存档用过的两个名字
  };

  /* 球体基准边长，和 css/mood.css 的 .mood 保持一致 */
  var BALL = 72;

  function isId(id) {
    return Object.prototype.hasOwnProperty.call(PARTS, id);
  }

  function idFromMood(mood) {
    return MOOD_TO_ID[mood] || '';
  }

  /* 拼一颗球的 DOM 字符串 */
  function ballHTML(id) {
    if (!isId(id)) id = 'calm';

    var parts = PARTS[id];
    var html = '<span class="mood mood--' + id + '">';

    parts.forEach(function (part) {
      html += '<i class="mood__px mood__px--' + part + '"></i>';
    });

    return html + '</span>';
  }

  /* ---------------- computed style → canvas ---------------- */
  /* box-shadow 列表按逗号切，但不能切到 rgb(0, 0, 0) 里面去 */
  function splitShadow(str) {
    return str.split(/,(?![^(]*\))/);
  }

  /* 'inset 0px 0px 0px 4px rgb(0,0,0)' → { width: 4, color: 'rgb(0,0,0)' } */
  function readInsetRing(shadow) {
    if (!shadow || shadow === 'none') return null;

    var parts = splitShadow(shadow);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf('inset') === -1) continue;

      var nums = parts[i].match(/-?\d+(?:\.\d+)?px/g) || [];
      var spread = nums[3] ? parseFloat(nums[3]) : 0;
      var color = parts[i].replace(/-?\d+(?:\.\d+)?px/g, '')
                           .replace('inset', '').trim();
      return color ? { width: spread, color: color } : null;
    }
    return null;
  }

  /* 'rgb(0,0,0) 6px 6px 0px 0px' → [{ x:6, y:6, color:'rgb(0,0,0)' }] */
  function readOffsets(shadow) {
    if (!shadow || shadow === 'none') return [];

    var out = [];
    splitShadow(shadow).forEach(function (part) {
      if (part.indexOf('inset') !== -1) return;

      var nums = part.match(/-?\d+(?:\.\d+)?px/g) || [];
      if (nums.length < 2) return;

      var color = part.replace(/-?\d+(?:\.\d+)?px/g, '').trim();
      out.push({
        x: parseFloat(nums[0]),
        y: parseFloat(nums[1]),
        color: color || 'rgb(0, 0, 0)'
      });
    });
    return out;
  }

  /* 把页面上渲染好的那颗球画到 canvas。
     (cx, cy) = 球心，(size) = 球在 canvas 上要画多大 */
  function drawBall(ctx, el, cx, cy, size) {
    if (!el) return false;

    var rect = el.getBoundingClientRect();
    if (!rect.width) return false;

    var k = size / rect.width;             // 屏幕像素 → canvas 像素
    /* 球自身被 CSS 缩过（页面上是 72px 缩到 20px 左右）。
       getBoundingClientRect 拿到的是缩放后的尺寸，而 computed style
       里的数值仍是布局值 —— 两者差一个 ballScale，读描边宽度时要乘回来，
       否则描边会粗好几倍、整颗球看上去糊成一团黑 */
    var ballScale = el.offsetWidth ? rect.width / el.offsetWidth : 1;

    var cs = global.getComputedStyle(el);
    var r = size / 2;
    var x0 = cx - r;
    var y0 = cy - r;

    // 圆底
    ctx.fillStyle = cs.backgroundColor;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // 像素描边（.mood 的 inset box-shadow）
    var ring = readInsetRing(cs.boxShadow);
    if (ring && ring.width > 0) {
      var lw = ring.width * ballScale * k;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(cx, cy, r - lw / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 像素块：本体 + box-shadow 复制出来的那些。
    // 坐标与边长都用浮点，交给 canvas 抗锯齿 —— 和浏览器渲染这份 CSS
    // 的方式一致（取整反而会让小块变大、颜色比例失真）
    var dots = el.querySelectorAll('.mood__px');

    Array.prototype.forEach.call(dots, function (dot) {
      var dr = dot.getBoundingClientRect();
      if (!dr.width) return;

      var dcs = global.getComputedStyle(dot);
      var w = dr.width * k;
      var h = dr.height * k;
      var bx = x0 + (dr.left - rect.left) * k;
      var by = y0 + (dr.top - rect.top) * k;

      ctx.fillStyle = dcs.backgroundColor;
      ctx.fillRect(bx, by, w, h);

      readOffsets(dcs.boxShadow).forEach(function (s) {
        ctx.fillStyle = s.color;
        ctx.fillRect(bx + s.x * ballScale * k, by + s.y * ballScale * k, w, h);
      });
    });

    return true;
  }

  global.Mood = {
    BALL: BALL,
    IDS: IDS,
    PARTS: PARTS,
    isId: isId,
    idFromMood: idFromMood,
    ballHTML: ballHTML,
    drawBall: drawBall
  };
})(window);
