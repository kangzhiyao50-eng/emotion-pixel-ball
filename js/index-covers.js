/* =========================================================
   P1 第三块区域：两张卡片的封面生成
   ---------------------------------------------------------
   1. P2 卡 —— 4 行 6 列的配件格，图标按固定顺序循环摆放
      （图形本身全在 css/style.css 的 .ico--xxx 里）
   2. GAME 卡 —— 随机散落 10 颗情绪球，形状直接复用
      css/mood.css，DOM 由 js/mood.js 的 ballHTML() 拼
   ========================================================= */
(function () {
  'use strict';

  /* =========================================================
     P2：配件格
     ========================================================= */
  var grid = document.getElementById('p2Grid');

  /* 七种外观配件，按顺序循环填满 4×6 的格子 */
  var ICONS = ['heart', 'drop', 'blush', 'hat', 'glasses', 'anger', 'bucket'];
  var COLS = 6;
  var ROWS = 4;

  if (grid) {
    var html = '';

    for (var i = 0; i < COLS * ROWS; i++) {
      html += '<i class="ico ico--' + ICONS[i % ICONS.length] + '"></i>';
    }

    grid.innerHTML = html;
  }

  /* =========================================================
     GAME：散落的情绪球
     ========================================================= */
  var box = document.getElementById('gameBalls');

  if (box && window.Mood) {
    var IDS = ['calm', 'cry', 'happy', 'angry', 'tired', 'heart'];
    var COUNT = 10;

    /* 先把画面切成 4×3 的格子，每格最多放一颗 ——
       这样既随机散落，又不会挤成一团或者排成一条直线 */
    var cells = [];

    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 4; c++) {
        cells.push([c, r]);
      }
    }

    // Fisher–Yates 洗牌
    for (var k = cells.length - 1; k > 0; k--) {
      var j = Math.floor(Math.random() * (k + 1));
      var t = cells[k];
      cells[k] = cells[j];
      cells[j] = t;
    }

    for (var n = 0; n < COUNT; n++) {
      var cell = cells[n];
      var id = IDS[(Math.random() * IDS.length) | 0];

      var ball = document.createElement('span');
      ball.className = 'cover-ball';
      ball.innerHTML = Mood.ballHTML(id);

      /* 在格子内部再抖一下，位置就不会平齐；
         顶部 22% 留给 "game" 标题，球只排在它下面 */
      var left = ((cell[0] + .18 + Math.random() * .64) / 4) * 100;
      var top = 22 + ((cell[1] + .12 + Math.random() * .76) / 3) * 74;

      ball.style.left = left.toFixed(2) + '%';
      ball.style.top = top.toFixed(2) + '%';

      // 每颗的大小也略有差别，看起来更像随手撒的
      ball.style.setProperty('--s', (.3 + Math.random() * .14).toFixed(3));

      box.appendChild(ball);
    }
  }
})();
