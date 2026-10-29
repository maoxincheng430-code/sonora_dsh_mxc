import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleImageData, estimateBackgroundColor } from '../src/image-particles.js';

function makeImage(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width, height };
}

test('sampleImageData：跳过透明像素，保留不透明像素', () => {
  const img = makeImage(4, 2, (x) => (x < 2 ? [255, 255, 255, 255] : [255, 255, 255, 0]));
  const out = sampleImageData(img.data, img.width, img.height, { background: 'keep' });
  assert.equal(out.count, 4);
  assert.equal(out.positions.length, out.count * 3);
  assert.equal(out.colors.length, out.count * 3);
});

test('sampleImageData：位置归一化在 [-0.5, 0.5]，z 落在 0..1', () => {
  const img = makeImage(8, 6, () => [200, 120, 60, 255]);
  const out = sampleImageData(img.data, img.width, img.height, { background: 'keep' });
  assert.ok(out.count > 0);
  for (let i = 0; i < out.count; i++) {
    const x = out.positions[i * 3];
    const y = out.positions[i * 3 + 1];
    const z = out.positions[i * 3 + 2];
    assert.ok(x >= -0.5 && x <= 0.5, `x=${x}`);
    assert.ok(y >= -0.5 && y <= 0.5, `y=${y}`);
    assert.ok(z >= 0 && z <= 1, `z=${z}`);
    assert.ok(out.sizes[i] > 0);
    assert.ok(out.seeds[i] >= 0 && out.seeds[i] <= 1);
  }
});

test('sampleImageData：颜色做 sRGB→线性转换（白色为 1，中灰约 0.216）', () => {
  const white = makeImage(2, 2, () => [255, 255, 255, 255]);
  const outWhite = sampleImageData(white.data, 2, 2, { background: 'keep' });
  assert.ok(Math.abs(outWhite.colors[0] - 1) < 0.01);

  const gray = makeImage(2, 2, () => [128, 128, 128, 255]);
  const outGray = sampleImageData(gray.data, 2, 2, { background: 'keep' });
  const expected = Math.pow(128 / 255, 2.2);
  assert.ok(Math.abs(outGray.colors[0] - expected) < 0.02, `期望≈${expected}，实际=${outGray.colors[0]}`);
});

test('sampleImageData：边缘像素的粒子更大（Sobel 加权）', () => {
  // 左黑右白，边界处边缘最强
  const img = makeImage(12, 12, (x) => (x < 6 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const out = sampleImageData(img.data, 12, 12, { luminanceThreshold: 0, background: 'keep' });
  let maxSize = 0;
  let minSize = Infinity;
  for (let i = 0; i < out.count; i++) {
    maxSize = Math.max(maxSize, out.sizes[i]);
    minSize = Math.min(minSize, out.sizes[i]);
  }
  assert.ok(maxSize > minSize * 1.2, `最大 ${maxSize} 应明显大于最小 ${minSize}`);
});

test('sampleImageData：粒子数不超过 maxParticles', () => {
  const img = makeImage(60, 60, () => [180, 180, 180, 255]);
  const out = sampleImageData(img.data, 60, 60, { maxParticles: 500, background: 'keep' });
  assert.ok(out.count <= 500, `count=${out.count}`);
  assert.ok(out.count > 0);
});

test('sampleImageData：全透明图片返回空数组', () => {
  const img = makeImage(5, 5, () => [0, 0, 0, 0]);
  const out = sampleImageData(img.data, 5, 5, { background: 'keep' });
  assert.equal(out.count, 0);
  assert.equal(out.positions.length, 0);
});

test('estimateBackgroundColor：纯色边框能识别出背景色', () => {
  const img = makeImage(20, 20, (x, y) =>
    x === 0 || y === 0 || x === 19 || y === 19 ? [250, 250, 250, 255] : [20, 20, 20, 255],
  );
  const bg = estimateBackgroundColor(img.data, 20, 20);
  assert.ok(bg, '应识别到背景');
  assert.ok(Math.abs(bg.r - 250 / 255) < 0.02);
  assert.ok(Math.abs(bg.g - 250 / 255) < 0.02);
});

test('estimateBackgroundColor：边框颜色很杂时返回 null', () => {
  const img = makeImage(20, 20, (x, y) => {
    const border = x === 0 || y === 0 || x === 19 || y === 19;
    if (!border) return [0, 0, 0, 255];
    return [(x * 37) % 256, (y * 91) % 256, ((x + y) * 53) % 256, 255];
  });
  assert.equal(estimateBackgroundColor(img.data, 20, 20), null);
});

test('sampleImageData：自动扣背景会去掉纯色边框，保留主体', () => {
  // 白色背景 + 中间深色圆（近似 logo）
  const img = makeImage(30, 30, (x, y) => {
    const dx = x - 15;
    const dy = y - 15;
    return dx * dx + dy * dy < 49 ? [30, 30, 30, 255] : [250, 250, 250, 255];
  });
  const keep = sampleImageData(img.data, 30, 30, { background: 'keep' });
  // 白色背景默认不扣（避免把浅色主体一起扣掉）
  const skipped = sampleImageData(img.data, 30, 30, { background: 'auto' });
  assert.equal(skipped.lightSkipped, true);
  assert.equal(skipped.count, keep.count);
  assert.equal(skipped.background.mode, 'light-keep');
  // 显式打开「白底也抠」才真正扣白底
  const auto = sampleImageData(img.data, 30, 30, { background: 'auto', keepLightBackground: false });
  assert.ok(auto.count > 0, '主体应保留');
  assert.ok(auto.count < keep.count * 0.6, `自动 ${auto.count} 应明显少于保留 ${keep.count}`);
  assert.ok(auto.background && Math.abs(auto.background.r - 250 / 255) < 0.03);
});

test('sampleImageData：density 会改变点数预算', () => {
  const img = makeImage(60, 60, () => [120, 160, 200, 255]);
  const full = sampleImageData(img.data, 60, 60, { maxParticles: 600, background: 'keep', density: 1 });
  const half = sampleImageData(img.data, 60, 60, { maxParticles: 600, background: 'keep', density: 0.5 });
  assert.ok(full.count <= 600);
  assert.ok(half.count <= 300);
  assert.ok(half.count < full.count);
});


test('自动扣背景：渐变暗背景从边缘泛洪扣掉，主体保留', () => {
  const img = makeImage(40, 40, (x, y) => {
    const center = Math.hypot(x - 20, y - 20);
    if (center < 8) return [255, 200, 80, 255];
    const v = 15 + Math.floor((y / 39) * 50); // 垂直渐变背景
    return [v, v, v + 8, 255];
  });
  const keep = sampleImageData(img.data, img.width, img.height, { background: 'keep' });
  const auto = sampleImageData(img.data, img.width, img.height, {
    background: 'auto',
    backgroundTolerance: 0.2,
  });
  assert.ok(auto.count > 0, '主体应保留');
  assert.ok(auto.background && auto.background.mode === 'flood', '应使用泛洪扣背景');
  assert.ok(auto.count < keep.count * 0.5, `自动 ${auto.count} 应明显少于保留 ${keep.count}`);
});

test('扣背景容差：容差越大扣得越多', () => {
  const img = makeImage(40, 40, (x, y) => {
    const center = Math.hypot(x - 20, y - 20);
    if (center < 7) return [240, 230, 210, 255];
    const v = 18 + ((x * 7 + y * 3) % 26); // 带一点纹理的暗背景
    return [v + 6, v, v + 3, 255];
  });
  const low = sampleImageData(img.data, img.width, img.height, { background: 'auto', backgroundTolerance: 0.05 });
  const high = sampleImageData(img.data, img.width, img.height, { background: 'auto', backgroundTolerance: 0.45 });
  assert.ok(low.count > 0 && high.count > 0);
  assert.ok(low.count >= high.count, `容差 0.05 应保留更多（${low.count} >= ${high.count}）`);
});

test('透明图：半透明边缘像素按 alpha 遮罩丢弃，不做颜色扣背景', () => {
  const img = makeImage(6, 2, (x) => (x < 3 ? [255, 255, 255, 255] : [255, 255, 255, 51])); // alpha 0.2
  const out = sampleImageData(img.data, img.width, img.height, { background: 'auto' });
  assert.equal(out.count, 6, '前 3 像素 × 2 行');
  assert.ok(out.background === null || out.background.mode !== 'flood', '透明图不应使用泛洪');
});


test('只取轮廓：粒子明显减少且保留轮廓', () => {
  const img = makeImage(40, 40, (x, y) => (Math.hypot(x - 20, y - 20) < 12 ? [220, 220, 220, 255] : [20, 20, 20, 255]));
  const all = sampleImageData(img.data, img.width, img.height, { background: 'keep' });
  const edge = sampleImageData(img.data, img.width, img.height, { background: 'keep', outlineOnly: true });
  assert.ok(edge.count > 0);
  assert.ok(edge.count < all.count * 0.4, `轮廓 ${edge.count} 应远少于全部 ${all.count}`);
});
