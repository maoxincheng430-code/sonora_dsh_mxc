// 背景与氛围选择器：点导航栏「氛围」打开。
// 三个部分：氛围场景（默认/雨/雷/海滩/图书馆）、内置背景图库、我的背景（本地上传）。
import './background-picker.css';

import { SCENE_OPTIONS, PRESET_BACKGROUNDS, findPreset, presetUrl } from './background-presets.js';

export { SCENE_OPTIONS, PRESET_BACKGROUNDS, findPreset, presetUrl };

const SCENE_THUMBS = {
  none: 'radial-gradient(circle at 50% 42%, #1b2036, #070a14 72%)',
  rain: 'linear-gradient(165deg, #2b3d55, #0c1424 72%)',
  thunder: 'linear-gradient(165deg, #3a2b50, #0b0d1c 72%)',
  beach: 'linear-gradient(180deg, #3a2340 0%, #a3495a 42%, #ff9e63 68%, #e8c79b 71%, #c99a6d 100%)',
  library: 'linear-gradient(165deg, #3b2f24, #15110d 72%)',
};

// options: { getScene, getPreset, getCustom, onScene, onPreset, onUpload, onClear, onOpen }
// getCustom(): { name, thumbUrl } | null
export function createBackgroundPicker(options = {}) {
  const {
    getScene = () => 'none',
    getPreset = () => '',
    getCustom = () => null,
    onScene = () => {},
    onPreset = () => {},
    onUpload = () => {},
    onClear = () => {},
    onOpen = null,
  } = options;

  const root = document.createElement('div');
  root.className = 'bg-picker';
  root.hidden = true;
  root.innerHTML = `
    <div class="bg-picker-mask" data-bg-close></div>
    <section class="bg-picker-card" role="dialog" aria-modal="true" aria-labelledby="bg-picker-title">
      <header class="bg-picker-head">
        <h3 id="bg-picker-title">背景与氛围</h3>
        <span class="bg-picker-sub">默认是粒子宇宙；也可以换成场景、内置图或自己的图片</span>
        <button type="button" class="bg-picker-x" data-bg-close aria-label="关闭">×</button>
      </header>
      <div class="bg-picker-body">
        <p class="bg-picker-label">氛围场景</p>
        <div class="bg-scenes">${SCENE_OPTIONS.map(
          (item) => `
          <button type="button" class="bg-card" data-scene="${item.id}">
            <span class="bg-thumb" data-scene-thumb="${item.id}"></span>
            <span class="bg-card-name">${item.name}</span>
            <span class="bg-card-desc">${item.desc}</span>
            <span class="bg-check" aria-hidden="true"></span>
          </button>`,
        ).join('')}</div>

        <p class="bg-picker-label">背景图库 <span>内置抽象渐变 · 可自由使用</span></p>
        <div class="bg-presets">${PRESET_BACKGROUNDS.map(
          (item) => `
          <button type="button" class="bg-card bg-card-preset" data-preset="${item.id}">
            <span class="bg-thumb"><img alt="" src="${presetUrl(item)}" /></span>
            <span class="bg-card-name">${item.name}</span>
            <span class="bg-check" aria-hidden="true"></span>
          </button>`,
        ).join('')}</div>

        <p class="bg-picker-label">我的背景 <span>本地上传 · 只存在你的浏览器</span></p>
        <div class="bg-custom">
          <button type="button" class="bg-upload" data-bg-upload>+ 上传图片 / 视频</button>
          <div class="bg-custom-card" data-custom-card hidden>
            <span class="bg-custom-thumb" data-custom-thumb></span>
            <span class="bg-custom-name" data-custom-name></span>
            <button type="button" class="bg-custom-use" data-custom-use>使用</button>
            <button type="button" class="bg-custom-del" data-custom-del aria-label="删除我的背景">删除</button>
          </div>
          <input class="sr-only" type="file" accept="image/*,video/*" data-bg-file aria-label="上传背景图片或视频" />
        </div>
      </div>
    </section>`;

  const bodyEl = root.querySelector('.bg-picker-body');
  const fileEl = root.querySelector('[data-bg-file]');
  const customCard = root.querySelector('[data-custom-card]');
  const customThumb = root.querySelector('[data-custom-thumb]');
  const customName = root.querySelector('[data-custom-name]');

  // 场景缩略图背景
  for (const item of SCENE_OPTIONS) {
    const thumb = root.querySelector(`[data-scene-thumb="${item.id}"]`);
    if (thumb) thumb.style.background = SCENE_THUMBS[item.id] || SCENE_THUMBS.none;
  }

  let openState = false;

  function customInfo() {
    const custom = getCustom?.();
    return custom && custom.name ? custom : null;
  }

  function sync() {
    const scene = getScene();
    const preset = getPreset();
    const custom = customInfo();
    const isImage = scene === 'image';
    root.querySelectorAll('[data-scene]').forEach((button) => {
      const active = !isImage && button.dataset.scene === scene;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    root.querySelectorAll('[data-preset]').forEach((button) => {
      const active = isImage && button.dataset.preset === preset;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    customCard.hidden = !custom;
    if (custom) {
      customName.textContent = custom.name;
      customThumb.style.background = custom.thumbUrl
        ? `center / cover no-repeat url("${custom.thumbUrl}")`
        : 'linear-gradient(140deg, #2a3048, #121725)';
    }
  }

  function open() {
    if (openState) return;
    openState = true;
    root.hidden = false;
    root.classList.add('is-open');
    document.body.classList.add('bg-picker-open');
    sync();
    onOpen?.();
    requestAnimationFrame(() => root.classList.add('is-shown'));
  }

  function close() {
    if (!openState) return;
    openState = false;
    root.classList.remove('is-shown');
    root.classList.remove('is-open');
    document.body.classList.remove('bg-picker-open');
    setTimeout(() => {
      if (!openState) root.hidden = true;
    }, 220);
  }

  function onRootClick(event) {
    const closeBtn = event.target.closest?.('[data-bg-close]');
    if (closeBtn) {
      close();
      return;
    }
    const sceneBtn = event.target.closest?.('[data-scene]');
    if (sceneBtn) {
      onScene(sceneBtn.dataset.scene);
      sync();
      close();
      return;
    }
    const presetBtn = event.target.closest?.('[data-preset]');
    if (presetBtn) {
      onPreset(presetBtn.dataset.preset);
      sync();
      close();
      return;
    }
    if (event.target.closest?.('[data-bg-upload]')) {
      fileEl?.click?.();
      return;
    }
    if (event.target.closest?.('[data-custom-use]')) {
      onScene('image');
      sync();
      close();
      return;
    }
    if (event.target.closest?.('[data-custom-del]')) {
      onClear();
      sync();
    }
  }

  function onFileChange() {
    const file = fileEl?.files?.[0];
    if (fileEl) fileEl.value = '';
    if (!file) return;
    onUpload(file);
    sync();
    close();
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !openState) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  function attach(host = document.body) {
    host.appendChild(root);
    return api;
  }

  function dispose() {
    root.removeEventListener('click', onRootClick);
    fileEl?.removeEventListener('change', onFileChange);
    document.removeEventListener('keydown', onKeyDown, true);
    root.remove();
  }

  root.addEventListener('click', onRootClick);
  fileEl?.addEventListener('change', onFileChange);
  document.addEventListener('keydown', onKeyDown, true);

  const api = { root, open, close, sync, attach, dispose, isOpen: () => openState };
  return api;
}
