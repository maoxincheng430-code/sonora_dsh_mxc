// 氛围背景系统：雨 / 雷 / 海滩 / 用户图片或视频。
// 视觉层用 DOM + canvas + 内部 rAF 自绘，独立于 Three.js 粒子引擎（Lead 维护）；
// 音频层用 WebAudio 程序合成，绝不请求任何外部音频资源。
// Node 环境（无 document / 无 AudioContext）下静默降级为纯逻辑，视觉照常可用、音频自动跳过。
//
// image 场景接受两种用户背景源（由 classifyBackgroundFile 按 MIME / 扩展名分流）：
//   - 图片：<img class="ambience-ken-burns">，保留 Ken Burns 缓慢缩放漂移；
//   - 视频：<video class="ambience-image-video" autoplay muted loop playsinline>，object-fit:cover 铺满，
//     始终静音、不参与 Ken Burns（位移缩放会露出黑边）。切换媒体/场景会移除旧节点并 revoke 旧 blob URL。
//
// 层级建议（给 Lead 集成时参考）：
//   - 默认：ambience.el 为 position:fixed + z-index:-1，位于 body 背景之上、所有内容之下，
//     只透出 #scene 径向渐变的透明边缘，适合轻氛围。
//   - 若想让氛围层盖住 #scene 的 CSS 渐变、但仍位于粒子 canvas 之下：用
//     createAmbience({ zIndex: 0 })，模块已默认把 el 前置插入 <body>（DOM 顺序早于 #scene），
//     同层 z-index:0 时先插入者绘制在下，效果即“渐变之下、canvas 之上”。
//   - Lead 也可把返回的 el 移入自己的容器再 setScene，位置完全自由。
import { classifyBackgroundFile } from './background-media.js';

export const SCENES = ['none', 'rain', 'thunder', 'beach', 'library', 'image'];
export const DEFAULT_VOLUME = 0.6;

// 可注入的 seeded PRNG（mulberry32）：让 rainParticles / waveBands / 噪声生成可复现，便于单测。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 生成雨滴初始参数：坐标与长度/速度全部归一化到 0..1，canvas 绘制时按视口尺寸缩放。
// 少量又长又快的前景雨，带轻微风偏（sway）。
export function rainParticles(count = 140, seed = 1) {
  const rand = mulberry32(seed);
  const drops = new Array(count);
  for (let i = 0; i < count; i++) {
    drops[i] = {
      x: rand(),
      y: rand(),
      len: 0.03 + rand() * 0.07 + (rand() > 0.82 ? 0.06 : 0),
      speed: 0.28 + rand() * 0.5 + (rand() > 0.85 ? 0.25 : 0),
      alpha: 0.22 + rand() * 0.42,
      sway: (rand() - 0.5) * 0.01,
    };
  }
  return drops;
}

// 海滩浪线参数：y 为归一化纵向位置，amp/speed/phase/alpha/width 控制波形与推移。
export function waveBands(count = 6, seed = 3) {
  const rand = mulberry32(seed);
  const bands = new Array(count);
  for (let i = 0; i < count; i++) {
    bands[i] = {
      y: 0.4 + rand() * 0.5,
      amp: 0.014 + rand() * 0.03,
      speed: 0.22 + rand() * 0.45,
      phase: rand() * Math.PI * 2,
      alpha: 0.22 + rand() * 0.42,
      width: 1 + rand() * 2.2,
    };
  }
  return bands;
}

// 白噪声样本（-1..1），供雨声合成。
export function whiteNoiseValues(count = 2048, seed = 7) {
  const rand = mulberry32(seed);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = rand() * 2 - 1;
  return out;
}

// 布朗噪声样本（-1..1，低频能量集中在浪声区间），供海浪/雷声低沉基底合成。
export function brownNoiseValues(count = 2048, seed = 11) {
  const rand = mulberry32(seed);
  const out = new Float32Array(count);
  let last = 0;
  for (let i = 0; i < count; i++) {
    const white = rand() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    out[i] = Math.max(-1, Math.min(1, last * 3.5));
  }
  return out;
}

// 创建氛围背景控制器。
// options: { host, audio=true, zIndex=-1, document, now, requestAnimationFrame, cancelAnimationFrame, onSceneChange }
// 返回: { setScene, setVolume, getScene, getState, update, attach, dispose, el, onSceneChange }
export function createAmbience(options = {}) {
  const {
    document: doc = (typeof globalThis !== 'undefined' && globalThis.document) || null,
    audio = true,
    zIndex = -1,
    now = () => Date.now(),
    requestAnimationFrame: raf =
      (typeof globalThis !== 'undefined' && globalThis.requestAnimationFrame) || null,
    cancelAnimationFrame: caf =
      (typeof globalThis !== 'undefined' && globalThis.cancelAnimationFrame) || null,
    onSceneChange = null,
  } = options;
  let host = options.host ?? null;

  let scene = 'none';
  let volume = DEFAULT_VOLUME;
  let audioEnabled = audio === true;
  let disposed = false;
  let onChange = typeof onSceneChange === 'function' ? onSceneChange : null;

  // ---- DOM ----
  let rootNode = null;
  let canvasEl = null;
  let flashEl = null;
  let imageEl = null; // .ambience-image 容器
  let mediaEl = null; // 当前 <img> 或 <video>
  let mediaType = null; // 'image' | 'video' | null
  let currentFile = null; // 当前绑定的 File（避免重复 createObjectURL）
  let currentSrc = null; // 当前媒体 src
  let gfx = null; // canvas 2d 上下文
  let imageOptions = {};

  // ---- 动画状态 ----
  let rafId = 0;
  let lastTime = 0;
  let drops = [];
  let bands = [];
  let beachTime = 0;
  let flashAlpha = 0;
  let thunderTimer = 0;

  // ---- 音频状态 ----
  let audioCtx = null;
  let masterGain = null;
  let sceneBus = null; // 场景总线上挂当前场景的所有声音，切场景时整体淡入淡出
  let stream = null;
  let objectURL = null;
  let audioToken = 0;
  // 录音采样（public/audio/*.mp3）：优先用真实录音，加载失败再退回合成音
  const sampleBuffers = new Map();
  const clapBuffers = [];
  let clapsLoading = false;
  // 雷击等一次性音效：切场景时必须停掉，否则会拖到下一个场景里响一声
  const oneShotSources = new Set();

  const noop = () => {};

  // ---------- 纯逻辑辅助（音频图构建用） ----------
  function makeNoiseSource(values) {
    const ctx = audioCtx;
    const buffer = ctx.createBuffer(1, values.length, ctx.sampleRate || 44100);
    buffer.getChannelData(0).set(values);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }

  function buildRainStream(bus) {
    const ctx = audioCtx;
    const src = makeNoiseSource(whiteNoiseValues(2048, 7));
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1100;
    hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(bus);
    src.start();
    return {
      stop() {
        for (const node of [src, hp, lp, g]) {
          try {
            if (typeof node.stop === 'function') node.stop();
            node.disconnect();
          } catch (_e) {}
        }
      },
    };
  }

  function buildBeachStream(bus) {
    const ctx = audioCtx;
    const src = makeNoiseSource(brownNoiseValues(2048, 11));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.85;
    src.connect(lp);
    lp.connect(g);
    g.connect(bus);
    src.start();
    return {
      stop() {
        for (const node of [src, lp, g]) {
          try {
            if (typeof node.stop === 'function') node.stop();
            node.disconnect();
          } catch (_e) {}
        }
      },
    };
  }

  // 雷声：雨底噪 + 布朗低沉基底 + 低频余弦脉冲，脉冲进入反馈延迟形成滚雷回响。
  // thunderGain 平时静音，每次闪电（triggerBolt）时推高包络。
  function buildThunderStream(bus) {
    const ctx = audioCtx;
    const rainSrc = makeNoiseSource(whiteNoiseValues(2048, 7));
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 900;
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0.18;

    const rumbleSrc = makeNoiseSource(brownNoiseValues(2048, 11));
    const rumbleLp = ctx.createBiquadFilter();
    rumbleLp.type = 'lowpass';
    rumbleLp.frequency.value = 150;
    rumbleLp.Q.value = 0.8;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.55;

    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.value = 52;
    const boomGain = ctx.createGain();
    boomGain.gain.value = 0.35;

    const thunderGain = ctx.createGain();
    thunderGain.gain.value = 0;

    const delay = ctx.createDelay();
    delay.delayTime.value = 0.35;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.42;
    const echoIn = ctx.createGain();
    const echoOut = ctx.createGain();

    rainSrc.connect(rainHp);
    rainHp.connect(rainGain);
    rainGain.connect(bus);
    rumbleSrc.connect(rumbleLp);
    rumbleLp.connect(rumbleGain);
    rumbleGain.connect(thunderGain);
    boom.connect(boomGain);
    boomGain.connect(thunderGain);
    thunderGain.connect(bus);
    thunderGain.connect(echoIn);
    echoIn.connect(delay);
    delay.connect(echoOut);
    echoOut.connect(bus);
    echoOut.connect(feedback);
    feedback.connect(delay);

    rainSrc.start();
    rumbleSrc.start();
    boom.start();

    const all = [rainSrc, rainHp, rainGain, rumbleSrc, rumbleLp, rumbleGain,
      boom, boomGain, thunderGain, delay, feedback, echoIn, echoOut];
    return {
      thunderGain,
      stop() {
        for (const node of all) {
          try {
            if (typeof node.stop === 'function') node.stop();
            node.disconnect();
          } catch (_e) {}
        }
      },
    };
  }

  // ---------- 音频 ----------
  function ensureAudio() {
    if (!audioEnabled || disposed) return null;
    if (audioCtx) return audioCtx;
    const AudioCtor =
      (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext)) || null;
    if (!AudioCtor) return null; // 静默降级：无 WebAudio 只做视觉
    try {
      audioCtx = new AudioCtor();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(audioCtx.destination);
      sceneBus = audioCtx.createGain();
      sceneBus.gain.value = 1;
      sceneBus.connect(masterGain);
      // 在用户手势内创建，随手 resume 以解锁被挂起的上下文。
      if (audioCtx.resume && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_e) {
      audioCtx = null;
      masterGain = null;
    }
    return audioCtx;
  }

  // 一次性雷击爆音淡出并停止（切换场景时调用，避免声音残留到新场景）
  function stopOneShots() {
    for (const shot of oneShotSources) {
      try {
        const t = audioCtx?.currentTime ?? 0;
        if (shot.gain?.gain) {
          shot.gain.gain.cancelScheduledValues(t);
          shot.gain.gain.setValueAtTime(Math.max(0.0001, shot.gain.gain.value), t);
          shot.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        }
        shot.src.stop(t + 0.07);
      } catch (_e) {}
    }
    oneShotSources.clear();
  }

  function stopStream() {
    stopOneShots();
    if (!stream) return;
    const old = stream;
    stream = null;
    try {
      const param = old.out?.gain;
      if (param && audioCtx) {
        const t = audioCtx.currentTime;
        if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(t);
        else {
          param.cancelScheduledValues(t);
          param.setValueAtTime(Math.max(0.0001, param.value), t);
        }
        param.exponentialRampToValueAtTime(0.0001, t + 0.18);
      }
    } catch (_e) {}
    // 让淡出先走完，再断开节点
    setTimeout(() => {
      try {
        old.stop();
      } catch (_e) {}
    }, 240);
  }

  // ---------- 录音采样（public/audio/*.mp3） ----------
  // 素材重新抽取后 +1：给 mp3 带上版本参数，避免浏览器/HTTP 缓存继续播放旧音频
  const SAMPLE_CACHE_VERSION = '3';

  function sampleUrl(name) {
    const base = (doc && doc.baseURI) || (globalThis.location && globalThis.location.href) || null;
    if (!base) return null;
    try {
      const url = new URL(`audio/${name}.mp3`, base);
      url.searchParams.set('v', SAMPLE_CACHE_VERSION);
      return url.href;
    } catch (_e) {
      return null;
    }
  }

  function loadBuffer(url) {
    if (!audioCtx || typeof fetch !== 'function' || !url) return Promise.resolve(null);
    if (sampleBuffers.has(url)) return sampleBuffers.get(url);
    const task = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // 仓库里不带录音（public/audio/*.mp3 已 gitignore），SFC/dev server 对缺失
        // 的静态资源常返回 200 + text/html（index.html 兜底），直接塞给
        // decodeAudioData 会抛 EncodingError，控制台留下红色报错。
        // 先按 content-type 拦一道，缺失时安静回落到合成音。
        const type = String(res.headers?.get?.('content-type') || '');
        if (type && !/^audio\/|octet-stream/i.test(type)) {
          throw new Error(`not audio: ${type}`);
        }
        return res.arrayBuffer();
      })
      .then(
        (buffer) =>
          new Promise((resolve, reject) => {
            try {
              // 解码失败时回调 reject；用 try/catch 兜住同步抛出的那部分
              audioCtx.decodeAudioData(
                buffer,
                resolve,
                () => reject(new Error('decode failed')),
              );
            } catch (_e) {
              reject(_e);
            }
          }),
      )
      .catch(() => null);
    sampleBuffers.set(url, task);
    return task;
  }

  function loadSample(name) {
    return loadBuffer(sampleUrl(name));
  }

  function loadClapBuffers() {
    if (clapsLoading || clapBuffers.length) return;
    clapsLoading = true;
    Promise.all([1, 2, 3].map((i) => loadSample(`thunder-${i}`))).then((buffers) => {
      for (const buffer of buffers) if (buffer) clapBuffers.push(buffer);
    });
  }

  function buildSampleStream(buffer, name, bus) {
    const ctx = audioCtx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = name === 'library' ? 8000 : 12500;
    const g = ctx.createGain();
    g.gain.value = name === 'thunder' ? 0.62 : name === 'library' ? 0.7 : 0.8;
    src.connect(lp);
    lp.connect(g);
    g.connect(bus);
    src.start();
    return {
      stop() {
        try {
          src.stop();
          src.disconnect();
          lp.disconnect();
          g.disconnect();
        } catch (_e) {}
      },
    };
  }

  // 每个场景一条独立的输出增益：新场景立刻淡入，旧场景在自己的通路上淡出，
  // 两路短暂交叉淡化——既保留原来的声音包络，又不会因为硬切产生爆音。
  function makeStream(build) {
    if (!audioCtx) return null;
    const out = audioCtx.createGain();
    out.gain.value = 0.0001;
    out.connect(sceneBus);
    const inner = build(out);
    try {
      const t = audioCtx.currentTime;
      if (typeof out.gain.cancelAndHoldAtTime === 'function') out.gain.cancelAndHoldAtTime(t);
      else out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(1, t + 0.8);
    } catch (_e) {}
    return { ...inner, out };
  }

  function startSynthFallback() {
    if (scene === 'rain') stream = makeStream((bus) => buildRainStream(bus));
    else if (scene === 'thunder') stream = makeStream((bus) => buildThunderStream(bus));
    else if (scene === 'beach') stream = makeStream((bus) => buildBeachStream(bus));
    else if (scene === 'library') stream = makeStream((bus) => buildBeachStream(bus)); // 无录音时的安静底噪
    else return;
  }

  function syncAudio() {
    const token = ++audioToken;
    stopStream();
    if (!audioEnabled || scene === 'none' || scene === 'image') return;
    ensureAudio();
    if (!audioCtx || !masterGain) return;

    const cached = sampleBuffers.get(sampleUrl(scene) || '');
    // 已经解码好的录音：直接播（新流自己淡入，旧流在上一步已淡出）
    if (typeof cached === 'object' && cached && typeof cached.then !== 'function') {
      stream = makeStream((bus) => buildSampleStream(cached, scene, bus));
      if (scene === 'thunder') loadClapBuffers();
      return;
    }

    // 先用合成音顶上，录音加载好再交叉淡化换过去
    startSynthFallback();
    if (scene === 'thunder') loadClapBuffers();
    loadSample(scene).then((buffer) => {
      if (!buffer || token !== audioToken || disposed) return;
      stopStream();
      setTimeout(() => {
        if (token !== audioToken || disposed || !audioCtx) return;
        stream = makeStream((bus) => buildSampleStream(buffer, scene, bus));
      }, 240);
    });
  }

  // 一次雷击：优先播录音里的炸雷；没有录音时退回合成雷。
  function triggerBolt() {
    flashAlpha = 1;
    if (!audioCtx || !masterGain) return;
    if (clapBuffers.length) {
      try {
        const buffer = clapBuffers[Math.floor(Math.random() * clapBuffers.length)];
        const src = audioCtx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = 0.92 + Math.random() * 0.16;
        const g = audioCtx.createGain();
        g.gain.value = 0.85;
        src.connect(g);
        g.connect(masterGain);
        const shot = { src, gain: g };
        oneShotSources.add(shot);
        src.onended = () => oneShotSources.delete(shot);
        src.start(audioCtx.currentTime + 0.1 + Math.random() * 0.7);
        return;
      } catch (_e) {}
    }
    if (!stream || !stream.thunderGain) return;
    const t0 = audioCtx.currentTime;
    const param = stream.thunderGain.gain;
    try {
      param.cancelScheduledValues(t0);
      param.setValueAtTime(0.0001, t0);
      param.exponentialRampToValueAtTime(0.95, t0 + 0.05);
      param.exponentialRampToValueAtTime(0.0001, t0 + 4.2);
    } catch (_e) {}
  }

  // ---------- 视觉 ----------
  function ensureDom() {
    if (rootNode) return rootNode;
    if (!doc || typeof doc.createElement !== 'function') return null;
    rootNode = doc.createElement('div');
    rootNode.className = 'ambience ambience-scene-none';
    rootNode.style.position = 'fixed';
    rootNode.style.inset = '0';
    rootNode.style.zIndex = String(zIndex);
    rootNode.style.pointerEvents = 'none';
    if (rootNode.classList) {
      rootNode.classList.add('ambience');
      rootNode.classList.add('ambience-scene-none');
    }

    canvasEl = doc.createElement('canvas');
    canvasEl.className = 'ambience-canvas';
    if (canvasEl.classList) canvasEl.classList.add('ambience-canvas');
    canvasEl.setAttribute('aria-hidden', 'true');
    rootNode.appendChild(canvasEl);

    flashEl = doc.createElement('div');
    flashEl.className = 'ambience-flash';
    if (flashEl.classList) flashEl.classList.add('ambience-flash');
    rootNode.appendChild(flashEl);

    imageEl = doc.createElement('div');
    imageEl.className = 'ambience-image';
    if (imageEl.classList) imageEl.classList.add('ambience-image');
    rootNode.appendChild(imageEl);

    attachRoot();
    return rootNode;
  }

  function attachRoot() {
    if (!rootNode) return;
    const target = host || (doc && (doc.body || doc.documentElement));
    if (!target) return;
    if (host) {
      target.appendChild(rootNode);
    } else {
      // 无 host 时前置插入 body：同层 z-index 下 DOM 顺序早于 #scene，绘制在粒子 layer 之下。
      target.insertBefore(rootNode, target.firstChild);
    }
  }

  // 浏览器标准是 URL.createObjectURL（document 上并没有这个方法）；
  // 假 document（单测）仍可注入 createObjectURL/revokeObjectURL，优先使用注入实现。
  function createMediaObjectURL(file) {
    if (!file) return null;
    if (doc && typeof doc.createObjectURL === 'function') {
      try {
        return doc.createObjectURL(file);
      } catch (_e) {}
    }
    const URLImpl = globalThis.URL || doc?.defaultView?.URL;
    if (URLImpl && typeof URLImpl.createObjectURL === 'function') {
      try {
        return URLImpl.createObjectURL(file);
      } catch (_e) {}
    }
    return null;
  }

  function revokeMediaObjectURL(url) {
    if (!url) return;
    if (doc && typeof doc.revokeObjectURL === 'function') {
      try {
        doc.revokeObjectURL(url);
        return;
      } catch (_e) {}
    }
    const URLImpl = globalThis.URL || doc?.defaultView?.URL;
    if (URLImpl && typeof URLImpl.revokeObjectURL === 'function') {
      try {
        URLImpl.revokeObjectURL(url);
      } catch (_e) {}
    }
  }

  function releaseObjectURL() {
    if (objectURL) revokeMediaObjectURL(objectURL);
    objectURL = null;
  }

  // 解析 image 场景请求的媒体源：{ kind: 'image'|'video', file, url } 或 null。
  // file 按类型分流；imageUrl 仍只用于图片（保持旧接口兼容）。
  function resolveMediaRequest() {
    const opts = imageOptions || {};
    if (opts.file) {
      const kind = classifyBackgroundFile(opts.file);
      if (!kind) return null;
      return { kind, file: opts.file, url: null };
    }
    if (opts.imageUrl) return { kind: 'image', file: null, url: opts.imageUrl };
    return null;
  }

  function createMediaElement(kind) {
    if (kind === 'video') {
      const video = doc.createElement('video');
      video.className = 'ambience-image-video';
      if (video.classList) video.classList.add('ambience-image-video');
      // 静音 + 自动循环 + 行内播放（iOS 需要 playsinline 才不会被全屏接管）。
      for (const name of ['autoplay', 'muted', 'loop', 'playsinline']) {
        video.setAttribute(name, '');
      }
      video.setAttribute('preload', 'auto');
      video.setAttribute('aria-hidden', 'true');
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      return video;
    }
    const img = doc.createElement('img');
    img.setAttribute('alt', '');
    img.setAttribute('aria-hidden', 'true');
    return img;
  }

  // 自动播放失败（浏览器策略 / 解码失败）时静默忽略，不打断页面。
  function startVideoPlayback() {
    if (!mediaEl || mediaType !== 'video') return;
    try {
      if (typeof mediaEl.load === 'function') mediaEl.load();
    } catch (_e) {}
    try {
      const played = typeof mediaEl.play === 'function' ? mediaEl.play() : null;
      if (played && typeof played.catch === 'function') played.catch(() => {});
    } catch (_e) {}
  }

  // 清理当前媒体节点与 blob URL；切场景 / 换图换视频 / dispose 时调用，避免节点与 URL 泄漏。
  function teardownMedia() {
    if (mediaEl) {
      if (mediaType === 'video') {
        try {
          if (typeof mediaEl.pause === 'function') mediaEl.pause();
          if (typeof mediaEl.removeAttribute === 'function') mediaEl.removeAttribute('src');
        } catch (_e) {}
        try {
          // 停止网络/解码活动（src 已移除，load() 会复位媒体元素状态）。
          if (typeof mediaEl.load === 'function') mediaEl.load();
        } catch (_e) {}
      }
      if (mediaEl.parentNode && typeof mediaEl.parentNode.removeChild === 'function') {
        try {
          mediaEl.parentNode.removeChild(mediaEl);
        } catch (_e) {}
      }
    }
    mediaEl = null;
    mediaType = null;
    currentFile = null;
    currentSrc = null;
    releaseObjectURL();
  }

  function updateImage() {
    if (scene !== 'image' || !doc || !imageEl) return;
    const wanted = resolveMediaRequest();
    if (!wanted) {
      teardownMedia();
      return;
    }

    // 同类型复用节点：图片只换 src（不重建 <img>，避免闪烁并保留 Ken Burns 动画）；
    // 图片 <-> 视频切换时重建为对应标签。
    if (!mediaEl || mediaType !== wanted.kind) {
      teardownMedia();
      mediaEl = createMediaElement(wanted.kind);
      mediaType = wanted.kind;
      imageEl.appendChild(mediaEl);
    }

    let nextURL = null;
    if (wanted.file) {
      if (currentFile === wanted.file && currentSrc) nextURL = currentSrc;
      else nextURL = createMediaObjectURL(wanted.file);
    } else {
      nextURL = wanted.url;
    }

    if (!nextURL) {
      // 无可用 URL（例如无 createObjectURL 的降级环境）：保持空媒体层。
      if (currentSrc) {
        releaseObjectURL();
        currentSrc = null;
        currentFile = null;
        if (typeof mediaEl.removeAttribute === 'function') mediaEl.removeAttribute('src');
      }
    } else if (nextURL !== currentSrc) {
      // 换源：先回收上一份 blob URL，避免内存泄漏。
      releaseObjectURL();
      objectURL = wanted.file ? nextURL : null;
      currentSrc = nextURL;
      mediaEl.setAttribute('src', nextURL);
      if (mediaType === 'video') startVideoPlayback();
    }
    currentFile = wanted.file || null;

    if (mediaEl.classList) {
      // 视频不加 Ken Burns（位移缩放会露出边缘黑边）。
      if (mediaType === 'image') mediaEl.classList.add('ambience-ken-burns');
      else mediaEl.classList.remove('ambience-ken-burns');
    }
  }

  function updateSceneClass() {
    if (!rootNode || !rootNode.classList) return;
    for (const name of SCENES) rootNode.classList.remove(`ambience-scene-${name}`);
    rootNode.classList.add(`ambience-scene-${scene}`);
    if (rootNode.dataset) rootNode.dataset.scene = scene;
  }

  function syncVisual() {
    ensureDom();
    if (!rootNode) return;
    updateSceneClass();
    const active = scene === 'rain' || scene === 'thunder' || scene === 'beach';
    canvasEl.style.display = active ? 'block' : 'none';
    flashEl.style.display = scene === 'thunder' ? 'block' : 'none';
    flashEl.style.opacity = '0';
    flashAlpha = 0;
    imageEl.style.display = scene === 'image' ? 'block' : 'none';
    if (scene !== 'image') teardownMedia();
    if (scene === 'rain' || scene === 'thunder') drops = rainParticles(140, 1);
    if (scene === 'beach') {
      bands = waveBands(6, 3);
      beachTime = 0;
    }
    if (scene === 'thunder') thunderTimer = 1.2 + Math.random() * 2.5;
    if (scene === 'image') updateImage();
    if (active) {
      drawFrame(0.016);
      startLoop();
    } else {
      stopLoop();
    }
  }

  function viewSize() {
    const view = doc && doc.defaultView ? doc.defaultView : null;
    const w = (view && view.innerWidth) || canvasEl.clientWidth || 1280;
    const h = (view && view.innerHeight) || canvasEl.clientHeight || 720;
    return [w, h];
  }

  function drawFrame(dt) {
    if (!canvasEl) return;
    if (!gfx) gfx = canvasEl.getContext && canvasEl.getContext('2d');
    if (!gfx) return;
    const [w, h] = viewSize();
    if (canvasEl.width !== w || canvasEl.height !== h) {
      canvasEl.width = w;
      canvasEl.height = h;
    }
    if (scene === 'rain' || scene === 'thunder') drawRain(w, h, dt);
    else if (scene === 'beach') drawBeach(w, h, dt);
  }

  function drawRain(w, h, dt) {
    gfx.clearRect(0, 0, w, h);
    gfx.lineWidth = 1;
    gfx.strokeStyle = '#cddcff';
    for (const drop of drops) {
      drop.x += (drop.sway || 0) * dt;
      drop.y += drop.speed * dt;
      if (drop.y > 1.06) {
        drop.y = -0.06 - Math.random() * 0.1;
        drop.x = Math.random();
      }
      const x1 = drop.x * w;
      const y1 = drop.y * h;
      const len = drop.len * h;
      gfx.globalAlpha = drop.alpha;
      gfx.beginPath();
      gfx.moveTo(x1, y1);
      gfx.lineTo(x1 + len * 0.09, y1 + len);
      gfx.stroke();
    }
    gfx.globalAlpha = 1;
  }

  function drawBeach(w, h, dt) {
    gfx.clearRect(0, 0, w, h);
    const grad = gfx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(56, 84, 120, 0)');
    grad.addColorStop(0.5, 'rgba(70, 130, 140, 0.5)');
    grad.addColorStop(1, 'rgba(104, 178, 168, 0.55)');
    gfx.fillStyle = grad;
    gfx.fillRect(0, 0, w, h);
    beachTime += dt;
    for (const band of bands) {
      gfx.strokeStyle = `rgba(186, 238, 227, ${band.alpha.toFixed(3)})`;
      gfx.lineWidth = band.width;
      gfx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const t = (x / w) * Math.PI * 2;
        const y = (band.y + band.amp * Math.sin(t + band.phase + beachTime * band.speed)) * h;
        if (x === 0) gfx.moveTo(x, y);
        else gfx.lineTo(x, y);
      }
      gfx.stroke();
    }
  }

  // ---------- 逐帧逻辑（rAF 驱动；update(dt) 可手动驱动，便于测试） ----------
  function step(dt) {
    if (disposed) return;
    if (scene === 'thunder') {
      thunderTimer -= dt;
      if (thunderTimer <= 0) {
        triggerBolt();
        thunderTimer = 4 + Math.random() * 7;
      }
      flashAlpha *= Math.exp(-dt * 3.2);
      if (flashAlpha < 0.01) flashAlpha = 0;
      if (flashEl) flashEl.style.opacity = flashAlpha.toFixed(3);
    }
    drawFrame(dt);
  }

  function tick(t) {
    if (disposed || !rafId) return;
    let dt = 0.016;
    if (typeof t === 'number') {
      if (lastTime > 0) dt = Math.min(0.1, Math.max(0.001, (t - lastTime) / 1000));
      lastTime = t;
    }
    step(dt);
    rafId = raf(tick);
  }

  function startLoop() {
    if (!raf || rafId) return;
    lastTime = 0;
    rafId = raf(tick);
  }

  function stopLoop() {
    if (rafId && caf) caf(rafId);
    rafId = 0;
  }

  // ---------- 公共 API ----------
  function setScene(name, sceneOptions = {}) {
    if (disposed) return api;
    if (!SCENES.includes(name)) name = 'none';
    const changed = name !== scene;
    scene = name;
    imageOptions = sceneOptions || {};
    syncAudio();
    syncVisual();
    if (changed && onChange) {
      try {
        onChange(name, imageOptions);
      } catch (_e) {}
    }
    return api;
  }

  function setVolume(value) {
    volume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    if (masterGain && masterGain.gain) masterGain.gain.value = volume;
    return api;
  }

  function getScene() {
    return scene;
  }

  function getState() {
    return {
      scene,
      volume,
      audioEnabled,
      audioReady: !!audioCtx,
      mediaType,
    };
  }

  // 手动帧推进：等价于内部 rAF 的一帧，供 Lead 在统一循环里驱动，或测试使用。
  function update(dt = 0.016) {
    if (!disposed) step(dt);
    return api;
  }

  function attach(hostEl) {
    if (disposed) return api;
    if (hostEl) host = hostEl;
    ensureDom();
    return api;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopLoop();
    stopStream();
    if (audioCtx) {
      try {
        if (audioCtx.close) audioCtx.close();
      } catch (_e) {}
      audioCtx = null;
      masterGain = null;
    }
    teardownMedia();
    if (rootNode && rootNode.parentNode && rootNode.parentNode.removeChild) {
      try {
        rootNode.parentNode.removeChild(rootNode);
      } catch (_e) {}
    }
    rootNode = null;
    canvasEl = null;
    flashEl = null;
    imageEl = null;
    mediaEl = null;
    mediaType = null;
    gfx = null;
  }

  const api = {
    setScene,
    setVolume,
    getScene,
    getState,
    update,
    attach,
    dispose,
    get el() {
      return rootNode;
    },
    get onSceneChange() {
      return onChange;
    },
    set onSceneChange(fn) {
      onChange = typeof fn === 'function' ? fn : null;
    },
  };
  return api;
}