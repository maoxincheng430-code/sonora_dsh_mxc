// 大肥鱼互动吉祥物测试：纯函数（lookDirection / pickQuip）+ 组件行为
// （体型档位、点击说话、待机睡觉、无 DOM no-op）。
// 用最小假 DOM，不依赖浏览器。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MASCOT_COMBO_QUIPS,
  MASCOT_QUIPS,
  MASCOT_SCENES,
  MASCOT_SIZES,
  createMascotPet,
  lookDirection,
  pickQuip,
} from '../src/mascot-pet.js';

// ---------- 纯函数 ----------

test('MASCOT_SIZES 三档齐全，体型依次变大', () => {
  assert.deepEqual(Object.keys(MASCOT_SIZES), ['small', 'medium', 'large']);
  assert.equal(MASCOT_SIZES.small.label, '小肥鱼');
  assert.equal(MASCOT_SIZES.medium.label, '肥鱼');
  assert.equal(MASCOT_SIZES.large.label, '大肥鱼');
  assert.ok(MASCOT_SIZES.small.scale < MASCOT_SIZES.medium.scale);
  assert.ok(MASCOT_SIZES.medium.scale < MASCOT_SIZES.large.scale);
  for (const meta of Object.values(MASCOT_SIZES)) {
    assert.ok(meta.quip.length > 0, '每档都有一句台词');
  }
});

test('lookDirection 指针在正右方时向右偏移，正上方时向上偏移', () => {
  const box = { left: 0, top: 0, width: 100, height: 100 };
  const right = lookDirection({ x: 500, y: 50 }, box);
  assert.ok(right.dx > 0, '应向右');
  assert.equal(Math.abs(right.dy) < 0.001, true, '纵向基本不偏');

  const up = lookDirection({ x: 50, y: -500 }, box);
  assert.ok(up.dy < 0, '应向上');
  assert.equal(Math.abs(up.dx) < 0.001, true, '横向基本不偏');
});

test('lookDirection 偏移量受 maxOffset 限制，非法输入归零', () => {
  const box = { left: 0, top: 0, width: 100, height: 100 };
  const far = lookDirection({ x: 99999, y: 50 }, box, 6);
  assert.ok(Math.hypot(far.dx, far.dy) <= 6.0001, '不超过 maxOffset');

  // 指针正好在中心：无方向可言。
  const center = lookDirection({ x: 50, y: 50 }, box);
  assert.deepEqual({ dx: center.dx, dy: center.dy }, { dx: 0, dy: 0 });

  // NaN 输入不应产生 NaN 输出。
  const bad = lookDirection({ x: NaN, y: NaN }, box);
  assert.equal(Number.isFinite(bad.dx), true);
  assert.equal(Number.isFinite(bad.dy), true);
});

test('pickQuip 随机取一句且避开上一句', () => {
  const pool = ['a', 'b', 'c'];
  for (let i = 0; i < 50; i++) {
    const next = pickQuip(pool, 'a');
    assert.notEqual(next, 'a', '不应连续说同一句');
    assert.ok(pool.includes(next));
  }
  // 单句池只能返回它自己。
  assert.equal(pickQuip(['唯一'], '唯一'), '唯一');
  // 空池 / 非法输入返回空串。
  assert.equal(pickQuip([], 'x'), '');
  assert.equal(pickQuip(null, 'x'), '');
});

// ---------- 组件（假 DOM） ----------

function fakeDom() {
  const created = [];
  const element = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(),
      className: '',
      textContent: '',
      children: [],
      parent: null,
      style: {
        _props: {},
        setProperty(name, value) {
          this._props[name] = String(value);
        },
        getPropertyValue(name) {
          return this._props[name] ?? '';
        },
      },
      dataset: {},
      attributes: {},
      offsetWidth: 1,
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      getAttribute(name) {
        return this.attributes[name] ?? null;
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
      append(...nodes) {
        for (const node of nodes) {
          if (!node) continue;
          node.parent = el;
          el.children.push(node);
        }
      },
      remove() {
        if (!el.parent) return;
        const siblings = el.parent.children;
        const index = siblings.indexOf(el);
        if (index >= 0) siblings.splice(index, 1);
        el.parent = null;
      },
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 68, height: 78 }),
      classList: {
        _set: new Set(),
        add(name) {
          this._set.add(name);
          el.className = [...this._set].join(' ');
        },
        remove(name) {
          this._set.delete(name);
          el.className = [...this._set].join(' ');
        },
        toggle(name, force) {
          const should = force === undefined ? !this._set.has(name) : Boolean(force);
          if (should) this.add(name);
          else this.remove(name);
          return should;
        },
        contains(name) {
          return this._set.has(name);
        },
      },
    };
    created.push(el);
    return el;
  };
  const doc = { createElement: element };
  return { doc, created };
}

test('吉祥物组件：结构齐全，初始体型跟随 size', () => {
  const fake = fakeDom();
  const pet = createMascotPet({ document: fake.doc, size: 'large' });
  assert.ok(pet.el, '根节点存在');
  assert.equal(pet.el.dataset.size, 'large');
  assert.equal(
    pet.el.style.getPropertyValue('--pet-scale'),
    String(MASCOT_SIZES.large.scale),
    '体型变量按档位设置',
  );
  assert.match(pet.el.getAttribute('aria-label'), /大肥鱼/);
  pet.dispose();
});

test('吉祥物组件：setSize 切换档位与体型，非法值忽略', () => {
  const fake = fakeDom();
  const pet = createMascotPet({ document: fake.doc, size: 'small' });
  pet.setSize('large');
  assert.equal(pet.el.dataset.size, 'large');
  assert.equal(pet.el.style.getPropertyValue('--pet-scale'), String(MASCOT_SIZES.large.scale));

  pet.setSize('不存在的档位');
  assert.equal(pet.el.dataset.size, 'large', '非法值不应改变档位');
  pet.dispose();
});

test('吉祥物组件：poke 会说一句话，dispose 后安全', () => {
  const fake = fakeDom();
  const pet = createMascotPet({ document: fake.doc });
  pet.poke();
  // 找到气泡文本节点（className 含 bubble-text）
  const bubbleText = fake.created.find((el) => el.className.includes('mascot-pet-bubble-text'));
  assert.ok(bubbleText.textContent.length > 0, 'poke 后气泡应有文字');
  assert.ok(MASCOT_QUIPS.includes(bubbleText.textContent) || bubbleText.textContent.length > 0);

  pet.dispose();
  assert.equal(pet.el, null, 'dispose 后 el 置空');
  pet.poke(); // 不应抛错
});

test('吉祥物组件：无 document 时返回 no-op API', () => {
  const pet = createMascotPet({ document: null });
  assert.equal(pet.el, null);
  assert.equal(pet.isSleeping(), false);
  pet.setSize('large');
  pet.poke();
  pet.dispose();
  assert.equal(pet.isSleeping(), false);
});
// ---------- 台词库规模与连击 / 情景 ----------

test('台词库足够丰富且无重复', () => {
  assert.ok(MASCOT_QUIPS.length >= 50, `金句应 >= 50，实际 ${MASCOT_QUIPS.length}`);
  assert.ok(MASCOT_COMBO_QUIPS.length >= 8, `连击应 >= 8，实际 ${MASCOT_COMBO_QUIPS.length}`);
  assert.ok(MASCOT_SCENES.length >= 10, `情景应 >= 10，实际 ${MASCOT_SCENES.length}`);
  for (const key of ['small', 'medium', 'large']) {
    assert.ok((MASCOT_SIZES[key].quips?.length ?? 0) >= 3, `${key} 档应有多句台词`);
  }
  // 每个情景台词都应是「用户的话 —— 回应」的结构。
  for (const line of MASCOT_SCENES) {
    assert.ok(line.includes('——'), '情景台词应包含分隔符');
    assert.ok(line.split('——')[1].trim().length > 0, '回应不能为空');
  }
  const all = [
    ...MASCOT_QUIPS,
    ...MASCOT_COMBO_QUIPS,
    ...MASCOT_SCENES,
    ...Object.values(MASCOT_SIZES).flatMap((meta) => meta.quips ?? []),
  ];
  assert.equal(new Set(all).size, all.length, '台词不应重复');
});

test('连击：连续点击会说递进台词，超长后循环', async () => {
  const fake = fakeDom();
  const pet = createMascotPet({ document: fake.doc });
  const bubbleText = () => fake.created.find((el) => el.className.includes('mascot-pet-bubble-text'));

  pet.poke();
  const first = bubbleText().textContent;
  assert.ok(first.length > 0);

  pet.poke();
  const second = bubbleText().textContent;
  assert.ok(second.length > 0);
  assert.ok(MASCOT_COMBO_QUIPS.includes(second), '第二次点击应说连击台词');

  // 多点几次不应抛错（超出连击池后循环）。
  for (let i = 0; i < 20; i++) pet.poke();
  assert.ok(bubbleText().textContent.length > 0);
  pet.dispose();
});

test('nextScene：按轮次依次返回情景台词并循环', () => {
  const fake = fakeDom();
  const pet = createMascotPet({ document: fake.doc });
  const lines = [];
  for (let i = 0; i < MASCOT_SCENES.length + 2; i++) lines.push(pet.nextScene());
  // 前 N 条与台词库顺序一致。
  for (let i = 0; i < MASCOT_SCENES.length; i++) {
    assert.equal(lines[i], MASCOT_SCENES[i]);
  }
  // 超出后从头循环。
  assert.equal(lines[MASCOT_SCENES.length], MASCOT_SCENES[0]);
  pet.dispose();
});

test('无 DOM 时 nextScene 也按轮次返回并循环', () => {
  const pet = createMascotPet({ document: null });
  const first = pet.nextScene();
  const second = pet.nextScene();
  assert.equal(first, MASCOT_SCENES[0]);
  assert.equal(second, MASCOT_SCENES[1]);
  pet.dispose();
});
