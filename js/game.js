/* =========================================================
   小游戏 · 击碎消极情绪
   ---------------------------------------------------------
   球是 DOM，不是 canvas：每颗 = 一个 .gball，里面装
   Mood.ballHTML(id) 拼出的情绪球（形状来自 css/mood.css），
   和 P3 弹窗、P4 海报是同一份像素图形。

   规则：
     · 消极球（哭泣 / 愤怒 / 心累）：点中 = 击碎 +1，落地 = 漏掉 +1
     · 积极球（平静 / 开心 / 心动）：点中 = 失误，落地不罚
     · 击碎 30 个 → 胜利；漏掉 5 个消极球 → 失败
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- 规则常量 ---------------- */
  var GOAL       = 30;      // 击碎 30 个消极球就赢
  var MISS_LIMIT = 5;       // 漏掉 5 个消极球就输
  var BAD_RATIO  = 0.6;     // 消极球出现概率

  var GRAVITY    = 60;      // 重力加速度 px/s²
  var RADIUS     = 36;      // .mood 是 72×72，半径 36
  var HIT_SLACK  = 6;       // 判定半径放宽，手感更松

  /* 六种情绪球按 mood.css 的 id 分两类 */
  var BAD_IDS  = ['cry', 'angry', 'tired'];     // 哭泣 · 愤怒 · 心累
  var GOOD_IDS = ['calm', 'happy', 'heart'];    // 平静 · 开心 · 心动

  /* ---------------- DOM ---------------- */
  var stageEl     = document.getElementById('gstage');
  var fieldEl     = document.getElementById('gfield');
  var flashEl     = document.getElementById('gflash');
  var statHits    = document.getElementById('statHits');
  var statErr     = document.getElementById('statErr');
  var statMiss    = document.getElementById('statMiss');
  var barFill     = document.getElementById('gbarFill');
  var startScreen = document.getElementById('startScreen');
  var winScreen   = document.getElementById('winScreen');
  var loseScreen  = document.getElementById('loseScreen');
  var winStats    = document.getElementById('winStats');
  var loseStats   = document.getElementById('loseStats');

  /* ---------------- 状态 ---------------- */
  var W = 0, H = 0, groundY = 0;

  var balls = [];
  var hits = 0, errors = 0, missed = 0;

  var spawnTimer = 0;
  var running = false;
  var rafId = 0;
  var lastT = 0;

  /* =========================================================
     1. 尺寸与落点
     ========================================================= */
  function resize() {
    var rect = stageEl.getBoundingClientRect();

    W = Math.max(240, Math.round(rect.width));
    H = Math.max(240, Math.round(rect.height));

    groundY = H - 10;          // 和 .gfield::after 那条地面虚线对齐
  }

  /* 球心坐标 → transform（.gball 是 72×72，左上角在球心左侧 36） */
  function place(b) {
    b.el.style.transform =
      'translate3d(' + Math.round(b.x - RADIUS) + 'px,' +
      Math.round(b.y - RADIUS) + 'px,0)';
  }

  /* =========================================================
     2. 生成
     ========================================================= */
  function spawnBall() {
    var bad = Math.random() < BAD_RATIO;
    var pool = bad ? BAD_IDS : GOOD_IDS;
    var id = pool[(Math.random() * pool.length) | 0];

    /* 一颗球 = 一个定位盒子 + 共享模块拼出来的情绪球 DOM */
    var el = document.createElement('div');
    el.className = 'gball';
    el.innerHTML = Mood.ballHTML(id);
    fieldEl.appendChild(el);

    // 越往后球掉得越快
    var speed = 80 + Math.min(80, hits * 2.7);

    var ball = {
      id: id,
      bad: bad,
      el: el,
      x: RADIUS + Math.random() * Math.max(1, W - RADIUS * 2),
      y: -RADIUS,
      vx: (Math.random() - .5) * 50,                 // 水平漂移
      vy: speed * (.85 + Math.random() * .3),
      wob: Math.random() * Math.PI * 2,              // 摆动相位
      state: 'fall'
    };

    balls.push(ball);
    place(ball);
  }

  /* =========================================================
     3. 物理与落地判定
     ========================================================= */
  function update(dt) {
    // 生成节奏随击碎数加快：1.1s → 0.5s
    var interval = Math.max(.5, 1.1 - hits * .02);
    spawnTimer += dt;
    if (spawnTimer >= interval) {
      spawnTimer = 0;
      spawnBall();
    }

    for (var i = balls.length - 1; i >= 0; i--) {
      var b = balls[i];
      if (b.state !== 'fall') continue;

      // 重力 + 正弦摆动
      b.vy += GRAVITY * dt;
      b.wob += dt * 2.2;
      b.x += (b.vx + Math.sin(b.wob) * 26) * dt;
      b.y += b.vy * dt;

      // 左右边界轻弹
      if (b.x < RADIUS) {
        b.x = RADIUS;
        b.vx = Math.abs(b.vx);
      } else if (b.x > W - RADIUS) {
        b.x = W - RADIUS;
        b.vx = -Math.abs(b.vx);
      }

      // 掉到地面
      if (b.y + RADIUS >= groundY) {
        b.y = groundY - RADIUS;

        if (b.bad) {
          /* 漏掉一个消极球：计数 + 边缘红闪；够 5 个直接结束 */
          missed++;
          updateHud();
          penaltyFlash();
          retire(b, 'is-miss');

          if (missed >= MISS_LIMIT) {
            lose();
            return;
          }
        } else {
          /* 积极球落地不罚，安静消失 */
          b.state = 'gone';
          b.el.parentNode && b.el.parentNode.removeChild(b.el);
          balls.splice(i, 1);
        }

        continue;
      }

      place(b);
    }
  }

  /* =========================================================
     4. 命中判定
     ========================================================= */
  function hitBall(b) {
    if (b.bad) {
      hits++;
      floatText(b.x, b.y, '+1');
      updateHud();
      retire(b, 'is-pop');

      if (hits >= GOAL) win();
    } else {
      // 点到积极球 = 失误：全屏红闪，球抖掉
      errors++;
      updateHud();
      flashScreen();
      retire(b, 'is-bad');
    }
  }

  /* 让一颗球退场：加动画类、从物理列表摘掉，动画结束再移除 DOM */
  function retire(b, cls) {
    b.state = 'gone';
    b.el.classList.add(cls);

    var idx = balls.indexOf(b);
    if (idx !== -1) balls.splice(idx, 1);

    setTimeout(function () {
      if (b.el.parentNode) b.el.parentNode.removeChild(b.el);
    }, 460);
  }

  function onPointerDown(e) {
    if (!running) return;

    var rect = stageEl.getBoundingClientRect();
    var px = e.clientX - rect.left;
    var py = e.clientY - rect.top;

    // 从后往前找，后生成的在上层
    for (var i = balls.length - 1; i >= 0; i--) {
      var b = balls[i];
      if (b.state !== 'fall') continue;

      var dx = px - b.x;
      var dy = py - b.y;
      var rr = RADIUS + HIT_SLACK;

      if (dx * dx + dy * dy <= rr * rr) {
        hitBall(b);
        return;
      }
    }
  }

  /* =========================================================
     5. 界面反馈
     ========================================================= */
  function updateHud() {
    statHits.textContent = hits;
    statErr.textContent = errors;
    statMiss.textContent = missed;
    barFill.style.width = Math.min(100, (hits / GOAL) * 100) + '%';
  }

  /* 命中时的 +1 飘字（DOM，自己淡出后移除） */
  function floatText(x, y, text) {
    var el = document.createElement('i');
    el.className = 'gfloat';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    fieldEl.appendChild(el);

    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 720);
  }

  /* 漏球惩罚：舞台四条边闪一下红光 */
  function penaltyFlash() {
    stageEl.classList.remove('is-penalty');
    void stageEl.offsetWidth;
    stageEl.classList.add('is-penalty');
  }

  /* 误点积极球：全屏红闪 */
  function flashScreen() {
    flashEl.classList.remove('is-on');
    void flashEl.offsetWidth;
    flashEl.classList.add('is-on');
  }

  /* =========================================================
     6. 结束
     ========================================================= */
  function win() {
    running = false;
    cancelAnimationFrame(rafId);

    winStats.textContent = '失误 ' + errors + ' 次 · 漏掉 ' + missed + ' 个';
    winScreen.hidden = false;
  }

  function lose() {
    running = false;
    cancelAnimationFrame(rafId);

    loseStats.textContent = '击碎 ' + hits + ' 个 · 失误 ' + errors +
      ' 次 · 漏掉 ' + missed + ' 个';
    loseScreen.hidden = false;
  }

  /* =========================================================
     7. 主循环
     ========================================================= */
  function loop(t) {
    if (!running) return;

    var dt = lastT ? (t - lastT) / 1000 : 0;
    lastT = t;

    // 切走标签页回来时 dt 会很大，钳一下免得球瞬移
    if (dt > .05) dt = .05;

    update(dt);
    rafId = requestAnimationFrame(loop);
  }

  /* =========================================================
     8. 开始 / 重开
     ========================================================= */
  function startGame() {
    balls.length = 0;
    fieldEl.innerHTML = '';          // 上一局残留的球和飘字一起清掉
    stageEl.classList.remove('is-penalty');

    hits = 0;
    errors = 0;
    missed = 0;
    spawnTimer = 0;
    lastT = 0;

    updateHud();

    startScreen.hidden = true;
    winScreen.hidden = true;
    loseScreen.hidden = true;

    resize();
    running = true;
    rafId = requestAnimationFrame(loop);
  }

  /* ---------------- 启动 ---------------- */
  resize();

  window.addEventListener('resize', resize);
  stageEl.addEventListener('mousedown', onPointerDown);

  document.getElementById('startBtn').addEventListener('click', startGame);
  document.getElementById('againBtn').addEventListener('click', startGame);
  document.getElementById('retryBtn').addEventListener('click', startGame);
})();
