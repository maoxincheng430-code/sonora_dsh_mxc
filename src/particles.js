import * as THREE from 'three';
import { ImageParticles, imageToCanvas } from './image-particles.js';
import { EchoField } from './echo-field.js';

// 三层粒子预算：主线（低频粗波）/ 细纹（中高频波纹）/ 星云（背景散点）
const LAYER_BUDGET = { low: [1200, 1600, 800], medium: [3000, 3600, 1800], high: [5200, 6000, 3000] };

/** 视频文件判断（上传入口用）。 */
export function isVideoFile(file) {
  if (!file) return false;
  const type = String(file.type || '');
  const name = String(file.name || '');
  return /^video\//i.test(type) || /\.(mp4|webm|mov|m4v|ogv|avi)$/i.test(name);
}
const THEMES = {
  cosmic: ['#8b75ff', '#4dc8ff', '#f5dbff'],
  fire: ['#ff4f34', '#ffb347', '#fff2ce'],
  mono: ['#909090', '#d6d6d6', '#ffffff'],
};
// 主题附加的色相偏移（度），用于缓慢色彩联动。
const THEME_HUE = { cosmic: 252, fire: 26, mono: 220 };

/**
 * CSS 颜色 → 色相角度（0~360），供自定义配色的色彩联动使用。
 * 用 THREE.Color 解析，支持 #rgb / #rrggbb / rgb() / hsl()；解析失败回退 252（星际紫）。
 * @param {string} value
 * @returns {number}
 */
function hueOfColor(value) {
  try {
    const color = new THREE.Color(value);
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    return Number.isFinite(hsl.h) ? hsl.h * 360 : 252;
  } catch {
    return 252;
  }
}

const FRAGMENT_UTILS = `
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.b, c.g, K.w, K.z), vec4(c.g, c.b, K.x, K.y), step(c.b, c.g));
    vec4 q = mix(vec4(p.x, p.y, p.w, c.r), vec4(c.r, p.y, p.z, p.x), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z * mix(vec3(1.0), rgb, c.y);
  }
  float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  float noise31(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = dot(i, vec3(127.1, 311.7, 74.7));
    return mix(mix(mix(hash1(n), hash1(n + 1.0), f.x),
                   mix(hash1(n + 113.5), hash1(n + 114.5), f.x), f.y),
               mix(mix(hash1(n + 119.2), hash1(n + 120.2), f.x),
                   mix(hash1(n + 229.1), hash1(n + 230.1), f.x), f.y), f.z);
  }
`;

const VERTEX = `
  attribute float aSeed;
  attribute float aSize;
  attribute float aLayer; // 0 主线 / 1 细纹 / 2 星云
  uniform float uTime;
  uniform float uPhase;      // 波形相位（seek 时平滑回退）
  uniform float uEnergy;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uPulse;
  uniform float uActivity;   // 播放活动度（暂停时衰减）
  uniform float uFill;       // 留白：背景星云填充度
  uniform float uLyricFocus; // 歌词聚拢强度 0..1
  uniform float uMode;       // 0 sphere 1 nebula 2 rings 3 wave
  uniform float uPixelRatio;
  uniform float uWave;
  varying float vSeed;
  varying float vGlow;
  varying float vWY;
  varying float vWX;
  varying float vLayer;
  ${FRAGMENT_UTILS}
  void main() {
    vSeed = aSeed;
    vLayer = aLayer;
    vec3 p = position;
    float moteFade = 1.0;
    float baseAmp = uActivity * (0.15 + uEnergy * 1.15);
    if (uMode > 2.5) {
      // ---- 多层波形：低频粗波（下）+ 中高频细波纹（上）+ 光尘 + 背景星云 ----
      float flow = mod(p.x + uTime * (0.55 + uEnergy * 0.6), 6.8) - 3.4;
      float ampBig = (0.38 + uActivity * (0.8 + uBass * 0.95)) * (0.75 + uEnergy * 0.6);
      float ampFine = (0.05 + uActivity * 0.2) * (0.35 + mix(uMid, uTreble, 0.5) * 2.4);
      float yBig = ampBig * (sin(flow * 0.95 - uPhase * 1.25) * 0.62
                           + sin(flow * 1.55 + uPhase * 0.85) * 0.24
                           + sin(flow * 2.9 - uPhase * 1.9) * 0.08);
      // 副歌卷曲：能量高时粗波轻微扭转
      float curl = uEnergy * 0.4;
      yBig = yBig * (1.0 - curl) + curl * sin(flow * 0.75 + uPhase * 1.2) * ampBig * 0.55;
      float baseY = -0.55;
      // 行进中的高亮波包：宽阔柔和，让光带整体连续、只有缓慢的明暗起伏
      float travel = exp(-pow(fract(flow * 0.4 - uTime * 0.12) * 2.0 - 1.0, 2.0) * 1.5);
      if (aLayer < 0.5) {
        // 第一层：低频粗波，厚实、明亮
        // 注意：分层必须用与 x 解耦的哈希，否则会沿 x 出现一段一段的分块（虚线感）。
        float h = fract(sin(aSeed * 127.1 + 11.7) * 43758.5453);
        float band = fract(h * 7.0);
        float depth = floor(h * 3.0) - 1.0;
        float thick = 0.1 + uBass * 0.3;
        p.x = flow + (fract(h * 37.0) - 0.5) * 0.05;
        p.y = baseY + yBig + (band - 0.5) * thick;
        p.z = depth * 0.45 + (fract(h * 53.0) - 0.5) * 0.2;
      } else if (aLayer < 1.5) {
        // 第二层：中高频细波纹骑在粗波上方；其余是上升光尘。同样用哈希解耦，避免成串成块。
        float detail = mix(uMid, uTreble, 0.6);
        float h = fract(sin(aSeed * 219.7 + 5.3) * 43758.5453);
        float isMote = step(0.55, h);
        if (isMote < 0.5) {
          p.x = flow + (fract(h * 97.0) - 0.5) * 0.24;
          p.y = baseY + 0.3 + yBig * 0.5 + ampFine * sin(flow * 3.4 - uPhase * 2.6 + fract(h * 61.0) * 6.2831);
          p.z = (fract(h * 43.0) - 0.5) * 1.0 - 0.4;
        } else {
          float h2 = fract(sin(aSeed * 311.3 + 9.1) * 43758.5453);
          float rise = fract(h2 + uTime * 0.05);
          p.x = flow + (fract(h * 71.0) - 0.5) * 0.7;
          p.y = baseY + 0.2 + rise * (1.8 + uEnergy * 1.0);
          p.z = (fract(h * 89.0) - 0.5) * 1.8 - 0.7;
          moteFade = (1.0 - rise) * (0.15 + detail * 0.9);
        }
      } else {
        // 第三层：背景星云，重拍时向外炸开
        p.xz *= 1.0 + uPulse * 0.45 * (0.6 + aSeed);
        p.y += uPulse * (0.3 + aSeed * 0.8);
      }
      // 旅行亮包只影响前两层，光带流动时有一段更亮（幅度克制，避免出现虚线感）
      if (aLayer < 1.5) moteFade *= 0.9 + travel * 0.45;
    } else {
      // ---- 中心形态（sphere / nebula / rings）：保留立体，增加活动度与细纹 ----
      float ripple = sin(length(p) * 5.0 - uTime * 2.8 + aSeed * 6.28);
      float burst = uPulse * (1.0 + .22 * sin(6.2831853 * (1.0 - uPulse)));
      p *= (0.7 + 0.3 * uActivity) * (1.0 + uBass * .18 + ripple * uEnergy * .075 + burst * .17);
      float swirlAngle = burst * (.5 + aSeed * .8) * sign(sin(uTime * .11) + .001);
      float sc = cos(swirlAngle);
      float ss = sin(swirlAngle);
      p.xz = mat2(sc, -ss, ss, sc) * p.xz;
      if (aLayer > 0.5 && aLayer < 1.5) {
        // 细纹：形态表面附近的高频颤动
        float detail = mix(uMid, uTreble, 0.5);
        p += vec3(sin(aSeed * 37.0 + uTime * (1.4 + uMid * 2.6)),
                  cos(aSeed * 29.0 + uTime * (1.2 + uMid * 2.1)),
                  sin(aSeed * 43.0 + uTime * (1.7 + uMid * 2.8))) * detail * 0.16;
      }
      vec3 warpPos = p * .75 + vec3(0., 0., uTime * .3);
      p += (vec3(noise31(warpPos), noise31(warpPos + 17.31), noise31(warpPos + 39.77)) - .5) * uBass * .45 * uActivity;
      if (aLayer > 1.5) {
        float rr = length(p.xz);
        p.xz *= 1.0 + uPulse * 0.5 * (0.6 + aSeed);
      }
    }
    // 歌词聚拢：当前演唱分句时，中央光带粒子向上聚成一团光晕（贴着歌词下方）。
    if (uLyricFocus > 0.001 && uMode > 2.5) {
      float dist = abs(p.x);
      float pull = uLyricFocus * smoothstep(1.0, 0.0, dist);
      p.x *= 1.0 - pull * 0.55;
      p.y += (0.55 - p.y) * pull * (aLayer < 1.5 ? 0.6 : 0.25);
      p.z += pull * (fract(aSeed * 31.0) - 0.5) * 0.5;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vWY = p.y;
    vWX = p.x;
    // 差异化：主线厚实明亮，细纹中等，星云小而暗；音量高时轻微拉开
    float layerScale = aLayer < 0.5 ? 1.15 : (aLayer < 1.5 ? 0.85 : 0.45);
    float sizeSpread = 1.0 + uEnergy * (aLayer < 1.5 ? 0.5 : 0.2);
    float flicker = 1.0 + uTreble * .55 * sin(uTime * (7.0 + aSeed * 9.0) + aSeed * 80.0);
    // 上限 ~14px：有存在感但不会糊成光斑
    gl_PointSize = clamp(aSize * layerScale * sizeSpread * uPixelRatio * (26.0 / -mv.z) * max(.5, flicker), 1.2, 14.0);
    float baseGlow = aLayer < 0.5 ? 1.25 : (aLayer < 1.5 ? 0.9 : 0.32);
    vGlow = clamp(baseGlow + .16 * sin(aSeed * 80.0 + uTime * .65) + uTreble * .35 * (0.5 + 0.5 * sin(uTime * 6.0 + aSeed * 51.0)) + uPulse * .45 * (aLayer > 1.5 ? 1.0 : .22), .1, 1.5) * moteFade;
  }
`;

const FRAGMENT = `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uEnergy;
  uniform float uPulse;
  uniform float uHue;
  uniform float uLyricFocus;
  uniform float uLyricDim;
  uniform float uFill;
  varying float vSeed;
  varying float vGlow;
  varying float vWY;
  varying float vWX;
  varying float vLayer;
  ${FRAGMENT_UTILS}
  void main() {
    float d = length(gl_PointCoord - .5) * 2.0;
    if (d > 1.0) discard;
    // 更锐利的芯 + 层相关的柔和光晕：主线带一层薄雾光晕，整体通透不糊
    float haloExp = vLayer < 0.5 ? 5.5 : (vLayer < 1.5 ? 7.5 : 10.0);
    float haloAmp = vLayer < 0.5 ? 0.5 : (vLayer < 1.5 ? 0.34 : 0.26);
    float halo = exp(-d * d * haloExp) * haloAmp;
    float core = exp(-d * d * 80.0) * 1.0;
    // 主色沿 x 由紫到青渐变，粒子自身只做轻微差异——整体配色更统一、有设计感
    float ramp = smoothstep(-3.2, 3.2, vWX);
    vec3 color = mix(uColorA, uColorB, ramp * 0.8 + vSeed * 0.2);
    color = mix(color, uColorC, pow(vSeed, 20.0) * 0.45);
    // 层色调：细纹偏青
    color = mix(color, uColorB, smoothstep(0.5, 1.5, vLayer) * 0.3);
    // 能量色温 + 缓慢色相联动（低频偏紫，人声偏青）
    float warmth = clamp(uEnergy * .4 + min(uPulse, 1.) * .25, 0., .6);
    color = mix(color, uColorC, warmth * .14);
    color = mix(color, uColorC, clamp(uPulse * .22, 0.0, .3));
    // uHue 是已归一化的小幅偏移（约 ±0.02），只做轻微冷暖漂移
    color = hsv2rgb(vec3(rgb2hsv(color).x + uHue, rgb2hsv(color).y, rgb2hsv(color).z));
    // 歌词聚拢区增亮
    float focusGlow = 1.0 + uLyricFocus * 0.7 * smoothstep(1.0, 0.0, abs(vWY - 0.55));
    // 可读性：歌词文字带内粒子自动降亮
    float lyricMask = exp(-((vWY - 0.55) * (vWY - 0.55)) / 0.75);
    float readable = 1.0 - uLyricDim * lyricMask * smoothstep(0.0, 1.0, uEnergy * 0.5 + 0.5);
    // 留白：星云层填充度，安静时极暗
    float fillFactor = vLayer > 1.5 ? (0.3 + uFill * 0.7) : 1.0;
    float alpha = (halo + core) * vGlow * (.75 + uEnergy * .3 + min(uPulse, 1.25) * .3) * fillFactor * readable * focusGlow;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createLayerPositions(type, layer, count, budget) {
  // type 0 sphere / 1 nebula / 2 rings / 3 wave
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = (i + .5) / count;
    const a = i * 2.399963229728653;
    const random = Math.sin(i * 127.1 + 43.7) * 43758.5453;
    const noise = random - Math.floor(random);
    let x, y, z;
    if (type === 3) {
      // wave：主线沿 x 排布，细纹围绕主线，星云作为远景散点（压在后方）
      if (layer === 0) {
        x = (t - .5) * 6.4;
        y = 0;
        z = (noise - .5) * .3;
      } else if (layer === 1) {
        x = (t - .5) * 6.4;
        y = (noise - .5) * 1.2;
        z = (noise - .5) * 1.0;
      } else {
        // 远景星云：横向铺满、纵向略宽，z 推到后方形成景深
        const theta = noise * Math.PI * 2;
        const r = Math.sqrt(noise);
        x = (r * Math.cos(theta) - .5) * 11;
        y = (r * Math.sin(theta) - .5) * 6 + .8;
        z = -3.5 - noise * 5.5;
      }
    } else if (type === 1) {
      const radius = .18 + Math.sqrt(t) * 2.85;
      const angle = (i % 4) * Math.PI * .5 + radius * 1.7 + (noise - .5) * .42;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius * .65;
      y = (noise - .5) * (1.2 - t * .8) + Math.sin(angle * 2 + radius) * .25;
      if (layer === 0) { x *= 1.08; y *= 1.08; z *= 1.08; }
      if (layer === 2) { x *= .6; y *= .6; z *= .6; }
    } else if (type === 2) {
      const band = i % 3;
      const radius = 1.35 + band * .62 + (noise - .5) * .14;
      const px = Math.cos(a) * radius;
      const py = Math.sin(a) * radius;
      const tilt = -.65 + band * .65;
      x = px;
      y = py * Math.cos(tilt) * .75;
      z = py * Math.sin(tilt) + (noise - .5) * .12;
      if (layer === 2) { x *= .55; y *= .55; z *= .55; }
    } else {
      const yy = 1 - t * 2;
      const radius = Math.sqrt(1 - yy * yy);
      const shell = i % 7 === 0 ? .5 + noise * .48 : .96 + noise * .045;
      x = Math.cos(a) * radius * 2.35 * shell;
      y = yy * 2.35 * shell;
      z = Math.sin(a) * radius * 2.35 * shell;
      if (layer === 0) { const s = 1.04 + noise * .05; x *= s; y *= s; z *= s; }
      if (layer === 2) { const s = .55 + noise * .15; x *= s; y *= s; z *= s; }
    }
    array[i * 3] = x;
    array[i * 3 + 1] = y;
    array[i * 3 + 2] = z;
  }
  return array;
}

const MODE_OF = { sphere: 0, nebula: 1, rings: 2, wave: 3 };

export class ParticleScene {
  constructor(container) {
    this.container = container;
    this.disposed = false;
    this.enabled = true; // 粒子特效总开关：关闭时跳过逐帧更新与渲染，重新打开后继续
    this.type = 'wave'; // 默认改成多层波形
    this.hasShapeImage = false;
    this.hasShapeVideo = false;
    this.shapeVideoUrl = '';
    this.imageParticles = null;
    this.echoField = null;
    this.shapeOptions = { density: 1, edge: 1, saturation: 1.18, background: 'auto', backgroundTolerance: 0.2, outlineOnly: false, keepLightBackground: true };
    this.viewport = { width: 1, height: 1, pixelHeight: 1 };
    this.viewOffset = { x: 0, y: 0 };
    this.theme = 'cosmic';
    this.quality = 'medium';
    this.sensitivity = 1;
    this.time = 0;
    this.energy = 0;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.punch = 0;
    this.lastBeat = 0;
    this.activity = 0;
    this.wavePhase = 0;
    this.baseFov = 43;
    this.baseZ = 9.6;
    this.bandGains = { bass: 1, mid: 1, treble: 1 };
    this.lyricFocus = 0;
    this.lyricDim = 0;
    this.targetHue = THEME_HUE[this.theme] ?? 252;
    this.hue = 0;
    this.shakeAmp = 0;
    this.drag = { active: false, lastX: 0, lastY: 0, vx: 0, vy: 0, manualY: 0, manualX: 0 };
    this.targetColors = THEMES.cosmic.map(color => new THREE.Color(color));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.1, 80);
    this.baseY = .12;
    this.applyViewOffset();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x070910, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
    container.appendChild(this.renderer.domElement);
    const motionQuery = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.motionQuery = motionQuery;
    this.reducedMotion = Boolean(motionQuery?.matches);
    this.onMotionChange = event => { this.reducedMotion = Boolean(event?.matches); };
    motionQuery?.addEventListener?.('change', this.onMotionChange);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uPhase: { value: 0 }, uActivity: { value: 0 }, uFill: { value: 0 },
        uEnergy: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
        uPulse: { value: 0 }, uWave: { value: 0 }, uMode: { value: 3 },
        uLyricFocus: { value: 0 }, uLyricDim: { value: 0 }, uHue: { value: 0 },
        uPixelRatio: { value: 1 },
        uColorA: { value: new THREE.Color(THEMES.cosmic[0]) },
        uColorB: { value: new THREE.Color(THEMES.cosmic[1]) },
        uColorC: { value: new THREE.Color(THEMES.cosmic[2]) },
      },
    });
    this.buildParticles();
    this.coreMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color('#b9b6ff') }, uOpacity: { value: .55 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uOpacity;
        void main(){float d=length(vUv-.5)*2.;float a=exp(-d*d*9.)*.23+exp(-d*d*70.)*.8;
        gl_FragColor=vec4(uColor,a*uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    });
    this.core = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), this.coreMaterial);
    this.core.visible = this.type !== 'wave';
    this.scene.add(this.core);
    this.attachDrag();
    this.resize();
  }

  // 每个图层一个 Points，共用同一 Material（靠 aLayer 区分）与 Morph 逻辑。
  // 三个 Points 常驻（首次创建），重建/切形态只替换 attribute 数据，
  // 保证 renderer geometry 数恒定（避免 e2e 资源泄漏断言误报）。
  buildParticles() {
    const budgets = LAYER_BUDGET[this.quality];
    this.count = budgets.reduce((a, b) => a + b, 0);
    const type = MODE_OF[this.type] ?? 3;
    if (!this.layers) this.layers = [];
    let offset = 0;
    for (let layer = 0; layer < 3; layer++) {
      const layerCount = budgets[layer];
      const geometry = this.layers[layer]?.geometry ?? (() => {
        const g = new THREE.BufferGeometry();
        const points = new THREE.Points(g, this.material);
        points.frustumCulled = false;
        this.group.add(points);
        this.layers[layer] = points;
        return g;
      })();
      const positions = createLayerPositions(type, layer, layerCount, budgets);
      const seeds = new Float32Array(layerCount);
      const sizes = new Float32Array(layerCount);
      const layerAttr = new Float32Array(layerCount);
      for (let i = 0; i < layerCount; i++) {
        seeds[i] = ((i + offset * 7919) % 997) / 997;
        sizes[i] = .5 + seeds[i] * 1.1 + (i % 61 === 0 ? 1.6 : 0);
        layerAttr[i] = layer;
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
      geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      geometry.setAttribute('aLayer', new THREE.BufferAttribute(layerAttr, 1));
      offset += layerCount;
    }
    this.layers.length = 3;
    this.morphing = false;
    this.positions = this.layers[0].geometry.attributes.position;
  }

  createShape(id) {
    // 兼容旧测试：返回单层主形状位置（wave 主线 / 其余形态主壳）。
    const type = MODE_OF[id];
    const count = this.count ? Math.min(this.count, 600) : 600;
    if (type === undefined) return createLayerPositions(0, 0, count, [count, 0, 0]);
    return createLayerPositions(type, 0, count, this.count ? LAYER_BUDGET[this.quality] : [count, 0, 0]);
  }

  setType(id) {
    // 图片形态需要先上传图片；没有图片时忽略
    if (id === 'image') {
      if (!this.hasShapeImage || !this.imageParticles) return;
    }
    const type = ['sphere', 'nebula', 'rings', 'wave', 'image', 'echo'].includes(id) ? id : 'wave';
    if (this.type === type) return;
    this.type = type;
    if (type === 'image') {
      this.group.visible = false;
      if (this.core) this.core.visible = false;
      this.imageParticles?.setActive(true);
      this.echoField?.setActive(false);
      return;
    }
    if (type === 'echo') {
      this.group.visible = true;
      if (this.core) this.core.visible = false;
      for (const points of this.layers ?? []) points.visible = false;
      this.imageParticles?.setActive(false);
      if (!this.echoField) {
        this.echoField = new EchoField(this.group);
        this.echoField.setColors(this.targetColors);
      }
      this.echoField.setActive(true);
      return;
    }
    this.group.visible = true;
    for (const points of this.layers ?? []) points.visible = true;
    this.echoField?.setActive(false);
    if (this.material?.uniforms?.uMode) this.material.uniforms.uMode.value = MODE_OF[type];
    if (this.core) this.core.visible = type !== 'wave';
    this.imageParticles?.setActive(false);
    this.rebuildPositions();
  }

  // 上传/更换图片（File / Blob / dataURL 均可），成功后返回采样到的粒子数
  async setShapeImage(source, settings) {
    this.clearShapeVideo();
    const canvas = await imageToCanvas(source, 200);
    if (this.disposed) return 0;
    if (!this.imageParticles) this.imageParticles = new ImageParticles(this.scene);
    if (settings) this.shapeOptions = { ...this.shapeOptions, ...settings };
    const count = this.imageParticles.setCanvas(canvas, this.shapeOptions);
    this.imageParticles.setTheme(this.targetColors);
    this.imageParticles.setViewport(
      this.camera,
      this.viewport.width,
      this.viewport.height,
      this.viewport.pixelHeight,
    );
    this.hasShapeImage = count > 0;
    return count;
  }

  // 调整图片粒子参数（密度 / 轮廓强度 / 饱和 / 是否自动扣背景），立即重新采样
  setShapeOptions(settings) {
    this.shapeOptions = { ...this.shapeOptions, ...(settings || {}) };
    return this.imageParticles?.setOptions(this.shapeOptions) ?? 0;
  }

  /** 视频粒子：循环播放视频，按固定网格逐帧采样（颜色 / 大小 / 高度平滑过渡）。 */
  async setShapeVideo(source, settings) {
    if (!source) return 0;
    this.clearShapeVideo();
    const url = URL.createObjectURL(source);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    try {
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(new Error('视频解码失败'));
        video.load();
      });
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    if (this.disposed) {
      URL.revokeObjectURL(url);
      return 0;
    }
    try {
      await video.play();
    } catch {
      // 自动播放被拦时不阻塞粒子生成
    }
    if (!this.imageParticles) this.imageParticles = new ImageParticles(this.scene);
    if (settings) this.shapeOptions = { ...this.shapeOptions, ...settings };
    const count = this.imageParticles.setVideo(video, this.shapeOptions);
    this.imageParticles.setTheme(this.targetColors);
    this.imageParticles.setViewport(
      this.camera,
      this.viewport.width,
      this.viewport.height,
      this.viewport.pixelHeight,
    );
    this.shapeVideoUrl = url;
    this.hasShapeVideo = count > 0;
    this.hasShapeImage = count > 0;
    return count;
  }

  clearShapeVideo() {
    this.imageParticles?.clearVideo?.();
    if (this.shapeVideoUrl) {
      try {
        URL.revokeObjectURL(this.shapeVideoUrl);
      } catch {}
      this.shapeVideoUrl = '';
    }
    this.hasShapeVideo = false;
  }

  clearShapeImage() {
    this.clearShapeVideo();
    this.hasShapeImage = false;
    this.imageParticles?.setActive(false);
    if (this.type === 'image') this.setType('wave');
  }

  rebuildPositions() {
    const type = MODE_OF[this.type] ?? 3;
    if (!this.layers?.length) return;
    const budgets = LAYER_BUDGET[this.quality];
    let offset = 0;
    this.layers.forEach((points, layer) => {
      const count = budgets[layer];
      const positions = createLayerPositions(type, layer, count, budgets);
      points.geometry.attributes.position.array.set(positions);
      points.geometry.attributes.position.needsUpdate = true;
      offset += count;
    });
    this.morphing = true;
    this.morphAge = 0;
  }

  setTheme(id) {
    this.theme = Object.hasOwn(THEMES, id) ? id : 'cosmic';
    const colors = THEMES[this.theme];
    for (let i = 0; i < 3; i++) this.targetColors[i].set(colors[i]);
    this.targetHue = THEME_HUE[this.theme] ?? 252;
    this.imageParticles?.setTheme(this.targetColors);
    this.echoField?.setColors(this.targetColors);
  }

  /**
   * 直接用一组颜色覆盖粒子配色（自定义调色盘用），不再受 THEMES 预设限制。
   * 传入非法值或空数组时忽略，保持当前配色。
   * @param {string[]} colors 3 个 CSS 颜色（不足会用首色补齐）
   */
  setColors(colors) {
    if (!Array.isArray(colors) || colors.length === 0) return;
    for (let i = 0; i < 3; i++) {
      const value = colors[i] ?? colors[0];
      this.targetColors[i].set(value);
    }
    // 色相联动基准跟着主色走，避免自定义色下仍按旧主题色相偏移。
    this.targetHue = hueOfColor(colors[0]);
    this.imageParticles?.setTheme(this.targetColors);
    this.echoField?.setColors(this.targetColors);
  }

  /** 粒子画面整体位置：center / up / down / left / right（移动相机，不动粒子数据）。 */
  /** 屏幕方向的画面偏移：x 右正 / y 上正；通过反向移动相机实现。 */
  setViewOffset(x = 0, y = 0) {
    this.viewOffset = { x: Number(x) || 0, y: Number(y) || 0 };
    this.applyViewOffset();
    return this.viewOffset;
  }

  applyViewOffset() {
    if (!this.camera) return;
    const x = this.viewOffset?.x ?? 0;
    const y = this.viewOffset?.y ?? 0;
    // 相机向右移会让画面左移，向上移会让画面下移，所以取反
    this.camera.position.set(-x, (this.baseY ?? 0.12) - y, this.baseZ);
  }

  setSensitivity(value) {
    this.sensitivity = Number.isFinite(Number(value)) ? THREE.MathUtils.clamp(Number(value), 0, 3) : 1;
  }

  setBandGains(gains = {}) {
    const clamp = v => THREE.MathUtils.clamp(Number.isFinite(Number(v)) ? Number(v) : 1, 0, 3);
    this.bandGains = { bass: clamp(gains.bass), mid: clamp(gains.mid), treble: clamp(gains.treble) };
  }

  setLyricFocus(progress, active) {
    this.lyricFocus = THREE.MathUtils.clamp(active ? Number(progress) || 0 : 0, 0, 1);
  }

  // 粒子特效总开关：关闭时 update() 直接返回（不再渲染、不再推进动画），
  // 由 Lead 同时隐藏 #scene 容器；重新开启后从当前状态继续。
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.renderer?.domElement) this.renderer.domElement.style.visibility = this.enabled ? '' : 'hidden';
    return this.enabled;
  }

  setQuality(id) {
    const quality = Object.hasOwn(LAYER_BUDGET, id) ? id : 'medium';
    if (quality === this.quality) return;
    this.quality = quality;
    this.buildParticles();
    this.resize();
  }

  attachDrag() {
    const element = this.renderer.domElement;
    const onDown = event => {
      if (this.type === 'wave') return; // 波形模式不拖拽旋转
      this.drag.active = true;
      this.drag.lastX = event.clientX;
      this.drag.lastY = event.clientY;
      this.drag.vx = 0;
      this.drag.vy = 0;
      element.setPointerCapture?.(event.pointerId);
    };
    const onMove = event => {
      if (!this.drag.active) return;
      const dx = event.clientX - this.drag.lastX;
      const dy = event.clientY - this.drag.lastY;
      this.drag.lastX = event.clientX;
      this.drag.lastY = event.clientY;
      this.drag.manualY += dx * .005;
      this.drag.manualX = THREE.MathUtils.clamp(this.drag.manualX + dy * .003, -1.2, 1.2);
      this.drag.vx = dx * .005;
      this.drag.vy = dy * .003;
    };
    const onUp = event => {
      if (!this.drag.active) return;
      this.drag.active = false;
      element.releasePointerCapture?.(event.pointerId);
    };
    this.dragHandlers = { onDown, onMove, onUp };
    element.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  update(dt, features = {}, playing = false) {
    // enabled 未显式初始化时（如测试用原型对象）视为开启。
    if (this.disposed || this.enabled === false) return;
    const delta = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, .08) : 0;
    this.time = (this.time ?? 0) + delta;
    const ease = 1 - Math.exp(-delta * 5);
    const volume = Number.isFinite(features.volume) ? features.volume : 0;
    const rawBass = Number.isFinite(features.bass) ? features.bass : 0;
    const rawMid = Number.isFinite(features.mid) ? features.mid : 0;
    const rawTreble = Number.isFinite(features.treble) ? features.treble : 0;
    const sense = Number.isFinite(this.sensitivity) ? THREE.MathUtils.clamp(this.sensitivity, 0, 3) : 1;
    const active = playing ? sense : 0;
    const gains = this.bandGains ?? { bass: 1, mid: 1, treble: 1 };
    this.energy += (Math.min(2, Math.max(0, volume) * active) - (this.energy ?? 0)) * ease;
    this.bass += (Math.min(2, Math.max(0, rawBass * gains.bass) * active) - (this.bass ?? 0)) * ease;
    this.mid += (Math.min(2, Math.max(0, rawMid * gains.mid) * active) - (this.mid ?? 0)) * ease;
    this.treble += (Math.min(2, Math.max(0, rawTreble * gains.treble) * active) - (this.treble ?? 0)) * ease;

    // 暂停缓冲：activity 慢速回落 → 波慢慢摊平、粒子缓停（不硬切）
    this.activity += ((playing ? 1 : 0) - (this.activity ?? 0)) * (1 - Math.exp(-delta * (playing ? 4 : 1.1)));
    // 波形相位平滑回退：seek 后目标相位突变，当前相位以 8/s 速率追过去
    const timeNow = Number.isFinite(features.time) ? features.time : this.time;
    const targetPhase = playing ? timeNow : this.time;
    this.wavePhase += (targetPhase - (this.wavePhase ?? 0)) * (1 - Math.exp(-delta * 8));

    const beat = playing && Number.isFinite(Number(features.beat)) ? THREE.MathUtils.clamp(Number(features.beat), 0, 1) : 0;
    // 节拍网格（离线分析/缓存）：精确拍点，避免频段起音漏拍或拖拍
    const gridImpact = playing && Number.isFinite(Number(features.beatImpact))
      ? THREE.MathUtils.clamp(Number(features.beatImpact), 0, 1)
      : 0;
    const gridDownbeat = playing && Number.isFinite(Number(features.downbeatImpact))
      ? THREE.MathUtils.clamp(Number(features.downbeatImpact), 0, 1)
      : 0;
    const lastBeat = Number.isFinite(this.lastBeat) ? this.lastBeat : 0;
    const onset = beat > .18 && (lastBeat <= .18 || beat - lastBeat > .12);
    this.punch = Math.max(0, (this.punch ?? 0) * Math.exp(-delta * 6.5));
    if (onset) this.punch = 1;
    // 网格拍点直接打一次 punch（重拍更强），与频段起音取较大值
    if (gridImpact > .86) this.punch = Math.max(this.punch, .7 + .3 * gridDownbeat);
    this.lastBeat = beat;
    const kick = Math.max(
      this.punch * (.5 + sense * .5),
      gridImpact * (.55 + .45 * gridDownbeat) * (.7 + .3 * sense),
    );

    // 留白：fill 跟随能量，安静时星云几乎熄灭
    const fillTarget = this.energy * .75 + kick * .3;
    this.fill = ((this.fill ?? 0) + (fillTarget - (this.fill ?? 0)) * (1 - Math.exp(-delta * 4)));
    // 歌词降亮随歌词激活渐进
    this.lyricDim += ((this.lyricFocus > .05 ? 1 : 0) - (this.lyricDim ?? 0)) * (1 - Math.exp(-delta * 3));
    // 缓慢色相联动：低频偏紫、人声偏青，幅度很小（±0.02 圈，约 ±7°），慢速过渡
    const hueTarget = ((-this.bass * 26 + this.mid * 18) / 360) * 0.45;
    this.hue = ((this.hue ?? 0) + (hueTarget - (this.hue ?? 0)) * (1 - Math.exp(-delta * 1.2)));

    const uniforms = this.material.uniforms;
    const colorEase = 1 - Math.exp(-delta * 4);
    uniforms.uColorA.value.lerp(this.targetColors[0], colorEase);
    uniforms.uColorB.value.lerp(this.targetColors[1], colorEase);
    uniforms.uColorC.value.lerp(this.targetColors[2], colorEase);
    this.coreMaterial.uniforms.uColor.value.lerp(this.targetColors[1], colorEase);
    uniforms.uTime.value = this.time;
    uniforms.uPhase.value = this.wavePhase ?? 0;
    uniforms.uEnergy.value = this.energy;
    uniforms.uBass.value = this.bass;
    uniforms.uMid.value = this.mid;
    uniforms.uTreble.value = this.treble;
    uniforms.uPulse.value = kick;
    uniforms.uActivity.value = this.activity ?? 0;
    uniforms.uFill.value = this.fill ?? 0;
    uniforms.uLyricFocus.value = this.lyricFocus ?? 0;
    uniforms.uLyricDim.value = this.lyricDim ?? 0;
    uniforms.uHue.value = (this.hue ?? 0);

    // 拖拽旋转（非波形模式）+ 惯性
    const drag = this.drag ?? { active: true, manualY: 0, manualX: 0, vx: 0, vy: 0 };
    if (this.type !== 'wave') {
      if (!drag.active) {
        drag.manualY += (drag.vx ?? 0) * 0.96;
        drag.manualX = THREE.MathUtils.clamp((drag.manualX ?? 0) + (drag.vy ?? 0) * 0.96, -1.2, 1.2);
        drag.vx *= .97;
        drag.vy *= .97;
      }
      this.group.rotation.y = drag.manualY + this.time * .055 + Math.sin(this.time * .07) * .08;
      this.group.rotation.x = drag.manualX + Math.sin(this.time * .1) * .06 + kick * .05;
      this.group.rotation.z = Math.sin(this.time * .09) * .05 + kick * .06;
      this.group.position.x = Math.sin(this.time * .19) * .035;
      this.group.position.y = Math.sin(this.time * .27) * .04 + this.bass * .03;
    } else {
      // 波形模式：保持极轻微整体摆动
      this.group.rotation.y = Math.sin(this.time * .05) * .02;
      this.group.rotation.x = Math.sin(this.time * .07) * .01;
    }
    this.group.scale.setScalar(1 + this.bass * .03 + kick * .04);
    this.core.scale.setScalar(.9 + this.bass * .18 + kick * .34 + Math.sin(this.time * .7) * .025);
    this.coreMaterial.uniforms.uOpacity.value = Math.min(1.1, .38 + this.energy * .34 + kick * .3 * this.activity);

    // 音域回响：顶点位移 + 网格线 + 背光，全部吃音频特征
    if (this.type === 'echo' && this.echoField) {
      this.echoField.update(delta, {
        bass: this.bass,
        mid: this.mid,
        treble: this.treble,
        beat: kick,
        energy: this.energy,
      });
    }

    // 图片形态：点云有自己的 shader，吃同一份音频特征
    if (this.type === 'image' && this.imageParticles) {
      this.imageParticles.update(delta, {
        bass: this.bass,
        treble: this.treble,
        pulse: kick,
        energy: this.energy,
      });
      this.imageParticles.setRotation(
        drag.manualX * .5 + Math.sin(this.time * .1) * .03,
        drag.manualY * .7 + Math.sin(this.time * .08) * .04,
      );
    }

    // 镜头：轻推 + 震动（屏幕随声音震动）
    if (this.camera) {
      const motion = this.reducedMotion ? .3 : 1;
      const fov = (this.baseFov ?? 43) + Math.min(5, kick * 3.2 * motion);
      if (Math.abs(fov - this.camera.fov) > 1e-4) {
        this.camera.fov = fov;
        if (typeof this.camera.updateProjectionMatrix === 'function') this.camera.updateProjectionMatrix();
      }
    }
    // 星星层的 shake 幅度
    this.shakeAmp = Math.min(1.6, (this.shakeAmp ?? 0) + (this.bass * .4 + kick * .5) * (1 - Math.exp(-delta * 8)));
    this.shakeAmp *= Math.exp(-delta * 3.4);
    if (this.renderer?.domElement && this.shakeAmp > .004 && !this.reducedMotion) {
      const sx = (Math.random() * 2 - 1) * this.shakeAmp * 2.2;
      const sy = (Math.random() * 2 - 1) * this.shakeAmp * 1.8;
      this.renderer.domElement.style.transform = `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px)`;
    } else if (this.renderer?.domElement) {
      this.renderer.domElement.style.transform = '';
    }

    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const ratio = Math.min(globalThis.devicePixelRatio || 1, this.quality === 'low' ? 1.25 : 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.baseZ = this.camera.aspect < 1 ? 9.6 / Math.max(.55, this.camera.aspect) : 9.6;
    this.baseY = .12 * THREE.MathUtils.clamp(9.6 / this.baseZ, 1, 1.8);
    this.camera.position.set(0, this.baseY, this.baseZ);
    this.camera.fov = this.baseFov ?? 43;
    this.camera.updateProjectionMatrix();
    this.material.uniforms.uPixelRatio.value = ratio;
    // 图片平面的可视范围（z = 0 平面），用于把图片塞进画面
    const dist = this.camera.position.z;
    const viewHeight = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    this.viewport = { width: viewHeight * this.camera.aspect, height: viewHeight, pixelHeight: height * ratio };
    this.imageParticles?.setViewport(this.camera, this.viewport.width, this.viewport.height, this.viewport.pixelHeight);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.motionQuery?.removeEventListener?.('change', this.onMotionChange);
    this.motionQuery = null;
    for (const points of this.layers ?? []) points.geometry.dispose();
    this.material.dispose();
    this.core.geometry.dispose();
    this.coreMaterial.dispose();
    const { onDown, onMove, onUp } = this.dragHandlers ?? {};
    if (onDown) this.renderer.domElement.removeEventListener('pointerdown', onDown);
    if (onMove) window.removeEventListener('pointermove', onMove);
    if (onUp) window.removeEventListener('pointerup', onUp);
    this.clearShapeVideo();
    this.imageParticles?.dispose();
    this.imageParticles = null;
    this.echoField?.dispose();
    this.echoField = null;
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.scene.clear();
  }
}