/* =========================================================
   P1 背景 · 软体物理果冻球
   ---------------------------------------------------------
   引擎来自 OpenProcessing sketch 1845995（skech/sketch1845995/）：
     Coordinate2D   坐标基类
     Particle       Verlet 质点（速度 + 阻尼 + 摩擦）
     DistanceJoint  距离约束（相邻 0.75 / 隔点 0.25 两组）
     HashGrid       空间哈希，把近邻碰撞从 O(n²) 降到近似 O(n)
     geometry       多边形面积、法线等几何工具
   球体靠「面积约束」维持体积：每帧算出 areaDiff，
   让每个顶点沿前后邻居连线的法线方向胀缩，因此挤压后会自动回弹。

   本文件是主 sketch，相对原版只做四处改造：
     1. canvas 只当背景：全屏 fixed + pointer-events:none（样式在 style.css）
     2. 删掉 background(10)，改用 clear()，让页面的白透上来
     3. 删掉跟随鼠标的大圆 circle(mx, my, ...)，以及它参与的那次碰撞
     4. 颜色从 HSB 随机彩色改成半透明黑
   ========================================================= */

/* ---------------- 参数 ---------------- */
const JELLY = {
  maxVertexCount: 660,   // 顶点总数上限 —— 决定“屏上有几颗球”的就是它。
                         // 每颗球的顶点数 ≈ 2πr / jStep，而 r 与 jStep 都正比于
                         // min(宽,高)，两边的尺寸因子约掉 —— 所以这个配比的球数
                         // 在任何分辨率的屏幕上都是 15~20 颗，平均 17 颗左右
  substeps:       8,     // 每帧物理子步数，越高越稳也越重
  minRadius:      0.08,  // 半径下限（相对 min(w,h)）：1080 高的屏上约 86px
  maxRadius:      0.14,  // 半径上限（相对 min(w,h)）：1080 高的屏上约 151px
  vertexDistance: 0.015, // 顶点间距（相对 min(w,h)），越小顶点越多越顺滑
  marginX:        24,    // 左右留白
  marginY:        24,    // 底部留白

  gravity:        1000,  // 重力加速度
  frameRate:      50,

  fillAlpha:      24,    // 球体填充不透明度 24/255 ≈ 9.4%（背景层，保持半透明）
  strokeAlpha:    30,    // 轮廓不透明度

  /* --- 配色：照搬 sketch1845995 的 HSB 方案 ---
     原版是 color(random(360), random(30, 100), 100)：
     色相全随机、饱和度 30~100、亮度拉满，每颗球一个色。
     这里只把「不透明度」留着用背景层自己的半透明值。
     想切回纯黑白：把 minSat 和 maxSat 都写成 0（HSB 里 S=0 就是灰阶）。
     --------------------------------------------------- */
  minSat:         30,    // 饱和度下限
  maxSat:        100,    // 饱和度上限

  /* --- 像素表情 ---------------------------------------------------
     五官用纯黑矩形拼出来，尺寸全部写死，不随球体大小缩放：
     球怎么被挤压变形，脸都保持同样的像素颗粒感。
     每颗球在生成时随机领一个表情。
     --------------------------------------------------------------- */
  emotions:       ['happy', 'calm', 'angry', 'shock'],
  faceEyeSize:    10,    // 单只眼睛的边长
  faceEyeGap:     32,    // 两只眼睛的中心距
  faceEyeY:      -14,    // 眼睛相对球心的纵向偏移（负 = 偏上）
  faceMouthY:     16,    // 嘴巴相对球心的纵向偏移
  faceUnit:        8     // 嘴巴每个像素块的边长
};

/* ---------------- 场景状态 ---------------- */
let jBlobs;
let jParticles;
let jJoints;
let jGrid;
let jStep;              // 实际顶点间距（像素）

/* =========================================================
   修正上游的一个笔误
   ---------------------------------------------------------
   原 hash-grid.js 的 HashGridClient.update() 里，
   计算 Y 方向新索引时误取了 item.x：
       const newIndexY = this.hashGrid.getIndex(this.item.x);
   后果是 —— 顶点只沿 Y 方向移动（比如垂直下落）时，
   它不会换格子，于是 query() 可能查不到附近的邻居，碰撞被漏掉。
   这里在不动你源文件的前提下把它盖掉。
   ========================================================= */
let jGridPatched = false;

function patchHashGrid() {
  if (jGridPatched) return;
  jGridPatched = true;

  HashGridClient.prototype.update = function () {
    const nx = this.hashGrid.getIndex(this.item.x);
    const ny = this.hashGrid.getIndex(this.item.y);

    if (nx === this.indexX && ny === this.indexY) return;

    this.cell.delete(this.item);
    this.cell = this.hashGrid.addItem(this.item);
    this.indexX = nx;
    this.indexY = ny;
  };
}

/* =========================================================
   场景容器：果冻球只活在 #hero-section（第一屏）里
   ---------------------------------------------------------
   画布尺寸跟着这个容器走，容器自身 overflow:hidden，
   溢出的部分由 CSS 裁掉，所以下面几屏不会再看到球。
   ========================================================= */
function heroStage() {
  return document.getElementById('hero-section');
}

/* 容器尺寸；万一容器还没上树或尺寸为 0，就退回视口兜底 */
function stageSize() {
  const el = heroStage();
  const w = el ? el.clientWidth : 0;
  const h = el ? el.clientHeight : 0;
  return (w > 0 && h > 0) ? { w, h } : { w: windowWidth, h: windowHeight };
}

/* =========================================================
   p5 生命周期
   ========================================================= */
function setup() {
  patchHashGrid();           // 先把上游的哈希格子笔误补掉

  // 画布尺寸取自 #hero-section，不再是整个 windowWidth / windowHeight
  const stage = stageSize();
  const c = createCanvas(stage.w, stage.h);
  c.id('jelly-bg');          // 定位与层级全部交给 CSS
  c.parent(heroStage() || document.body);   // 把画布挂进第一屏容器里

  // 切到 HSB：色相 0~360、饱和度与亮度 0~100，和原 sketch 一致；
  // alpha 仍按 0~255，这样 fillAlpha / strokeAlpha 的数值含义保持不变
  colorMode(HSB, 360, 100, 100, 255);

  pixelDensity(1);           // 背景动画，优先保帧率
  frameRate(JELLY.frameRate);

  jStep = JELLY.vertexDistance * min(width, height);

  jGrid = new HashGrid(width, height, Math.floor(jStep * 2));
  jParticles = [];
  jJoints = [];
  jBlobs = [];

  buildBlobs();
}

function draw() {
  const dt = 1 / 60;
  const sdt = dt / JELLY.substeps;

  // 让每个顶点先把自己挪到正确的哈希格子里
  for (let i = jParticles.length; i--;) {
    jParticles[i].updateClient();
  }

  for (let substep = JELLY.substeps; substep--;) {

    // ---- 1. 每个球离目标面积还差多少 ----
    for (let i = jBlobs.length; i--;) {
      const blob = jBlobs[i];
      blob.currentArea = geometry.polygonArea(blob.particles);
      blob.areaDiff = (blob.area - blob.currentArea) / blob.area;
    }

    // ---- 2. 重力 + 积分 ----
    for (let i = jParticles.length; i--;) {
      const particle = jParticles[i];
      particle.addForce(0, JELLY.gravity * sdt, 0);

      // 限速，避免子步过大时穿透
      const v = geometry.limit(
        { x: particle.vx, y: particle.vy },
        (jStep / sdt) * 2
      );
      particle.vx = v.x;
      particle.vy = v.y;

      particle.update(sdt);
    }

    // ---- 3. 面积约束：沿前后邻居连线的法线胀缩 ----
    for (let i = jParticles.length; i--;) {
      const v = jParticles[i];
      const v0 = v.prevSibling;
      const v1 = v.nextSibling;

      const n = geometry.getLineNormal(v0.x, v0.y, v1.x, v1.y);
      const dir = v.parent.areaDiff;

      v.move(n.x * dir, n.y * dir, 0);
    }

    // ---- 4. 距离约束（相邻 + 隔点）----
    for (let i = jJoints.length; i--;) {
      jJoints[i].update(1);
    }

    // ---- 5. 近邻碰撞，用空间哈希加速 ----
    for (let i = jParticles.length; i--;) {
      const particle = jParticles[i];

      jGrid
        .query(particle.x, particle.y, particle.radius)
        .forEach((other) => {
          if (
            other === particle ||
            other === particle.nextSibling ||
            other === particle.prevSibling
          ) return;

          const force = particle.testCollision(other.x, other.y, other.radius);
          if (force) {
            particle.move(force.x * 0.5, force.y * 0.5);
            other.move(-force.x * 0.5, -force.y * 0.5);
          }
        });
    }

    // ---- 6. 边界（上方开口，让球从屏幕外落进来）----
    for (let i = jParticles.length; i--;) {
      const particle = jParticles[i];

      particle.constrain(
        JELLY.marginX,
        -1e9,
        width - JELLY.marginX,
        height - JELLY.marginY
      );

      particle.endUpdate(sdt);
    }
  }

  /* 原版这里是 background(10) 画一块深色底。
     改成 clear() —— 把画布清成完全透明，页面的白会透上来 */
  clear();

  for (let i = jBlobs.length; i--;) {
    const blob = jBlobs[i];

    // 球心 = 所有顶点的平均坐标。球被挤压变形时它跟着走，
    // 五官因此永远待在球的中央，不会被甩到边缘去
    const c = blobCenter(blob);

    drawBlob(blob);
    drawPixelEmotion(blob, blob.emotionType, c.x, c.y);
  }
}

function windowResized() {
  // 视口变了，第一屏容器也跟着变 → 画布重新对齐容器尺寸
  const stage = stageSize();
  if (stage.w === width && stage.h === height) return;  // 尺寸没变就不白重建一遍

  resizeCanvas(stage.w, stage.h);
  // 画布尺寸变了，哈希网格的格子划分也要跟着重建
  setupScene();
}

/* =========================================================
   场景搭建
   ========================================================= */
function setupScene() {
  jStep = JELLY.vertexDistance * min(width, height);

  jGrid = new HashGrid(width, height, Math.floor(jStep * 2));
  jParticles = [];
  jJoints = [];
  jBlobs = [];

  buildBlobs();
}

/* 从下往上一颗颗堆出去，整排初始位置在屏幕上方，
   所以开场就是一片球从天而降 */
function buildBlobs() {
  const minLength = min(width, height);

  let offsetY = 0;
  let totalArea = 0;
  let prevRadius = 0;

  const maxArea =
    (width - JELLY.marginX * 2) * (height - JELLY.marginY * 2) * 0.8;

  while (totalArea < maxArea && jParticles.length < JELLY.maxVertexCount) {
    const radiusLimit = (maxArea - totalArea) / (PI * 2);

    // random(1) ** 3 让小球更常见、大球偶尔出现
    const radius = Math.min(
      radiusLimit,
      (random(1) ** 3 * (JELLY.maxRadius - JELLY.minRadius) + JELLY.minRadius) * minLength
    );

    // 依次往上叠，每颗之间留 50px 间隙
    offsetY += prevRadius + radius + 50;

    const blob = makeBlob(
      width / 2 + random(-1, 1) * (width / 2 - JELLY.marginX - radius),
      height / 2 - offsetY,
      radius
    );

    totalArea += blob.area;
    jBlobs.push(blob);
    jParticles.push(...blob.particles);
    jJoints.push(...blob.joints);

    prevRadius = radius;
  }
}

/* 生成一颗球：一圈顶点组成闭环，配上两组距离约束 */
function makeBlob(offsetX, offsetY, radius) {
  const numPoints = Math.floor((radius * PI * 2) / jStep);

  const vertices = new Array(numPoints).fill(0).map((_, i, { length }) => {
    const angle = (i / length) * TWO_PI;

    const particle = new ChainableParticle({
      x: Math.cos(angle) * radius + offsetX,
      y: Math.sin(angle) * radius + offsetY,
      z: 0,
      damping: 1,
      friction: 0.1,
      radius: jStep,
      mass: 1
    });

    // 每个顶点在哈希网格里挂一个客户端，负责跟随它换格子
    particle.setClient(jGrid.createClient(particle));

    return particle;
  });

  // 串成环形链表
  vertices.forEach((v, i, { length }) => {
    v.setPrevSibling(vertices[(i + length - 1) % length]);
    v.setNextSibling(vertices[(i + 1) % length]);
    if (i === 0) v.setIsRoot(true);
  });

  // 相邻顶点硬一点、隔点软一点，兼顾周长与圆度
  const joints = vertices
    .map((v) => {
      const v2 = v.nextSibling.nextSibling;
      return [
        new DistanceJoint(v, v.nextSibling, jStep, 0.75),
        new DistanceJoint(v, v2, jStep * 2, 0.25)
      ];
    })
    .flat();

  // 目标面积取初始面积的 0.6~0.9，球一出生会先“吸口气”鼓起来
  const area = geometry.polygonArea(vertices) * random(0.6, 0.9);

  const blob = {
    area,
    currentArea: area,
    areaDiff: 0,
    rootParticle: vertices[0],
    particles: vertices,
    joints,
    radius,
    // 生成时就随机领一个表情，之后固定不变（“这颗球是开心的”）
    emotionType: random(JELLY.emotions),
    // 配色：色相整圈随机、饱和度 30~100、亮度 100 —— 与原 sketch 一致
    hue: random(360),
    sat: random(JELLY.minSat, JELLY.maxSat)
  };

  blob.particles.forEach((particle) => {
    particle.parent = blob;
  });

  return blob;
}

/* =========================================================
   绘制
   ========================================================= */
function drawBlob(blob) {
  const pts = blob.particles;
  const n = pts.length;
  if (n < 3) return;

  // 配色照搬原 sketch：同一个色相 / 饱和度、亮度拉满，
  // 填充和描边只是不透明度不同，所以看起来是同一种颜色的球
  // 描边比顶点间距还粗，相邻顶点的小圆就连成了一条连续的轮廓带
  stroke(blob.hue, blob.sat, 100, JELLY.strokeAlpha);
  // 视口很小时 jStep*2-6 会变成负数，而 canvas 的 lineWidth 不接受负值，
  // 所以兜一个下限，别让 draw() 在这里抛异常
  strokeWeight(Math.max(1, jStep * 2 - 6));
  fill(blob.hue, blob.sat, 100, JELLY.fillAlpha);

  beginShape();
  // curveVertex 要多喂三个点，首尾才能平滑接上
  for (let k = 0; k < n + 3; k++) {
    const p = pts[k % n];
    curveVertex(p.x, p.y);
  }
  endShape(CLOSE);
}

/* =========================================================
   像素表情（渲染层，和物理完全无关）
   ---------------------------------------------------------
   五官只用 rect() 拼，纯黑、尺寸写死，不跟球体缩放，
   所以球被压扁拉长时，脸还是那副紧凑的像素颗粒感。
   下面的块坐标是「格子单位」，乘 faceUnit 才是真实像素。
   ========================================================= */
const FACE_MOUTH = {
  // 开心：两边高、中间低的上弯弧线
  happy: [[-2, -1], [2, -1], [-1, 0], [1, 0], [0, 1]],
  // 平静：一条直线
  calm:  [[-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0]],
  // 生气：倒 V 字，中间高、两边低
  angry: [[0, -1], [-1, 0], [1, 0], [-2, 1], [2, 1]],
  // 惊讶：方框小嘴（中间镂空）
  shock: [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
};

/* 球心 = 所有顶点的平均坐标 */
function blobCenter(blob) {
  const pts = blob.particles;
  let sx = 0;
  let sy = 0;

  for (let i = pts.length; i--;) {
    sx += pts[i].x;
    sy += pts[i].y;
  }

  return { x: sx / pts.length, y: sy / pts.length };
}

/* 在球心画一张像素脸（blob 参数保留，方便以后按球体状态改表情） */
function drawPixelEmotion(blob, type, cx, cy) {
  const eye = JELLY.faceEyeSize;
  const gap = JELLY.faceEyeGap;
  const unit = JELLY.faceUnit;
  const mouth = FACE_MOUTH[type] || FACE_MOUTH.calm;

  push();
  translate(cx, cy);
  rectMode(CENTER);
  noStroke();                 // 只画五官，不描任何外轮廓
  fill(0, 0, 0);              // HSB(0,0,0) = 纯黑，压在半透明的彩色球上足够清楚

  // 眼睛：固定尺寸的两个方块
  rect(-gap / 2, JELLY.faceEyeY, eye, eye);
  rect(gap / 2, JELLY.faceEyeY, eye, eye);

  // 嘴巴：按格子单位把像素块摆出来
  for (let i = mouth.length; i--;) {
    const bx = mouth[i][0];
    const by = mouth[i][1];
    rect(bx * unit, JELLY.faceMouthY + by * unit, unit, unit);
  }

  pop();
}
