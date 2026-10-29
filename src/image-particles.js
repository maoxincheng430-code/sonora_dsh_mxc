// 图片粒子：把一张图片采样成点云，用独立 Shader 渲染。
// 思路与成熟方案一致（Image-particle-library / particular-drift）：
//   1. 把图片缩到 ~200px 的画布上，getImageData 采样像素；
//   2. 用 Sobel 算子算边缘，边缘强的像素给更大的粒子（轮廓更清晰）；
//   3. 每个像素生成一个粒子：颜色取原图颜色，z 取亮度做出轻微浮雕；
//   4. Shader 里做「从散点云组装成图片」的动画 + 音频律动 + 主题色微调。
import * as THREE from 'three';

const MAX_SIDE = 200;
const MAX_VIDEO_SIDE = 150;
const MAX_PARTICLES = 26000;

// 纯函数：ImageData 像素 → 点云数据。便于单测（不依赖 DOM）。
// 估计图片背景色：取边框一圈像素的中位数。边框颜色越集中，越可能是纯色背景。
// 返回 null 表示“背景太花，不适合自动扣背景”。
export function estimateBackgroundColor(data, width, height) {
  const samples = [];
  const step = Math.max(1, Math.round((width + height) / 90));
  const push = (x, y) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 200) return;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < width; x += step) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    push(0, y);
    push(width - 1, y);
  }
  if (samples.length < 8) return null;
  const median = (k) => {
    const v = samples.map((s) => s[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] / 255;
  };
  const r = median(0);
  const g = median(1);
  const b = median(2);
  let dev = 0;
  for (const s of samples) dev += Math.abs(s[0] / 255 - r) + Math.abs(s[1] / 255 - g) + Math.abs(s[2] / 255 - b);
  dev /= samples.length * 3;
  if (dev > 0.16) return null;
  return { r, g, b, deviation: dev };
}

const MAX_BORDER_SAMPLES = 240;

/**
 * 从四边泛洪（flood fill）标记背景：
 *  - 只从图片边缘出发，颜色接近边缘色的连通区域才删；
 *  - 相邻像素颜色突变处停止，避免把主体内部吃掉；
 *  - 能处理渐变 / 轻微噪点的背景（全局中位色做不到）。
 * @returns {{mask:Uint8Array, count:number, background:object|null}|null}
 */
export function buildBackgroundMask(data, width, height, tolerance = 0.2) {
  const total = width * height;
  const mask = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const borderColors = [];
  const step = Math.max(1, Math.round((width + height) / 120));
  const collect = (x, y) => {
    const i = y * width + x;
    if (data[i * 4 + 3] < 40) return;
    borderColors.push([data[i * 4] / 255, data[i * 4 + 1] / 255, data[i * 4 + 2] / 255]);
  };
  for (let x = 0; x < width; x += step) {
    collect(x, 0);
    collect(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    collect(0, y);
    collect(width - 1, y);
  }
  if (borderColors.length < 8) return null;
  if (borderColors.length > MAX_BORDER_SAMPLES) {
    const skip = borderColors.length / MAX_BORDER_SAMPLES;
    for (let i = borderColors.length - 1; i >= 0; i -= 1) {
      if (i % Math.ceil(skip) !== 0) borderColors.splice(i, 1);
    }
  }
  const bg = estimateBackgroundColor(data, width, height);
  if (!bg) return null;

  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const color = (i) => [data[i * 4] / 255, data[i * 4 + 1] / 255, data[i * 4 + 2] / 255];
  const nearestBorder = (c) => {
    let best = 1;
    for (const b of borderColors) {
      const d = Math.abs(c[0] - b[0]) + Math.abs(c[1] - b[1]) + Math.abs(c[2] - b[2]);
      if (d < best) best = d;
    }
    return best;
  };
  const enqueue = (i) => {
    if (visited[i]) return;
    visited[i] = 1;
    if (data[i * 4 + 3] < 40) {
      mask[i] = 1;
      queue[tail++] = i;
      return;
    }
    const c = color(i);
    if (nearestBorder(c) <= tolerance) {
      mask[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ];
    for (const n of neighbors) {
      if (n < 0 || visited[n]) continue;
      visited[n] = 1;
      if (data[n * 4 + 3] < 40) {
        mask[n] = 1;
        queue[tail++] = n;
        continue;
      }
      const c = color(n);
      const current = color(i);
      const smooth = Math.abs(c[0] - current[0]) + Math.abs(c[1] - current[1]) + Math.abs(c[2] - current[2]);
      if (nearestBorder(c) <= tolerance && smooth <= tolerance * 1.4) {
        mask[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  let count = 0;
  for (let i = 0; i < total; i += 1) count += mask[i];
  // 背景太小就认为没有可扣的背景（避免把主体当成背景）
  if (count < total * 0.02) return null;
  return { mask, count, background: { ...bg, mode: 'flood' } };
}

export function sampleImageData(data, width, height, options = {}) {
  const {
    maxParticles = MAX_PARTICLES,
    alphaThreshold = 0.18,
    luminanceThreshold = 0.045,
    edgeBoost = 0.85,
    saturation = 1.18,
    density = 1,
    background = 'auto',
    backgroundTolerance = 0.2,
    outlineOnly = false,
    keepLightBackground = true,
  } = options;
  const total = width * height;
  // 透明图：优先用 alpha 当遮罩，别再做颜色扣背景（否则半透明边缘会残留）
  let transparentPixels = 0;
  for (let i = 0; i < total; i += 1) {
    if (data[i * 4 + 3] < 250) transparentPixels += 1;
  }
  const hasAlpha = transparentPixels > total * 0.02;
  let bgMask = background === 'keep' || hasAlpha
    ? null
    : buildBackgroundMask(data, width, height, backgroundTolerance);
  // 浅色（白色/米白）背景默认不扣：白底主体往往也是亮色，硬扣会把头发/衣服一起吃掉
  const estimated = background === 'keep' || hasAlpha ? null : bgMask?.background ?? estimateBackgroundColor(data, width, height);
  let lightSkipped = false;
  if (bgMask && keepLightBackground && estimated) {
    const luminance = 0.2126 * estimated.r + 0.7152 * estimated.g + 0.0722 * estimated.b;
    if (luminance > 0.72) {
      lightSkipped = true;
      bgMask = null;
    }
  }
  // 透明图用 alpha 当遮罩时，不再用背景色二次过滤（否则不透明的主体边缘会被误删）
  const bg = lightSkipped ? null : background === 'keep' || hasAlpha ? null : estimated;
  const bgDistance = 0.11;
  const effectiveAlphaThreshold = hasAlpha ? Math.max(alphaThreshold, 0.3) : alphaThreshold;
  const lum = new Float32Array(total);
  const alpha = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    alpha[i] = data[i * 4 + 3] / 255;
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Sobel 边缘：轮廓上的像素更大、更亮
  const edge = new Float32Array(total);
  const at = (x, y) => lum[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      edge[y * width + x] = Math.min(1, Math.hypot(gx, gy) * 0.42);
    }
  }

  // 收集候选像素（透明度/亮度过滤）
  const candidates = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const a = alpha[i];
      if (a < effectiveAlphaThreshold) continue;
      if (bgMask && bgMask.mask[i]) continue;
      // 只取轮廓：人物内部与背景同色时，直接只用边缘像素生成粒子
      if (outlineOnly && edge[i] < 0.14) continue;
      const l = lum[i] * (0.35 + a * 0.65);
      if (l < luminanceThreshold) continue;
      // 背景抑制：颜色接近背景、且不在轮廓上的像素丢掉
      if (bg) {
        const dr = data[i * 4] / 255 - bg.r;
        const dg = data[i * 4 + 1] / 255 - bg.g;
        const db = data[i * 4 + 2] / 255 - bg.b;
        if (Math.sqrt(dr * dr + dg * dg + db * db) < bgDistance && edge[i] < 0.12) continue;
      }
      candidates.push(i);
    }
  }
  if (candidates.length === 0) {
    return {
      count: 0,
      positions: new Float32Array(0),
      colors: new Float32Array(0),
      sizes: new Float32Array(0),
      seeds: new Float32Array(0),
    };
  }

  // 超量时按确定性 hash 抽稀；边缘像素抽稀概率更低（保留轮廓）
  const budget = Math.max(1, Math.round(maxParticles * Math.max(0.15, density)));
  const keepRatio = Math.min(1, budget / candidates.length);
  const picked = [];
  for (const i of candidates) {
    const e = edge[i];
    const hash = hash01(i * 2654435761);
    const threshold = keepRatio + (1 - keepRatio) * e * 0.65;
    if (hash <= threshold) picked.push(i);
  }
  // 抽稀是概率式的，最后硬裁到预算上限（多出的通常只有个位数）
  if (picked.length > budget) picked.length = budget;

  const count = picked.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const i = picked[k];
    const x = i % width;
    const y = (i - x) / width;
    const e = edge[i];
    const l = lum[i];
    const a = alpha[i];

    positions[k * 3] = (x + 0.5) / width - 0.5;
    positions[k * 3 + 1] = 0.5 - (y + 0.5) / height;
    positions[k * 3 + 2] = l * 0.42 + e * 0.3;

    // 颜色：还原原图色相，略微提饱和；透明度低的像素压暗
    let r = data[i * 4] / 255;
    let g = data[i * 4 + 1] / 255;
    let b = data[i * 4 + 2] / 255;
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = clamp01(gray + (r - gray) * saturation) * (0.55 + a * 0.45);
    g = clamp01(gray + (g - gray) * saturation) * (0.55 + a * 0.45);
    b = clamp01(gray + (b - gray) * saturation) * (0.55 + a * 0.45);
    // sRGB → 线性（ShaderMaterial 直接输出线性色）
    colors[k * 3] = Math.pow(r, 2.2);
    colors[k * 3 + 1] = Math.pow(g, 2.2);
    colors[k * 3 + 2] = Math.pow(b, 2.2);

    sizes[k] = 0.62 + e * edgeBoost + l * 0.28;
    seeds[k] = hash01(i * 97 + 13);
  }

  return {
    count,
    positions,
    colors,
    sizes,
    seeds,
    background: lightSkipped ? { ...estimated, mode: "light-keep" } : bg,
    lightSkipped,
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function hash01(n) {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

// 图片（File / Blob / dataURL / HTMLImageElement）→ 指定最大边长的画布
export async function imageToCanvas(source, maxSide = MAX_SIDE) {
  let bitmap;
  if (typeof source === 'string') {
    bitmap = await loadImageElement(source);
  } else if (typeof createImageBitmap === 'function' && (source instanceof Blob)) {
    bitmap = await createImageBitmap(source);
  } else {
    bitmap = source;
  }
  const sw = bitmap.width || bitmap.naturalWidth || 1;
  const sh = bitmap.height || bitmap.naturalHeight || 1;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas;
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
}

const VERTEX = `
  attribute vec3 aStart;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;

  uniform float uTime;
  uniform float uAssemble;
  uniform float uBass;
  uniform float uTreble;
  uniform float uPulse;
  uniform float uEnergy;
  uniform float uPointScale;
  uniform float uSizeScale;
  uniform vec2 uFit;
  uniform float uOpacity;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;

  float easeInOut(float t) { return t * t * (3.0 - 2.0 * t); }

  void main() {
    float a = easeInOut(clamp(uAssemble, 0.0, 1.0));
    vec3 p = mix(aStart, position, a);
    p.xy *= uFit;
    // 呼吸：轻微起伏 + 低音时整体向镜头方向鼓一下
    p.z += sin(uTime * 0.9 + aSeed * 6.2831) * 0.04;
    p.z *= 1.0 + uBass * 0.35 + uPulse * 0.25;
    p.xy *= 1.0 + uPulse * 0.02;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float size = aSize * uPointScale * (1.0 + uBass * 0.55 + uTreble * 0.25 + uEnergy * 0.2);
    gl_PointSize = clamp(size * uSizeScale / max(0.001, -mv.z), 0.7, 46.0);

    vColor = aColor;
    vSeed = aSeed;
    vAlpha = uOpacity * (0.55 + uTreble * 0.3 + uEnergy * 0.15);
  }
`;

const FRAGMENT = `
  uniform vec3 uGlow;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(0.55, 0.05, d);
    float glow = exp(-d * d * 3.2) * 0.55;
    vec3 col = vColor + uGlow * (0.08 + 0.06 * sin(vSeed * 40.0));
    gl_FragColor = vec4(col, (core * 0.85 + glow) * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class ImageParticles {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.assemble = 0;
    this.target = 0;
    this.canvas = null;
    this.settings = { density: 1, edge: 1, saturation: 1.18, background: 'auto' };
    this.uniforms = {
      uTime: { value: 0 },
      uAssemble: { value: 0 },
      uBass: { value: 0 },
      uTreble: { value: 0 },
      uPulse: { value: 0 },
      uEnergy: { value: 0 },
      uPointScale: { value: 0.04 },
      uSizeScale: { value: 1000 },
      uFit: { value: new THREE.Vector2(1, 1) },
      uOpacity: { value: 0 },
      uGlow: { value: new THREE.Color('#8b75ff') },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: this.uniforms,
    });
    this.geometry = new THREE.BufferGeometry();
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.group = new THREE.Group();
    this.group.add(this.points);
    scene.add(this.group);
    this.gridWidth = 1;
    this.gridHeight = 1;
    this.layout = [1, 1];
  }

  setCanvas(canvas, settings) {
    if (this.videoMode) this.clearVideo();
    this.canvas = canvas;
    if (settings) this.settings = { ...this.settings, ...settings };
    return this.sampleFromCanvas(true);
  }

  setOptions(settings) {
    this.settings = { ...this.settings, ...(settings || {}) };
    if (this.videoMode && this.video) {
      this.sampleVideoFrame();
      return this.count;
    }
    return this.sampleFromCanvas(false);
  }

  sampleFromCanvas(playAssemble) {
    if (!this.canvas) return 0;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    const { data, width, height } = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const settings = this.settings;
    const sampled = sampleImageData(data, width, height, {
      maxParticles: Math.round(MAX_PARTICLES * Math.max(0.2, settings.density ?? 1)),
      edgeBoost: 0.85 * Math.max(0, settings.edge ?? 1),
      saturation: settings.saturation ?? 1.18,
      background: settings.background ?? 'auto',
      backgroundTolerance: settings.backgroundTolerance ?? 0.2,
      outlineOnly: settings.outlineOnly === true,
      keepLightBackground: settings.keepLightBackground !== false,
    });
    this.gridWidth = width;
    this.gridHeight = height;
    this.background = sampled.background ?? null;
    this.build(sampled);
    this.layout = [width, height];
    if (playAssemble) {
      this.assemble = 0;
      this.target = 1;
    } else {
      this.assemble = 1;
      this.target = 1;
    }
    return sampled.count;
  }

  build({ count, positions, colors, sizes, seeds }) {
    this.count = count;
    const starts = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // 从随机球壳飞入，组装动画更有层次
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 3.2 + Math.random() * 3.4;
      starts[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      starts[i * 3 + 1] = Math.cos(phi) * r * 0.75;
      starts[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r * 0.6;
    }
    this.geometry.dispose?.();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aStart', new THREE.BufferAttribute(starts, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.points.geometry = this.geometry;
    this.assemble = 0;
    this.target = 1;
  }

  /**
   * 视频粒子：固定网格采样，每帧只更新颜色/大小/高度，
   * 不再重建 geometry，播放稳定不闪烁。
   */
  setVideo(video, settings) {
    if (!video?.videoWidth || !video?.videoHeight) return 0;
    if (this.video && this.video !== video) this.video.pause();
    if (settings) this.settings = { ...this.settings, ...settings };
    const scale = MAX_VIDEO_SIDE / Math.max(video.videoWidth, video.videoHeight);
    const cols = Math.max(24, Math.round(video.videoWidth * scale));
    const rows = Math.max(24, Math.round(video.videoHeight * scale));
    this.video = video;
    this.videoMode = true;
    this.canvas = null;
    this.videoClock = 0;
    this.gridWidth = cols;
    this.gridHeight = rows;
    this.layout = [cols, rows];

    if (!this.videoCanvas) this.videoCanvas = document.createElement('canvas');
    this.videoCanvas.width = cols;
    this.videoCanvas.height = rows;
    this.videoCtx = this.videoCanvas.getContext('2d', { willReadFrequently: true });

    const count = cols * rows;
    this.count = count;
    const positions = new Float32Array(count * 3);
    const starts = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        positions[i * 3] = (col + 0.5) / cols - 0.5;
        positions[i * 3 + 1] = 0.5 - (row + 0.5) / rows;
        positions[i * 3 + 2] = 0;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 3.2 + Math.random() * 3.4;
        starts[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
        starts[i * 3 + 1] = Math.cos(phi) * r * 0.75;
        starts[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r * 0.6;
        seeds[i] = Math.random();
      }
    }
    this.videoTargets = { colors: new Float32Array(count * 3), sizes: new Float32Array(count), z: new Float32Array(count) };
    this.geometry.dispose?.();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aStart', new THREE.BufferAttribute(starts, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.points.geometry = this.geometry;
    this.assemble = 0;
    this.target = 1;
    this.sampleVideoFrame(true);
    return count;
  }

  clearVideo() {
    if (this.video) {
      try {
        this.video.pause();
      } catch {}
    }
    this.video = null;
    this.videoMode = false;
    this.videoTargets = null;
    this.videoCanvas = null;
    this.videoCtx = null;
  }

  sampleVideoFrame(first = false) {
    const video = this.video;
    if (!video || video.readyState < 2 || !this.videoCtx) return;
    const cols = this.gridWidth;
    const rows = this.gridHeight;
    try {
      this.videoCtx.drawImage(video, 0, 0, cols, rows);
    } catch {
      return;
    }
    const { data } = this.videoCtx.getImageData(0, 0, cols, rows);
    const settings = this.settings;
    const saturation = Number(settings.saturation) || 1.18;
    let bg = null;
    if (settings.background !== 'keep') {
      bg = estimateBackgroundColor(data, cols, rows);
      if (bg) {
        const luminance = 0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b;
        if (luminance > 0.72 && settings.keepLightBackground !== false) bg = null;
      }
    }
    const targets = this.videoTargets;
    const ease = first ? 1 : 0;
    const colorsAttr = this.geometry.attributes.aColor;
    const sizesAttr = this.geometry.attributes.aSize;
    const positionsAttr = this.geometry.attributes.position;
    for (let i = 0; i < cols * rows; i++) {
      const p = i * 4;
      const alpha = data[p + 3] / 255;
      let r = data[p] / 255;
      let g = data[p + 1] / 255;
      let b = data[p + 2] / 255;
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let visible = alpha > 0.16 && gray > 0.035;
      if (bg && visible) {
        const dr = r - bg.r;
        const dg = g - bg.g;
        const db = b - bg.b;
        if (Math.sqrt(dr * dr + dg * dg + db * db) < 0.16) visible = false;
      }
      let tr = 0;
      let tg = 0;
      let tb = 0;
      if (visible) {
        r = Math.min(1, Math.max(0, gray + (r - gray) * saturation));
        g = Math.min(1, Math.max(0, gray + (g - gray) * saturation));
        b = Math.min(1, Math.max(0, gray + (b - gray) * saturation));
        tr = Math.pow(r, 2.2);
        tg = Math.pow(g, 2.2);
        tb = Math.pow(b, 2.2);
      }
      targets.colors[i * 3] = tr;
      targets.colors[i * 3 + 1] = tg;
      targets.colors[i * 3 + 2] = tb;
      targets.sizes[i] = visible ? 0.55 + gray * 0.85 : 0;
      targets.z[i] = visible ? gray * 0.22 : 0;
      if (first) {
        colorsAttr.array[i * 3] = tr;
        colorsAttr.array[i * 3 + 1] = tg;
        colorsAttr.array[i * 3 + 2] = tb;
        sizesAttr.array[i] = targets.sizes[i];
        positionsAttr.array[i * 3 + 2] = targets.z[i];
      }
    }
    if (first) {
      colorsAttr.needsUpdate = true;
      sizesAttr.needsUpdate = true;
      positionsAttr.needsUpdate = true;
    }
  }

  blendVideo(dt) {
    if (!this.videoMode || !this.videoTargets) return;
    const ease = 1 - Math.exp(-dt * 14);
    const colors = this.geometry.attributes.aColor.array;
    const sizes = this.geometry.attributes.aSize.array;
    const positions = this.geometry.attributes.position.array;
    const targets = this.videoTargets;
    for (let i = 0; i < this.count; i++) {
      const ci = i * 3;
      colors[ci] += (targets.colors[ci] - colors[ci]) * ease;
      colors[ci + 1] += (targets.colors[ci + 1] - colors[ci + 1]) * ease;
      colors[ci + 2] += (targets.colors[ci + 2] - colors[ci + 2]) * ease;
      sizes[i] += (targets.sizes[i] - sizes[i]) * ease;
      positions[ci + 2] += (targets.z[i] - positions[ci + 2]) * ease;
    }
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.position.needsUpdate = true;
  }

  // 根据相机可视范围设置图片在世界里的尺寸与粒子大小
  setViewport(camera, viewWidth, viewHeight, pixelHeight) {
    const aspect = (this.gridWidth || 1) / (this.gridHeight || 1);
    const maxW = viewWidth * 0.86;
    const maxH = viewHeight * 0.78;
    let w = maxW;
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    this.layout = [w, h];
    this.uniforms.uFit.value.set(w, h);
    // 一个粒子大约对应一个像素格，略微放大让点连成面
    this.uniforms.uPointScale.value = (w / Math.max(1, this.gridWidth)) * 1.25;
    const fov = THREE.MathUtils.degToRad(camera?.fov || 43);
    this.uniforms.uSizeScale.value = pixelHeight / (2 * Math.tan(fov / 2));
  }

  setActive(active) {
    this.active = Boolean(active);
    this.points.visible = this.active;
    if (this.video) {
      if (this.active) this.video.play().catch(() => {});
      else this.video.pause();
    }
  }

  setTheme(colors) {
    const c = colors?.[2] ?? colors?.[1] ?? colors?.[0];
    if (c) this.uniforms.uGlow.value.copy(c);
  }

  update(dt, features = {}) {
    this.uniforms.uTime.value += dt;
    this.assemble += (this.target - this.assemble) * (1 - Math.exp(-dt * 2.4));
    this.uniforms.uAssemble.value = this.assemble;
    this.uniforms.uBass.value = features.bass ?? 0;
    this.uniforms.uTreble.value = features.treble ?? 0;
    this.uniforms.uPulse.value = features.pulse ?? 0;
    this.uniforms.uEnergy.value = features.energy ?? 0;
    this.uniforms.uOpacity.value = Math.min(1, this.assemble * 1.2);
    if (this.videoMode && this.video) {
      this.videoClock = (this.videoClock ?? 0) + dt;
      if (this.videoClock >= 1 / 12) {
        this.videoClock = 0;
        this.sampleVideoFrame();
      }
      this.blendVideo(dt);
    }
  }

  setRotation(x, y) {
    this.group.rotation.x = x;
    this.group.rotation.y = y;
  }

  dispose() {
    if (this.video) {
      try {
        this.video.pause();
      } catch {}
    }
    this.geometry.dispose?.();
    this.material.dispose();
    this.scene?.remove?.(this.group);
  }
}
