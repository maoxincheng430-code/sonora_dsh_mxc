// 光标光影跟随：独立 2D canvas 层，跟随鼠标/触摸画出一条柔和渐隐的光带。
// 设计要点：统一主题渐变（紫→青）、锥形收尾、外层柔光 + 亮芯、点击涟漪；
// 不依赖 WebGL、不参与音频分析；prefers-reduced-motion 时自动关闭。
//
// 样式来源说明：本项目所有样式均为独立实现；「字符流」「涟漪」等效果的灵感
// 来自公开的光标特效演示（如 ascii-cursor-trail、cursor-ripple 等），仅参考
// 视觉思路，未复制其代码。

export const CURSOR_TRAIL_STYLES = [
  { id: 'comet', label: '彗星拖尾' },
  { id: 'fluid', label: '流体烟墨' },
  { id: 'stars', label: '星尘' },
  { id: 'neon', label: '霓虹' },
  { id: 'ribbon', label: '双丝带' },
  { id: 'pixel', label: '像素方块' },
  { id: 'ascii', label: '字符流' },
  { id: 'ripple', label: '涟漪波纹' },
  { id: 'silk', label: '丝绸弹簧' },
  { id: 'orbit', label: '轨道粒子' },
];

const TRAIL_LIFE = 0.14; // 秒：光带记忆时长（越短越跟手）
const MAX_POINTS = 30;
const SPARK_LIFE = 0.24;
const MAX_SPARKS = 22;
const SPACING = 7; // 每 7px 记一个点，点少一点更利落
const MAX_STEPS = 10; // 单次事件最多补几个点，防止快速划动时堆积
const OVERSHOOT = 0.05; // 轻微过冲，几乎贴着光标走
// 三遍描边：外层柔光 → 中层 → 亮芯，叠出通透的光带质感
const PASSES = [
  { width: 12, alpha: 0.05 },
  { width: 5.5, alpha: 0.13 },
  { width: 2.2, alpha: 0.95 },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function parseHex(hex) {
  const value = String(hex || '#ffffff').replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0];
}

export function createCursorTrail(options = {}) {
  const reduceMotion = options.matchMedia ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (reduceMotion?.matches) return { setColors() {}, setEnabled() {}, isEnabled: () => false, dispose() {} };

  const colors = [...(options.colors ?? ['#8b75ff', '#4dc8ff', '#f5dbff'])];
  const styleIds = new Set(CURSOR_TRAIL_STYLES.map((item) => item.id));
  let style = styleIds.has(options.style) ? options.style : 'comet';
  const life = clamp(Number(options.life) || TRAIL_LIFE, 0.06, 0.4);
  const maxPoints = clamp(Math.round(Number(options.length) || MAX_POINTS), 8, 120);
  const canvas = document.createElement('canvas');
  canvas.className = 'cursor-trail';
  canvas.setAttribute('aria-hidden', 'true');
  (options.host ?? document.body).append(canvas);
  const context = canvas.getContext('2d', { alpha: true });

  let ratio = 1;
  let width = 0;
  let height = 0;
  let disposed = false;
  // 鼠标光影跟随开关：关闭时清空轨迹并停掉 rAF，但保留监听以便随时开启。
  let enabled = options.enabled !== false;
  let lastX = 0;
  let lastY = 0;
  let lastEmitX = 0;
  let lastEmitY = 0;
  let moveSpeed = 0;
  let hasPointer = false;
  let overshootX = 0;
  let overshootY = 0;
  let frame = 0;
  let previousTime = performance.now();
  let lastActivity = 0;

  /** 光带点：{x, y, t} */
  let trail = [];
  /** 点缀星屑 */
  const sparks = [];
  for (let i = 0; i < MAX_SPARKS; i++) {
    sparks.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 1, color: '#ffffff' });
  }
  /** 点击涟漪 */
  const ripples = [];

  function resize() {
    ratio = clamp(globalThis.devicePixelRatio || 1, 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  resize();

  function mixColor(a, b, t) {
    const [r1, g1, b1] = parseHex(a);
    const [r2, g2, b2] = parseHex(b);
    return [
      Math.round(r1 + (r2 - r1) * t),
      Math.round(g1 + (g2 - g1) * t),
      Math.round(b1 + (b2 - b1) * t),
    ];
  }

  function emitSpark(x, y) {
    for (const spark of sparks) {
      if (spark.active) continue;
      const angle = Math.random() * Math.PI * 2;
      spark.active = true;
      spark.x = x + (Math.random() - .5) * 3;
      spark.y = y + (Math.random() - .5) * 3;
      spark.vx = Math.cos(angle) * (8 + Math.random() * 16);
      spark.vy = Math.sin(angle) * (8 + Math.random() * 16) - 6;
      spark.age = 0;
      spark.life = SPARK_LIFE * (.6 + Math.random() * .7);
      spark.size = .9 + Math.random() * 1.5;
      spark.color = colors[2] ?? '#ffffff';
      return;
    }
  }

  function onMove(event) {
    if (!enabled) return;
    wake();
    const x = event.clientX;
    const y = event.clientY;
    if (!hasPointer) {
      hasPointer = true;
      lastX = x;
      lastY = y;
      lastEmitX = x;
      lastEmitY = y;
      trail = [{ x, y, t: performance.now() }];
      return;
    }
    const now = performance.now();
    // 记录带轻微过冲平滑的轨迹点，让高速划动时线条更顺
    const dx = x - lastX;
    const dy = y - lastY;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.6) return;

    overshootX = dx * OVERSHOOT;
    overshootY = dy * OVERSHOOT;
    moveSpeed = distance;
    // 按距离补点：快速划动时也保持光带连续（否则会变成一串断开的珠子）
    const steps = clamp(Math.floor(distance / SPACING), 0, MAX_STEPS);
    for (let step = 1; step <= steps; step++) {
      const ratioAlong = step / (steps + 1);
      trail.push({ x: lastX + dx * ratioAlong + overshootX * ratioAlong, y: lastY + dy * ratioAlong + overshootY * ratioAlong, t: now });
    }
    trail.push({ x: x + overshootX, y: y + overshootY, t: now });
    if (trail.length > maxPoints) trail.splice(0, trail.length - maxPoints);

    // 每隔一段距离点缀一颗小星屑（稀疏一些，避免盖过光带本身）
    const sinceEmit = Math.hypot(x - lastEmitX, y - lastEmitY);
    if (sinceEmit > 90 && Math.random() < 0.4) {
      emitSpark(lastEmitX + (x - lastEmitX) * 0.5, lastEmitY + (y - lastEmitY) * 0.5);
      lastEmitX = x;
      lastEmitY = y;
    }
    lastX = x;
    lastY = y;
  }

  function onTap(event) {
    if (!enabled) return;
    wake();
    ripples.push({ x: event.clientX, y: event.clientY, age: 0, life: 0.55 });
    if (ripples.length > 6) ripples.shift();
    for (let i = 0; i < 10; i++) emitSpark(event.clientX, event.clientY);
  }

  function onLeave() {
    hasPointer = false;
    trail = [];
  }

  // 初始关闭时先把循环收干净（构造里默认是开启的，这里只处理 enabled:false 的情况）。
  if (!enabled) clearAll();

  function drawTrail(now) {
    // 丢弃过期点
    while (trail.length && now - trail[0].t > life * 1000) trail.shift();
    if (trail.length < 2) return;

    const energy = clamp(moveSpeed / 42, 0.22, 1);
    const headPoint = trail[trail.length - 1];
    context.lineCap = 'round';
    context.lineJoin = 'round';

    if (style === 'stars') {
      // 星尘：不画线，只在轨迹上点出大小不一的星点
      for (let i = 0; i < trail.length; i++) {
        const point = trail[i];
        const age = clamp((now - point.t) / (life * 1000), 0, 1);
        const head = 1 - age;
        const along = i / (trail.length - 1);
        const color = mixColor(colors[0], colors[1], along);
        const radius = (0.8 + head * 2.4 + (i % 5 === 0 ? 1.4 : 0)) * (0.8 + energy * 0.5);
        const alpha = Math.pow(head, 2.2) * (0.28 + along * 0.62);
        if (alpha <= 0.01) continue;
        const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 3.4);
        gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha.toFixed(3)})`);
        gradient.addColorStop(0.32, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${(alpha * 0.7).toFixed(3)})`);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(point.x, point.y, radius * 3.4, 0, Math.PI * 2);
        context.fill();
      }
      return;
    }

    if (style === 'fluid') {
      // 流体烟墨：大半径柔光团叠在轨迹上，没有细线
      for (let i = 1; i < trail.length; i++) {
        const point = trail[i];
        const age = clamp((now - point.t) / (life * 1000), 0, 1);
        const head = 1 - age;
        const along = i / (trail.length - 1);
        const color = mixColor(colors[0], colors[2], along);
        const radius = (18 + head * 26 + along * 18) * (0.8 + energy * 0.5);
        const alpha = Math.pow(head, 1.7) * (0.035 + along * 0.05);
        if (alpha <= 0.004) continue;
        const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
        gradient.addColorStop(0, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${(alpha * 1.4).toFixed(3)})`);
        gradient.addColorStop(0.55, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${(alpha * 0.5).toFixed(3)})`);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
      }
      return;
    }

    if (style === 'pixel') {
      // 像素方块：轨迹点吸附到 8px 网格，画成渐隐的小方块
      const size = 7;
      const seen = new Set();
      for (let i = 1; i < trail.length; i++) {
        const point = trail[i];
        const age = clamp((now - point.t) / (life * 1000), 0, 1);
        const head = 1 - age;
        const along = i / (trail.length - 1);
        const color = mixColor(colors[0], colors[1], along);
        const alpha = Math.pow(head, 1.8) * (0.25 + along * 0.7);
        if (alpha <= 0.01) continue;
        const x = Math.round(point.x / size) * size;
        const y = Math.round(point.y / size) * size;
        const key = `${x}:${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const block = size * (0.35 + head * 0.9);
        context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
        context.fillRect(x - block / 2, y - block / 2, block, block);
      }
      return;
    }

    if (style === 'ascii') {
      // 字符流：轨迹点吸附网格，画出渐隐的等宽字符（参考 ascii-cursor-trail 的思路）。
      const glyphs = ['·', ':', '*', '+', '×', '·'];
      const grid = 14;
      const seen = new Set();
      for (let i = 1; i < trail.length; i++) {
        const point = trail[i];
        const age = clamp((now - point.t) / (life * 1000), 0, 1);
        const head = 1 - age;
        const along = i / (trail.length - 1);
        const color = mixColor(colors[0], colors[1], along);
        const alpha = Math.pow(head, 1.9) * (0.3 + along * 0.7);
        if (alpha <= 0.02) continue;
        const x = Math.round(point.x / grid) * grid;
        const y = Math.round(point.y / grid) * grid;
        const key = `${x}:${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const glyph = glyphs[Math.abs(x + y) % glyphs.length];
        context.font = `${Math.round(11 + head * 7)}px "Cascadia Code", Consolas, monospace`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
        context.fillText(glyph, x, y);
      }
      return;
    }

    if (style === 'ripple') {
      // 涟漪波纹：沿轨迹留下一个个向外扩散的细环（参考 cursor-ripple 的思路）。
      for (let i = 1; i < trail.length; i += 3) {
        const point = trail[i];
        const age = clamp((now - point.t) / (life * 1000), 0, 1);
        const head = 1 - age;
        const along = i / (trail.length - 1);
        const color = mixColor(colors[1], colors[2], along);
        // 环随时间外扩、同时变淡
        const radius = 3 + (1 - head) * 20 + head * 4;
        const alpha = Math.pow(head, 1.4) * 0.5;
        if (alpha <= 0.02) continue;
        context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
        context.lineWidth = 0.8 + head * 1.4;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.stroke();
      }
      return;
    }

    if (style === 'silk') {
      // 丝绸弹簧：用一串带滞后的弹簧节点画平滑曲线（SilkCursor 的思路），双色分层。
      const phase = now / 420;
      for (let layer = 0; layer < 2; layer++) {
        const color = parseHex(layer === 0 ? colors[0] : colors[1]);
        context.beginPath();
        for (let i = 0; i < trail.length; i++) {
          const point = trail[i];
          const along = i / (trail.length - 1);
          // 越靠近尾部摆幅越大，形成柔和的 S 形摆动
          const swing = Math.sin(phase + i * 0.32 + layer * Math.PI) * (1 - along) * 9;
          const previous = trail[Math.max(0, i - 1)];
          const next = trail[Math.min(trail.length - 1, i + 1)];
          const dx = next.x - previous.x;
          const dy = next.y - previous.y;
          const length = Math.hypot(dx, dy) || 1;
          const x = point.x + (-dy / length) * swing + layer * 2;
          const y = point.y + (dx / length) * swing + layer * 2;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${(0.34 - layer * 0.12).toFixed(3)})`;
        context.lineWidth = 3.2 - layer * 1.4;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.stroke();
      }
      return;
    }

    if (style === 'orbit') {
      // 轨道粒子：主轨迹两侧各环绕一圈小粒子，按相位旋转。
      const phase = now / 300;
      for (let i = 1; i < trail.length; i++) {
        const point = trail[i];
        const age = clamp((now - point.t) / (life * 1000), 0, 1);
        const head = 1 - age;
        const along = i / (trail.length - 1);
        if (head <= 0.02) continue;
        const previous = trail[i - 1];
        const next = trail[Math.min(trail.length - 1, i + 1)];
        const dx = next.x - previous.x;
        const dy = next.y - previous.y;
        const length = Math.hypot(dx, dy) || 1;
        for (let k = 0; k < 2; k++) {
          const angle = phase + i * 0.45 + k * Math.PI;
          const offset = Math.sin(angle) * (5 + head * 5);
          const color = mixColor(k === 0 ? colors[0] : colors[1], colors[2], along);
          const alpha = Math.pow(head, 1.7) * 0.62;
          const radius = (1.1 + head * 1.8) * (k === 0 ? 1 : 0.75);
          const x = point.x + (-dy / length) * offset + (dx / length) * Math.cos(angle) * 3;
          const y = point.y + (dx / length) * offset + (dy / length) * Math.cos(angle) * 3;
          context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fill();
        }
      }
      return;
    }

    if (style === 'neon') {
      // 霓虹：虚线 + 发光描边
      context.save();
      context.shadowBlur = 14;
      context.setLineDash([9, 7]);
      for (let i = 1; i < trail.length; i++) {
        const previous = trail[i - 1];
        const current = trail[i];
        const age = clamp((now - current.t) / (life * 1000), 0, 1);
        const head = 1 - age;
        const along = i / (trail.length - 1);
        const color = mixColor(colors[0], colors[1], along);
        const alpha = Math.pow(head, 1.6) * (0.4 + along * 0.6);
        if (alpha <= 0.02) continue;
        context.shadowColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.9)`;
        context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
        context.lineWidth = 2.2 * (0.6 + head * 0.8);
        context.beginPath();
        context.moveTo(previous.x, previous.y);
        context.lineTo(current.x, current.y);
        context.stroke();
      }
      context.restore();
    } else if (style === 'ribbon') {
      // 双丝带：沿轨迹法线方向偏移出两条细带
      const phase = now / 240;
      for (let side = -1; side <= 1; side += 2) {
        context.beginPath();
        for (let i = 0; i < trail.length; i++) {
          const point = trail[i];
          const previous = trail[Math.max(0, i - 1)];
          const next = trail[Math.min(trail.length - 1, i + 1)];
          const dx = next.x - previous.x;
          const dy = next.y - previous.y;
          const length = Math.hypot(dx, dy) || 1;
          const offset = side * (3.5 + Math.sin(phase + i * 0.5) * 2.6) + (i / trail.length) * 7 * side;
          const x = point.x + (-dy / length) * offset;
          const y = point.y + (dx / length) * offset;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        const color = parseHex(side < 0 ? colors[1] : colors[2]);
        const alpha = 0.38 * (0.45 + energy * 0.55);
        context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
        context.lineWidth = 1.5;
        context.stroke();
      }
    }

    // 彗星 / 霓虹 / 丝带共用：头尾渐隐的主描边
    if (style !== 'neon' && style !== 'ribbon') {
      for (const pass of PASSES) {
        for (let i = 1; i < trail.length; i++) {
          const previous = trail[i - 1];
          const current = trail[i];
          const age = clamp((now - current.t) / (life * 1000), 0, 1);
          const head = 1 - age;
          const along = i / (trail.length - 1);
          const color = mixColor(colors[0], colors[1], along);
          const alpha = pass.alpha * Math.pow(head, 2.1) * (0.22 + along * 0.78) * (0.55 + energy * 0.65);
          if (alpha <= 0.004) continue;
          context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
          context.lineWidth = pass.width * (0.55 + head * 1.3) * (0.7 + energy * 0.55);
          context.beginPath();
          context.moveTo(previous.x, previous.y);
          context.lineTo(current.x, current.y);
          context.stroke();
        }
      }
    }

    // 头部亮点
    const headRadius = 5 + energy * 3.5;
    const headGradient = context.createRadialGradient(headPoint.x, headPoint.y, 0, headPoint.x, headPoint.y, headRadius);
    headGradient.addColorStop(0, `rgba(255, 255, 255, ${(0.5 + energy * 0.35).toFixed(3)})`);
    headGradient.addColorStop(0.45, `rgba(${parseHex(colors[1]).join(', ')}, ${(0.3 * energy + 0.08).toFixed(3)})`);
    headGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = headGradient;
    context.beginPath();
    context.arc(headPoint.x, headPoint.y, headRadius, 0, Math.PI * 2);
    context.fill();
  }

  function drawSparks(delta) {
    for (const spark of sparks) {
      if (!spark.active) continue;
      spark.age += delta;
      if (spark.age >= spark.life) {
        spark.active = false;
        continue;
      }
      spark.x += spark.vx * delta;
      spark.y += spark.vy * delta;
      spark.vx *= 0.94;
      spark.vy = spark.vy * 0.94 - 10 * delta;
      const progress = spark.age / spark.life;
      const alpha = Math.pow(1 - progress, 2.6) * 0.8;
      const radius = spark.size * (1 - progress * 0.35);
      const color = parseHex(spark.color);
      const gradient = context.createRadialGradient(spark.x, spark.y, 0, spark.x, spark.y, radius * 3.2);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha.toFixed(3)})`);
      gradient.addColorStop(0.3, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${(alpha * 0.75).toFixed(3)})`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(spark.x, spark.y, radius * 3.2, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawRipples(delta) {
    for (let i = ripples.length - 1; i >= 0; i--) {
      const ripple = ripples[i];
      ripple.age += delta;
      const progress = ripple.age / ripple.life;
      if (progress >= 1) {
        ripples.splice(i, 1);
        continue;
      }
      const radius = 8 + progress * 46;
      const alpha = (1 - progress) * 0.55;
      const color = parseHex(colors[1]);
      context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
      context.lineWidth = 1.6 * (1 - progress) + 0.4;
      context.beginPath();
      context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
      context.stroke();
    }
  }

  function wake() {
    if (!enabled) return;
    lastActivity = performance.now();
    if (!frame && !disposed) {
      previousTime = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  // 清空画布与所有活动元素：关闭开关或页面失焦时调用。
  function clearAll() {
    trail = [];
    ripples.length = 0;
    for (const spark of sparks) spark.active = false;
    if (context) context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function tick(now) {
    if (disposed || !enabled) return;
    frame = 0;
    const delta = clamp((now - previousTime) / 1000, 0, 0.05);
    previousTime = now;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.scale(ratio, ratio);
    context.globalCompositeOperation = 'lighter';
    drawTrail(now);
    drawSparks(delta);
    drawRipples(delta);
    context.restore();

    // 全部淡完后停掉循环：没在动的时候一点 rAF 开销都不占
    const idle =
      trail.length < 2 &&
      !sparks.some((spark) => spark.active) &&
      ripples.length === 0;
    if (idle && now - lastActivity > 220) return;
    frame = requestAnimationFrame(tick);
  }
  wake();

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onTap, { passive: true });
  window.addEventListener('pointerleave', onLeave, { passive: true });
  window.addEventListener('blur', onLeave);
  window.addEventListener('resize', resize);

  return {
    setColors(next) {
      if (!Array.isArray(next) || !next.length) return;
      colors.length = 0;
      colors.push(...next);
    },
    /** 开启 / 关闭鼠标光影跟随；关闭时清空画面并停止动画循环，鼠标事件也一并忽略。 */
    setEnabled(next) {
      if (disposed) return;
      const value = Boolean(next);
      if (value === enabled) return;
      enabled = value;
      if (!enabled) {
        cancelAnimationFrame(frame);
        frame = 0;
        hasPointer = false;
        clearAll();
      }
      return enabled;
    },
    setStyle(next) {
      if (!styleIds.has(next) || next === style) return style;
      style = next;
      hasPointer = false;
      clearAll();
      wake();
      return style;
    },
    getStyle: () => style,
    isEnabled: () => enabled,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onTap);
      window.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('resize', resize);
      canvas.remove();
    },
  };
}
