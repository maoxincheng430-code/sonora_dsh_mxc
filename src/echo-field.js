import * as THREE from 'three';

// 「音域回响」：一张随低频起伏的 3D 网格地形（wireframe + 半透明面 + 背光）。
// 参考 JIZURA / 各类 voxel terrain visualizer 的做法：顶点位移 + 等高线网格 + 加法辉光。

const SURFACE = 88;
const GRID = 42;
const SIZE = 4.4;

const VERTEX = `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uBeat;
  uniform float uEnergy;
  uniform float uSize;
  varying vec2 vUv;
  varying float vH;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vUv = uv;
    vec2 p = position.xy;
    float r = length(p / uSize);

    // 中间低、外圈隆起的“火山口 / 回声坑”
    float crater = exp(-pow((r - 0.58) * 3.4, 2.0)) * 0.95
                 - exp(-pow(r * 2.6, 2.0)) * 0.65;
    // 缓慢流动的噪声丘陵
    float terrain = (noise(p * 1.35 + vec2(uTime * 0.11, -uTime * 0.08)) - 0.5) * 0.6;
    // 同心声波：低频越强，波纹越明显
    float ripple = sin(r * 13.0 - uTime * 2.4 + noise(p * 2.2) * 3.0);
    float h = crater * 0.45
            + terrain * 0.55
            + ripple * (0.10 + uBass * 0.55) * (0.35 + 0.65 * uEnergy)
            + (noise(p * 4.0 + uTime * 0.4) - 0.5) * (0.06 + uTreble * 0.28)
            + uMid * 0.12 * sin(p.x * 2.2 + uTime * 1.3)
            + uBeat * 0.16 * (1.0 - smoothstep(0.2, 0.95, r));

    // 轻微的梯田感，更像 voxel 地形
    h = mix(h, floor(h * 14.0) / 14.0, 0.45);
    vH = h;

    vec3 pos = vec3(p.x, p.y, h);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const SURFACE_FRAGMENT = `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uBeat;
  uniform float uEnergy;
  varying vec2 vUv;
  varying float vH;

  void main() {
    vec2 grid = abs(fract(vUv * 64.0) - 0.5);
    float line = 1.0 - smoothstep(0.02, 0.16, min(grid.x, grid.y));
    float edge = 1.0 - smoothstep(0.24, 0.5, length(vUv - 0.5));
    float height = clamp(vH * 1.4 + 0.5, 0.0, 1.0);
    float r = length(vUv - 0.5) * 2.0;
    float rim = exp(-pow((r - 0.56) * 4.0, 2.0));
    vec3 color = mix(uColorA, uColorB, 0.3 + height * 0.7) * 1.15;
    color += uColorC * rim * 0.28;
    color = mix(color, uColorC, line * 0.28);
    float alpha = (0.24 + line * 0.42 + height * 0.18 + rim * 0.18) * edge;
    alpha *= 0.5 + uEnergy * 0.45 + uBeat * 0.22;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const LINE_FRAGMENT = `
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uBeat;
  varying vec2 vUv;
  varying float vH;

  void main() {
    float edge = 1.0 - smoothstep(0.26, 0.5, length(vUv - 0.5));
    vec3 color = mix(uColorB * 0.8, uColorC, clamp(vH * 1.1 + 0.1, 0.0, 0.75));
    gl_FragColor = vec4(color, (0.10 + uBeat * 0.10) * edge);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const GLOW_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLOW_FRAGMENT = `
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float alpha = exp(-d * d * 3.6) * 0.2;
    gl_FragColor = vec4(uColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function buildGridGeometry(size, divisions) {
  const half = size / 2;
  const positions = [];
  const uvs = [];
  for (let i = 0; i <= divisions; i += 1) {
    const t = (i / divisions) * 2 - 1;
    const c = t * half;
    const uv = (t + 1) / 2;
    // 横向线
    positions.push(-half, c, 0, half, c, 0);
    uvs.push(0, uv, 1, uv);
    // 纵向线
    positions.push(c, -half, 0, c, half, 0);
    uvs.push(uv, 0, uv, 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

export class EchoField {
  constructor(parent) {
    this.el = new THREE.Group();
    this.el.rotation.x = -1.34;
    this.el.position.set(0, -0.36, -0.2);
    parent.add(this.el);

    this.uniforms = {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uBeat: { value: 0 },
      uEnergy: { value: 0 },
      uSize: { value: SIZE / 2 },
      uColorA: { value: new THREE.Color('#6d5bd0') },
      uColorB: { value: new THREE.Color('#9b7dff') },
      uColorC: { value: new THREE.Color('#ffd9ff') },
    };

    const surfaceMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: SURFACE_FRAGMENT,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE, SURFACE, SURFACE), surfaceMaterial);
    this.surface.frustumCulled = false;
    this.el.add(this.surface);

    const lineMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: LINE_FRAGMENT,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.grid = new THREE.LineSegments(buildGridGeometry(SIZE, GRID), lineMaterial);
    this.grid.frustumCulled = false;
    this.el.add(this.grid);

    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE * 1.65, SIZE * 1.65),
      new THREE.ShaderMaterial({
        vertexShader: GLOW_VERTEX,
        fragmentShader: GLOW_FRAGMENT,
        uniforms: { uColor: { value: new THREE.Color('#8b75ff') } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glow.position.z = -0.55;
    this.el.add(this.glow);

    this.visible = false;
    this.el.visible = false;
    this.time = 0;
  }

  setActive(active) {
    this.visible = Boolean(active);
    this.el.visible = this.visible;
  }

  setColors(colors = []) {
    if (!Array.isArray(colors) || !colors.length) return;
    this.uniforms.uColorA.value.set(colors[0] ?? '#6d5bd0');
    this.uniforms.uColorB.value.set(colors[1] ?? '#9b7dff');
    this.uniforms.uColorC.value.set(colors[2] ?? '#ffd9ff');
    this.glow.material.uniforms.uColor.value.set(colors[1] ?? '#8b75ff');
  }

  update(delta, levels = {}) {
    if (!this.visible) return;
    this.time += delta;
    const u = this.uniforms;
    const ease = 1 - Math.exp(-delta * 6);
    u.uTime.value = this.time;
    u.uBass.value += ((Number(levels.bass) || 0) - u.uBass.value) * ease;
    u.uMid.value += ((Number(levels.mid) || 0) - u.uMid.value) * ease;
    u.uTreble.value += ((Number(levels.treble) || 0) - u.uTreble.value) * ease;
    u.uBeat.value += ((Number(levels.beat) || 0) - u.uBeat.value) * ease;
    u.uEnergy.value += ((Number(levels.energy) || 0) - u.uEnergy.value) * ease;
    // 整块地形缓慢自转 + 呼吸
    this.el.rotation.z = Math.sin(this.time * 0.12) * 0.06;
    this.el.rotation.y = Math.sin(this.time * 0.16) * 0.26;
    this.el.position.y = -0.36 + Math.sin(this.time * 0.4) * 0.03;
    const breathe = 1.16 + u.uBass.value * 0.04;
    this.el.scale.set(breathe, breathe, breathe);
  }

  dispose() {
    this.el.traverse((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
      else child.material?.dispose?.();
    });
    this.el.removeFromParent();
  }
}
