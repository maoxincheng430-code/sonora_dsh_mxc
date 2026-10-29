import './library.css';
import {
  filterTracks,
  formatAddedAt,
  formatBytes,
  formatDuration,
  sortTracks,
  summarizeTracks,
} from './library-model.js';

const SORT_OPTIONS = [
  ['added', '最近添加'],
  ['title', '标题'],
  ['duration', '时长'],
  ['plays', '播放次数'],
];

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/>',
  sort: '<path d="M4 7h16M4 12h10M4 17h6"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M5 20h14"/>',
  music: '<path d="M9 18V5l11-2v13"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  lock: '<rect x="6" y="10" width="12" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
};

const svg = (name, className = '') => `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const displayTitle = (track) => String(track.title || track.name || '未命名歌曲');

export function createLibraryUI({ onSelect, onDelete, onRename, onImport } = {}) {
  const opener = document.createElement('button');
  opener.type = 'button';
  opener.className = 'upload-link library-open catalog-open';
  opener.dataset.libraryOpen = '';
  opener.setAttribute('aria-label', '音乐库');
  opener.title = '打开我的曲库';
  opener.innerHTML = `${svg('music', 'catalog-open-icon')}<span class="catalog-open-label">曲库</span>`;
  const anchor = document.querySelector('.track-text');
  (anchor || document.body).append(opener);
  const openerLabel = opener.querySelector('.catalog-open-label');

  const dialog = document.createElement('dialog');
  dialog.className = 'library-drawer catalog-drawer';
  dialog.setAttribute('aria-labelledby', 'library-title');
  dialog.innerHTML = `
    <div class="catalog-shell">
      <header class="catalog-header">
        <div class="catalog-heading">
          <span class="catalog-kicker">SONORA · 曲库</span>
          <h2 id="library-title">我的曲库</h2>
          <p class="catalog-subtitle">本地目录 · 自动保存</p>
        </div>
        <button type="button" class="catalog-close" aria-label="关闭音乐库" title="关闭音乐库">×</button>
      </header>
      <section class="catalog-stats" aria-label="曲库统计">
        <div class="catalog-stat"><strong data-library-count>0 首歌曲</strong><span>歌曲数量</span></div>
        <div class="catalog-stat"><strong data-library-duration>0:00</strong><span>总时长</span></div>
        <div class="catalog-stat"><strong data-library-size>0 B</strong><span>占用空间</span></div>
      </section>
      <div class="catalog-toolbar">
        <label class="catalog-search">
          <span class="sr-only">搜索歌名或歌手</span>
          ${svg('search', 'catalog-field-icon')}
          <input type="search" data-library-search placeholder="搜索歌名 / 歌手" autocomplete="off" spellcheck="false">
        </label>
        <div class="catalog-tools">
          <label class="catalog-sort">
            <span class="sr-only">排序方式</span>
            ${svg('sort', 'catalog-field-icon')}
            <select data-library-sort>
              ${SORT_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="catalog-import" data-library-import aria-label="批量导入歌曲">${svg('upload')}<span>导入歌曲</span></button>
        </div>
        <input class="sr-only" data-library-file type="file" multiple accept="audio/*,video/mp4,video/quicktime,video/webm,.mp3,.wav,.ogg,.flac,.m4a,.m4b,.aac,.mp4,.m4v,.mov,.webm" aria-label="选择要导入的音频或视频文件" tabindex="-1">
      </div>
      <p class="catalog-notice" data-library-result role="status" hidden></p>
      <p class="catalog-status" data-library-status>正在读取曲库…</p>
      <div class="catalog-scroll">
        <ul class="library-list catalog-list"></ul>
        <div class="catalog-empty" data-library-empty hidden>
          <span class="catalog-empty-icon" aria-hidden="true">${svg('music')}</span>
          <strong data-library-empty-title>曲库还是空的</strong>
          <span data-library-empty-text>导入本地音频，就会在这里整理成你的目录。</span>
        </div>
      </div>
      <footer class="catalog-footer">
        <span>${svg('lock')}纯本地保存 · 清除网站数据会移除曲库，请保留原始文件</span>
        <span>MP3 / WAV / OGG / FLAC / M4A / MP4</span>
      </footer>
    </div>`;
  document.body.append(dialog);

  const $ = (selector) => dialog.querySelector(selector);
  const countEl = $('[data-library-count]');
  const durationEl = $('[data-library-duration]');
  const sizeEl = $('[data-library-size]');
  const statusEl = $('[data-library-status]');
  const noticeEl = $('[data-library-result]');
  const searchInput = $('[data-library-search]');
  const sortSelect = $('[data-library-sort]');
  const importButton = $('[data-library-import]');
  const fileInput = $('[data-library-file]');
  const closeButton = $('.catalog-close');
  const listEl = $('.catalog-list');
  const emptyEl = $('[data-library-empty]');

  const listeners = [];
  const on = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    listeners.push(() => target.removeEventListener(event, handler, options));
  };

  let tracksState = [];
  let activeId = null;
  let errorText = '';
  let query = '';
  let sortKey = 'added';
  let importing = false;
  let importTotal = 0;
  let renamingId = null;
  let renameDraft = '';
  let noticeTimer;
  let rendered = false;

  const visibleTracks = () => sortTracks(filterTracks(tracksState, query), sortKey);

  function syncOpener(count) {
    openerLabel.textContent = count ? `曲库 · ${count} 首` : '曲库';
    opener.dataset.libraryOpenCount = String(count);
    opener.title = count ? `打开我的曲库（${count} 首歌曲）` : '打开我的曲库';
  }

  function renderSummary() {
    const summary = summarizeTracks(tracksState);
    countEl.textContent = `${summary.count} 首歌曲`;
    durationEl.textContent = formatDuration(summary.duration);
    sizeEl.textContent = formatBytes(summary.size);
    syncOpener(summary.count);
  }

  function statusText() {
    if (errorText) return errorText;
    if (importing) return importTotal ? `正在导入 ${importTotal} 首…` : '正在导入…';
    if (!tracksState.length) return '还没有保存的歌曲';
    if (!visibleTracks().length) return '没有找到匹配的歌曲';
    return '选择歌曲载入，再点击播放器播放';
  }

  function updateStatus() {
    statusEl.textContent = statusText();
    statusEl.classList.toggle('is-error', Boolean(errorText));
  }

  function showNotice(message) {
    clearTimeout(noticeTimer);
    noticeEl.textContent = message;
    noticeEl.hidden = false;
    noticeTimer = setTimeout(() => {
      noticeEl.hidden = true;
      noticeEl.textContent = '';
    }, 6000);
  }

  function reportImport(result, total) {
    if (!result || typeof result !== 'object') {
      showNotice(`已提交 ${total} 首歌曲，正在整理曲库。`);
      return;
    }
    const added = Math.max(0, Number(result.added) || 0);
    const skipped = Math.max(0, Number(result.skipped) || 0);
    const failed = Math.max(0, Number(result.failed) || 0);
    const parts = [];
    if (added) parts.push(`新增 ${added} 首`);
    if (skipped) parts.push(`跳过 ${skipped} 首`);
    if (failed) parts.push(`失败 ${failed} 首`);
    showNotice(parts.length ? `导入完成：${parts.join('，')}。` : '导入完成，没有新增歌曲。');
  }

  function renderList() {
    const visible = visibleTracks();
    listEl.replaceChildren();
    listEl.hidden = visible.length === 0;
    emptyEl.hidden = visible.length > 0;
    const emptyTitle = $('[data-library-empty-title]');
    const emptyText = $('[data-library-empty-text]');
    if (!tracksState.length) {
      emptyTitle.textContent = '曲库还是空的';
      emptyText.textContent = '导入本地音频，就会在这里整理成你的目录。';
    } else if (!visible.length) {
      emptyTitle.textContent = '换个关键词试试';
      emptyText.textContent = '清空搜索可以查看全部歌曲。';
    }
    for (const track of visible) listEl.append(createRow(track));
    updateStatus();
    if (renamingId) {
      const input = listEl.querySelector('.catalog-rename-input');
      if (input) {
        input.focus({ preventScroll: true });
        input.select();
      }
    }
  }

  function createRow(track) {
    const title = displayTitle(track);
    const row = document.createElement('li');
    row.className = 'library-row catalog-row';
    row.dataset.trackId = track.id;
    if (track.id === activeId) row.classList.add('active');
    if (track.id === renamingId) {
      row.classList.add('renaming');
      row.append(createRenameForm(track));
      return row;
    }
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'library-song catalog-song';
    select.dataset.librarySelect = track.id;
    select.setAttribute('aria-pressed', String(track.id === activeId));
    if (track.id === activeId) select.setAttribute('aria-current', 'true');
    select.setAttribute('aria-label', track.artist ? `播放 ${title} - ${track.artist}` : `播放 ${title}`);
    select.title = '载入这首歌曲';
    select.innerHTML = `
      <span class="catalog-art" aria-hidden="true">${svg('music')}</span>
      <span class="catalog-song-body">
        <span class="catalog-song-line">
          <span class="catalog-song-title">${escapeHtml(title)}</span>
          ${track.id === activeId ? '<span class="catalog-current">当前歌曲</span>' : ''}
        </span>
        <span class="catalog-song-artist">${escapeHtml(track.artist || '未知歌手')}</span>
        <span class="catalog-song-meta">
          <span>${formatDuration(track.duration)}</span>
          <span>${formatBytes(track.size)}</span>
          <span>播放 ${Math.max(0, Number(track.playCount) || 0)} 次</span>
          <span>添加于 ${formatAddedAt(track.addedAt) || '未知'}</span>
        </span>
      </span>`;
    select.addEventListener('click', () => onSelect?.(track.id));

    const actions = document.createElement('div');
    actions.className = 'catalog-actions';
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'catalog-action catalog-rename-button';
    rename.dataset.libraryRename = track.id;
    rename.textContent = '重命名';
    rename.setAttribute('aria-label', `重命名 ${title}`);
    rename.addEventListener('click', () => startRename(track));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'library-delete catalog-delete';
    remove.dataset.libraryDelete = track.id;
    remove.textContent = '删除';
    remove.setAttribute('aria-label', `删除 ${title}`);
    remove.addEventListener('click', () => {
      if (window.confirm(`从曲库删除“${title}”？\n仅删除浏览器副本，不影响电脑原始文件。`)) onDelete?.(track.id);
    });
    actions.append(rename, remove);
    row.append(select, actions);
    return row;
  }

  function startRename(track) {
    renamingId = track.id;
    renameDraft = displayTitle(track);
    renderList();
  }

  function createRenameForm(track) {
    const form = document.createElement('form');
    form.className = 'catalog-rename';
    form.dataset.libraryRenameForm = '';
    form.noValidate = true;
    form.innerHTML = `
      <span class="catalog-rename-label">重命名歌曲</span>
      <input type="text" class="catalog-rename-input" data-library-rename-input value="${escapeHtml(renameDraft)}" maxlength="120" autocomplete="off" spellcheck="false" aria-label="新歌名">
      <div class="catalog-rename-actions">
        <button type="submit" class="catalog-rename-save" data-library-rename-save>保存</button>
        <button type="button" class="catalog-rename-cancel" data-library-rename-cancel>取消</button>
      </div>`;
    const input = form.querySelector('.catalog-rename-input');
    const save = form.querySelector('.catalog-rename-save');
    const cancel = form.querySelector('.catalog-rename-cancel');
    let pending = false;
    const finish = () => {
      if (pending) return;
      renamingId = null;
      renameDraft = '';
      renderList();
    };
    input.addEventListener('input', () => { renameDraft = input.value; });
    cancel.addEventListener('click', finish);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (pending) return;
      const title = input.value.trim();
      if (!title) {
        showNotice('歌名不能为空。');
        input.focus();
        return;
      }
      if (title === displayTitle(track)) {
        finish();
        return;
      }
      pending = true;
      form.classList.add('is-pending');
      input.disabled = true;
      save.disabled = true;
      cancel.disabled = true;
      try {
        const updated = await onRename?.(track.id, { title });
        if (updated === null || updated === false) throw new Error('重命名失败，请稍后重试。');
        const patch = updated && typeof updated === 'object' ? updated : { title };
        tracksState = tracksState.map((item) => (item.id === track.id
          ? { ...item, ...patch, title: patch.title || title }
          : item));
        renamingId = null;
        renameDraft = '';
        renderSummary();
        renderList();
        showNotice('已更新歌名。');
      } catch (error) {
        pending = false;
        form.classList.remove('is-pending');
        input.disabled = false;
        save.disabled = false;
        cancel.disabled = false;
        showNotice(error?.message || '重命名失败，请稍后重试。');
        input.focus();
      }
    });
    return form;
  }

  function render(tracks, nextActiveId, error = '') {
    tracksState = Array.isArray(tracks) ? tracks : [];
    activeId = nextActiveId ?? null;
    errorText = String(error ?? '');
    rendered = true;
    renderSummary();
    renderList();
  }

  const show = () => {
    if (!dialog.open) dialog.showModal();
    if (rendered) renderList();
  };
  const hide = () => {
    if (dialog.open) dialog.close();
  };

  on(opener, 'click', show);
  on(closeButton, 'click', hide);
  // 重命名时 Esc 只取消编辑，不关闭整个抽屉；其余情况交给 dialog 原生 Esc 关闭。
  on(dialog, 'keydown', (event) => {
    if (event.key !== 'Escape' || !renamingId) return;
    event.preventDefault();
    event.stopPropagation();
    renamingId = null;
    renameDraft = '';
    renderList();
  }, true);
  on(dialog, 'click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left) hide();
  });
  on(dialog, 'close', () => {
    if (!renamingId) return;
    renamingId = null;
    renameDraft = '';
  });
  on(searchInput, 'input', () => {
    query = searchInput.value;
    renderList();
  });
  on(sortSelect, 'change', () => {
    sortKey = sortSelect.value;
    renderList();
  });
  on(importButton, 'click', () => {
    if (!importing) fileInput.click();
  });
  on(fileInput, 'change', async () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = '';
    if (!files.length || importing) return;
    if (typeof onImport !== 'function') {
      showNotice('导入功能尚未接入，请稍后再试。');
      return;
    }
    importing = true;
    importTotal = files.length;
    importButton.disabled = true;
    importButton.classList.add('is-busy');
    updateStatus();
    try {
      const result = await onImport(files);
      reportImport(result, files.length);
    } catch (error) {
      showNotice(error?.message || '导入失败，请稍后重试。');
    } finally {
      importing = false;
      importTotal = 0;
      importButton.disabled = false;
      importButton.classList.remove('is-busy');
      updateStatus();
    }
  });

  return {
    render,
    dispose() {
      clearTimeout(noticeTimer);
      listeners.splice(0).forEach((remove) => remove());
      dialog.remove();
      opener.remove();
    },
  };
}
