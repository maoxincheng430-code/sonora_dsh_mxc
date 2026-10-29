import * as THREE from 'three';

// 太空装饰层：远景星野 + 近景星尘 bokeh + 亮星十字光芒 + 偶发流星。独立于音乐粒子，只做氛围背景。
const THEMES = {
  cosmic: ['#8f9cc4', '#5fd0d8', '#e6dcff'],
  fire: ['#c4a08f', '#d8b45f', '#ffe9dc'],
  mono: ['#a8a8a8', '#d6d6d6', '#ffffff'],
};
const STAR_COUNTS = { low: 320, medium: 720, high: 1200 };
const DUST_COUNTS = { low: 10, medium: 18, high: 26 };
const SPARK_COUNTS = { low: 14, medium: 26, high: 40 };
// 流星：单颗间隔 + 群发概率与规模，整体密度比之前高一档。
const METEOR_GAP = [5, 9]; // 秒
const SHOWER_CHANCE = .3;
const SHOWER_SIZE = [3, 6];
const MAX_METEORS = 7;
const STAR_VERTEX = `
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // 每颗星有独立的闪烁频率与相位；能量升高时整体微微提亮。
    float twinkle = .62 + .38 * sin(uTime * (.5 + aSeed * 1.4) + aSeed * 63.0);
    vAlpha = clamp(twinkle * (.75 + uEnergy * .2), 0., 1.);
    gl_PointSize = clamp(aSize * uPixelRatio * (12.0 / -mv.z) * (.8 + .2 * twinkle), 1., 6.);
  }
`;
const STAR_FRAGMENT = `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - .5) * 2.;
    if (d > 1.) discard;
    float halo = exp(-d * d * 4.) * .5;
    float core = exp(-d * d * 24.) * .9;
    // 少量星星偏向高光色，制造冷暖差异。
    vec3 tint = mix(mix(uColorA, uColorB, step(.5, fract(vAlpha * 91.7))), uColorC, step(.92, fract(vAlpha * 47.3)));
    gl_FragColor = vec4(tint, (halo + core) * vAlpha * .55);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
// 流星亮头：柔光圆点，随像素比缩放。
const HEAD_VERTEX = `
  uniform float uPixelRatio;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(14. * uPixelRatio * (10.0 / -mv.z), 3., 26.);
  }
`;
const HEAD_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float d = length(gl_PointCoord - .5) * 2.;
    if (d > 1.) discard;
    float glow = exp(-d * d * 5.) * .7 + exp(-d * d * 18.) * .9;
    gl_FragColor = vec4(uColor, glow * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const METEOR_VERTEX = `
  attribute float aProgress;
  varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // 头亮尾暗的彗尾衰减。
    vFade = pow(1. - aProgress, 2.2);
  }
`;
const METEOR_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  void main() {
    gl_FragColor = vec4(uColor, vFade * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
// 近景星尘：大颗粒软光斑（bokeh），缓慢漂移、极低调。
const DUST_VERTEX = `
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    // 每颗尘埃沿自己的方向缓慢漂移，在 ±1.5 范围内往返。
    float drift = sin(uTime * (.05 + aSeed * .07) + aSeed * 40.0);
    p += vec3(sin(aSeed * 21.0), cos(aSeed * 13.0), sin(aSeed * 31.0)) * drift * 1.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = .5 + .5 * sin(uTime * .18 + aSeed * 57.0);
    gl_PointSize = clamp(aSize * uPixelRatio * (60.0 / -mv.z), 8., 90.);
  }
`;
const DUST_FRAGMENT = `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - .5) * 2.;
    if (d > 1.) discard;
    // 高斯软边，中心也不亮，纯氛围。
    float soft = exp(-d * d * 3.2) * .16;
    gl_FragColor = vec4(uColor, soft * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
// 少量亮星带十字光芒。
const SPARK_VERTEX = `
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = .55 + .45 * sin(uTime * (.3 + aSeed * .5) + aSeed * 71.0);
    gl_PointSize = clamp(aSize * uPixelRatio * (26.0 / -mv.z), 4., 26.);
  }
`;
const SPARK_FRAGMENT = `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 q = gl_PointCoord - .5;
    float d = length(q) * 2.;
    if (d > 1.) discard;
    float core = exp(-d * d * 26.) * .9;
    // 十字光芒：横竖两条细长高斯。
    float cross = max(exp(-abs(q.x) * 46.) * exp(-q.y * q.y * 9.),
                      exp(-abs(q.y) * 46.) * exp(-q.x * q.x * 9.)) * .5;
    gl_FragColor = vec4(uColor, (core + cross) * vAlpha * .8);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class SpaceDecor {
  constructor(scene, quality = 'medium') {
    this.disposed = false;
    this.quality = Object.hasOwn(STAR_COUNTS, quality) ? quality : 'medium';
    this.theme = 'cosmic';
    this.time = 0;
    this.energy = 0;
    this.smoothedEnergy = 0;
    this.nextMeteorIn = 1.5 + Math.random() * 3;
    this.meteors = [];
    this.targetColors = THEMES[this.theme].map(color => new THREE.Color(color));
    this.colors = THEMES[this.theme].map(color => new THREE.Color(color));

    this.starMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uEnergy: { value: 0 }, uPixelRatio: { value: 1 },
        uColorA: { value: this.colors[0] }, uColorB: { value: this.colors[1] }, uColorC: { value: this.colors[2] },
      },
    });
    this.buildStars();
    this.stars = new THREE.Points(this.geometry, this.starMaterial);
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // 流星池：7 条折线常驻复用，支持单颗与群发流星雨。
    this.meteorPool = [];
    for (let i = 0; i < MAX_METEORS; i++) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(12 * 3);
      const progress = new Float32Array(12);
      for (let p = 0; p < 12; p++) progress[p] = p / 11;
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
      const material = new THREE.ShaderMaterial({
        vertexShader: METEOR_VERTEX, fragmentShader: METEOR_FRAGMENT,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: this.colors[2].clone() }, uOpacity: { value: 0 } },
      });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.meteorPool.push({ line, geometry, material, active: false, stagger: 0, state: null });
    }
    // 流星亮头：一个加法混合光点跟随当前主流星头部。
    this.meteorHeadGeometry = new THREE.BufferGeometry();
    this.meteorHeadGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3).setUsage(THREE.DynamicDrawUsage));
    this.meteorHeadMaterial = new THREE.ShaderMaterial({
      vertexShader: HEAD_VERTEX, fragmentShader: HEAD_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color('#eef2ff') }, uOpacity: { value: 0 }, uPixelRatio: { value: 1 } },
    });
    this.meteorHead = new THREE.Points(this.meteorHeadGeometry, this.meteorHeadMaterial);
    this.meteorHead.frustumCulled = false;
    this.meteorHead.visible = false;
    scene.add(this.meteorHead);

    // 近景星尘 bokeh：少量大光斑，落在相机与音乐球体之间。
    this.dustMaterial = new THREE.ShaderMaterial({
      vertexShader: DUST_VERTEX, fragmentShader: DUST_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uColor: { value: this.colors[0].clone() } },
    });
    this.buildDust();
    this.dust = new THREE.Points(this.dustGeometry, this.dustMaterial);
    this.dust.frustumCulled = false;
    scene.add(this.dust);

    // 亮星十字光芒：稀疏、比星野稍亮一档。
    this.sparkMaterial = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERTEX, fragmentShader: SPARK_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uColor: { value: this.colors[2].clone() } },
    });
    this.buildSparks();
    this.sparks = new THREE.Points(this.sparkGeometry, this.sparkMaterial);
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
  }

  buildStars() {
    const count = STAR_COUNTS[this.quality];
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const random = Math.sin(i * 157.31 + 73.17) * 43758.5453;
      const noise = random - Math.floor(random);
      const yy = 1 - ((i + .5) / count) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - yy * yy));
      const angle = i * 2.399963229728653;
      // 以 z=-6 的球心为原点向外取半径，保证所有星星都落在 16–30 的壳层内。
      const radius = 16 + noise * 14;
      positions[i * 3] = Math.cos(angle) * ring * radius;
      positions[i * 3 + 1] = yy * radius * .7;
      // 球心放在相机与音乐粒子之间，星星整体位于主体后方（z≈-16..-28）。
      positions[i * 3 + 2] = Math.sin(angle) * ring * radius - 16;
      seeds[i] = ((i * 6151) % count) / count;
      sizes[i] = .5 + seeds[i] * 1.1 + (i % 61 === 0 ? 1.4 : 0);
    }
    this.geometry?.dispose();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.count = count;
  }

  buildDust() {
    const count = DUST_COUNTS[this.quality];
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const random = Math.sin(i * 97.13 + 31.7) * 43758.5453;
      const noise = random - Math.floor(random);
      // 分布在画面四周、主体前后，避开正中心。
      positions[i * 3] = (noise - .5) * 16 + (i % 2 ? 5.5 : -5.5);
      positions[i * 3 + 1] = ((i * 7919) % count) / count * 10 - 4;
      positions[i * 3 + 2] = -2 - noise * 8;
      seeds[i] = ((i * 3571) % count) / count;
      sizes[i] = 1.2 + seeds[i] * 2.2;
    }
    this.dustGeometry?.dispose();
    this.dustGeometry = new THREE.BufferGeometry();
    this.dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dustGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.dustGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.dustCount = count;
  }

  buildSparks() {
    const count = SPARK_COUNTS[this.quality];
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const random = Math.sin(i * 231.7 + 91.3) * 43758.5453;
      const noise = random - Math.floor(random);
      const yy = 1 - ((i + .5) / count) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - yy * yy));
      const angle = i * 2.399963229728653 + 1.3;
      const radius = 14 + noise * 10;
      positions[i * 3] = Math.cos(angle) * ring * radius;
      positions[i * 3 + 1] = yy * radius * .7;
      positions[i * 3 + 2] = Math.sin(angle) * ring * radius - 14;
      seeds[i] = ((i * 4933) % count) / count;
      sizes[i] = 1.4 + seeds[i] * 1.6;
    }
    this.sparkGeometry?.dispose();
    this.sparkGeometry = new THREE.BufferGeometry();
    this.sparkGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.sparkGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.sparkGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.sparkCount = count;
  }

  setQuality(id) {
    const quality = Object.hasOwn(STAR_COUNTS, id) ? id : 'medium';
    if (quality === this.quality) return;
    this.quality = quality;
    this.buildStars();
    this.stars.geometry = this.geometry;
    this.buildDust();
    this.dust.geometry = this.dustGeometry;
    this.buildSparks();
    this.sparks.geometry = this.sparkGeometry;
  }

  setTheme(id) {
    this.theme = Object.hasOwn(THEMES, id) ? id : 'cosmic';
    const colors = THEMES[this.theme];
    for (let i = 0; i < 3; i++) this.targetColors[i].set(colors[i]);
  }

  /**
   * 直接用一组颜色覆盖星空配色（自定义调色盘用）。非法输入忽略。
   * @param {string[]} colors 3 个 CSS 颜色（不足用首色补齐）
   */
  setColors(colors) {
    if (!Array.isArray(colors) || colors.length === 0) return;
    for (let i = 0; i < 3; i++) {
      this.targetColors[i].set(colors[i] ?? colors[0]);
    }
  }

  setPixelRatio(ratio) {
    const value = Number.isFinite(ratio) ? ratio : 1;
    this.starMaterial.uniforms.uPixelRatio.value = value;
    this.dustMaterial.uniforms.uPixelRatio.value = value;
    this.sparkMaterial.uniforms.uPixelRatio.value = value;
    this.meteorHeadMaterial.uniforms.uPixelRatio.value = value;
  }

  spawnMeteor(stagger = 0) {
    const slot = this.meteorPool.find(entry => !entry.active);
    if (!slot) return null;
    const side = Math.random() < .5 ? -1 : 1;
    slot.active = true;
    slot.stagger = 0;
    slot.state = {
      age: -stagger, // 负龄等待错峰，到 0 才真正起飞
      life: 1.1 + Math.random() * .9,
      // 在相机视野内取起点：上方偏一侧，向对侧下方划过（z 保持负值，落在星野之前、音乐球体之后）。
      origin: new THREE.Vector3(side * (2.5 + Math.random() * 3), 4 + Math.random() * 2, -6 - Math.random() * 4),
      direction: new THREE.Vector3(-side * (.55 + Math.random() * .3), -.85, 0).normalize(),
      speed: 9 + Math.random() * 5,
      length: 2.5 + Math.random() * 1.5,
    };
    slot.line.visible = true;
    return slot;
  }

  startMeteor() {
    return this.spawnMeteor();
  }

  writeMeteorPositions(slot, head) {
    const positions = slot.geometry.attributes.position.array;
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      positions[i * 3] = head.x - slot.state.direction.x * slot.state.length * t;
      positions[i * 3 + 1] = head.y - slot.state.direction.y * slot.state.length * t;
      positions[i * 3 + 2] = head.z - slot.state.direction.z * slot.state.length * t;
    }
    slot.geometry.attributes.position.needsUpdate = true;
  }

  update(dt) {
    if (this.disposed) return;
    const delta = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, .08) : 0;
    this.time += delta;
    this.starMaterial.uniforms.uTime.value = this.time;
    this.dustMaterial.uniforms.uTime.value = this.time;
    this.sparkMaterial.uniforms.uTime.value = this.time;
    const colorEase = 1 - Math.exp(-delta * 4);
    for (let i = 0; i < 3; i++) this.colors[i].lerp(this.targetColors[i], colorEase);
    this.dustMaterial.uniforms.uColor.value.copy(this.colors[1]);
    this.sparkMaterial.uniforms.uColor.value.copy(this.colors[2]);
    this.meteorHeadMaterial.uniforms.uColor.value.copy(this.colors[2]);
    for (const slot of this.meteorPool) slot.material.uniforms.uColor.value.copy(this.colors[2]);
    // 能量指数回落，pulse/外部赋值只负责抬升。
    this.energy *= Math.exp(-delta * 1.5);
    this.smoothedEnergy += (Math.min(1, Math.max(0, this.energy)) - this.smoothedEnergy) * (1 - Math.exp(-delta * 6));
    this.starMaterial.uniforms.uEnergy.value = this.smoothedEnergy;
    this.stars.rotation.y += delta * .004;
    this.sparks.rotation.y += delta * .003;

    // 流星调度：单颗为主，约三成概率升级为持续 1–2 秒的群发流星雨。
    this.nextMeteorIn -= delta;
    if (this.nextMeteorIn <= 0) {
      const shower = Math.random() < SHOWER_CHANCE && !this.meteorPool.some(entry => entry.active);
      const count = shower
        ? SHOWER_SIZE[0] + ((Math.random() * (SHOWER_SIZE[1] - SHOWER_SIZE[0])) | 0)
        : 1;
      for (let i = 0; i < count; i++) this.spawnMeteor(i * (.12 + Math.random() * .28));
      this.nextMeteorIn = (shower ? 7 : METEOR_GAP[0]) + Math.random() * (METEOR_GAP[1] - METEOR_GAP[0]);
    }

    let brightest = null;
    let brightestOpacity = 0;
    for (const slot of this.meteorPool) {
      if (!slot.active) continue;
      slot.state.age += delta;
      // 群发错峰：负龄阶段隐藏折线，到 0 起飞。
      if (slot.state.age < 0) {
        slot.line.visible = false;
        continue;
      }
      slot.line.visible = true;
      const progress = slot.state.age / slot.state.life;
      if (progress >= 1) {
        slot.active = false;
        slot.line.visible = false;
        slot.material.uniforms.uOpacity.value = 0;
        continue;
      }
      const head = slot.state.origin.clone().addScaledVector(slot.state.direction, slot.state.speed * slot.state.age);
      this.writeMeteorPositions(slot, head);
      // 快速淡入、缓慢淡出。
      const opacity = Math.min(1, progress * 12) * (1 - progress) * .85;
      slot.material.uniforms.uOpacity.value = opacity;
      if (opacity > brightestOpacity) {
        brightestOpacity = opacity;
        brightest = head;
      }
    }
    // 亮头光点跟随当前最亮的一颗流星。
    if (brightest) {
      const positions = this.meteorHeadGeometry.attributes.position.array;
      positions[0] = brightest.x;
      positions[1] = brightest.y;
      positions[2] = brightest.z;
      this.meteorHeadGeometry.attributes.position.needsUpdate = true;
      this.meteorHeadMaterial.uniforms.uOpacity.value = Math.min(1, brightestOpacity * 1.15);
      this.meteorHead.visible = true;
    } else {
      this.meteorHead.visible = false;
      this.meteorHeadMaterial.uniforms.uOpacity.value = 0;
    }
  }

  pulse() {
    // 重拍时让星野亮度微微上浮，下一帧 update 会指数回落。
    if (this.disposed) return;
    this.energy = Math.min(1, (this.energy ?? 0) + .5);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    this.starMaterial.dispose();
    this.dustGeometry.dispose();
    this.dustMaterial.dispose();
    this.sparkGeometry.dispose();
    this.sparkMaterial.dispose();
    for (const slot of this.meteorPool) {
      slot.geometry.dispose();
      slot.material.dispose();
      slot.line.removeFromParent();
    }
    this.meteorHeadGeometry.dispose();
    this.meteorHeadMaterial.dispose();
    this.meteorHead.removeFromParent();
    this.stars.removeFromParent();
    this.dust.removeFromParent();
    this.sparks.removeFromParent();
  }
}
