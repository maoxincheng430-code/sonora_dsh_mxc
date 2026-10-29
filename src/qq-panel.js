// QQ 音乐登录面板（对接本地 qq-api 服务，与 Folia 的登录方式一致）。
// 流程：/api/qq/status → 未登录时 /api/qq/qr/key → /api/qq/qr/create → 轮询 /api/qq/qr/check
//       （800 过期 / 801 等待 / 802 已扫码 / 803 成功）→ 成功后显示搜索与播放。

const POLL_INTERVAL = 2000;
const CHANNEL_LABELS = { qq: '手机 QQ', wechat: '微信', qqmusic: 'QQ 音乐 App' };

export function createQQPanel(options = {}) {
  const doc = options.document ?? (typeof document !== 'undefined' ? document : null);
  const fetchImpl = options.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const apiBase = String(options.apiBase ?? '').replace(/\/$/, '');
  const onPlaySong = typeof options.onPlaySong === 'function' ? options.onPlaySong : null;
  const onPickLocalFile = typeof options.onPickLocalFile === 'function' ? options.onPickLocalFile : null;
  if (!doc) throw new Error('createQQPanel 需要 document');

  const root = doc.createElement('div');
  root.className = 'qq-backdrop';
  root.hidden = true;
  root.innerHTML = `
    <section class="qq-panel" role="dialog" aria-modal="true" aria-label="QQ 音乐">
      <header class="qq-head"><h2>QQ 音乐</h2><button class="qq-close" type="button" data-qq-close aria-label="关闭">×</button></header>
      <div class="qq-body">
        <section class="qq-login" data-qq-login>
          <p class="qq-status" data-qq-status role="status">正在连接 QQ 音乐服务…</p>
          <p class="qq-hint qq-login-purpose">登录用途：在网页内搜索并播放 QQ 音乐（音源 + 歌词 + 粒子同步）；不登录只能搜索，多数歌曲拿不到播放地址。只想播本地文件可以关掉本面板。</p>
          <div class="qq-qr" data-qq-qr-wrap hidden><img data-qq-qr alt="QQ 音乐登录二维码" width="180" height="180"></div>
          <div class="qq-channels" data-qq-channels></div>
          <button class="qq-button" type="button" data-qq-refresh>刷新二维码</button>
          <p class="qq-tip" data-qq-tip>用手机扫码并在手机上确认登录。</p>
        </section>
        <section class="qq-main" data-qq-main hidden>
          <div class="qq-user"><span data-qq-user>已登录</span><button class="qq-link" type="button" data-qq-logout>退出登录</button></div>
          <form class="qq-search" data-qq-form>
            <input class="qq-input" data-qq-kw placeholder="搜索歌曲 / 歌手" aria-label="搜索 QQ 音乐" />
            <button class="qq-button qq-button-primary" type="submit">搜索</button>
          </form>
          <ul class="qq-results" data-qq-results></ul>
          <p class="qq-error" data-qq-error role="alert" hidden></p>
          <p class="qq-hint" data-qq-note>点击歌曲即可在本页播放，并自动加载歌词。</p>
          <button class="qq-button qq-local" type="button" data-qq-local>播不出来？用本地文件渲染同一首歌</button>
        </section>
      </div>
    </section>`;
  doc.body.appendChild(root);

  const $ = (selector) => root.querySelector(selector);
  const statusEl = $('[data-qq-status]');
  const qrWrap = $('[data-qq-qr-wrap]');
  const qrImg = $('[data-qq-qr]');
  const loginSection = $('[data-qq-login]');
  const mainSection = $('[data-qq-main]');
  const resultsEl = $('[data-qq-results]');
  const userEl = $('[data-qq-user]');
  const noteEl = $('[data-qq-note]');
  const tipEl = $('[data-qq-tip]');
  const channelsEl = $('[data-qq-channels]');
  const errorEl = $('[data-qq-error]');
  const localButton = $('[data-qq-local]');
  let pollTimer = null;
  let currentKey = null;
  let channel = 'qq';
  let availableChannels = ['qq', 'wechat', 'qqmusic'];
  let open = false;

  function clearPlayError() {
    if (!errorEl) return;
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  function showPlayError(message) {
    if (!errorEl) return;
    errorEl.hidden = false;
    errorEl.textContent = `播放失败：${message}。常见原因：VIP/版权限制、登录态过期、该曲目无播放地址。可以重新登录，或用下面的按钮导入本地文件继续渲染。`;
  }

  const setStatus = (text) => {
    statusEl.textContent = text;
  };

  async function request(path, init) {
    const response = await fetchImpl(`${apiBase}${path}`, init);
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) throw new Error(data?.error || `请求失败（${response.status}）`);
    return data;
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function renderChannels() {
    channelsEl.innerHTML = '';
    for (const id of availableChannels) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = `qq-channel${id === channel ? ' active' : ''}`;
      button.dataset.channel = id;
      button.textContent = CHANNEL_LABELS[id] || id;
      button.addEventListener('click', () => {
        if (channel === id) return;
        channel = id;
        renderChannels();
        refreshQr();
      });
      channelsEl.appendChild(button);
    }
  }

  function showLogin() {
    loginSection.hidden = false;
    mainSection.hidden = true;
  }

  function showMain(status) {
    loginSection.hidden = true;
    mainSection.hidden = false;
    const name = status?.nickname || status?.profile?.nickname || '';
    const uin = status?.uin || status?.profile?.uin || '';
    userEl.textContent = name ? `已登录：${name}` : uin ? `已登录 · UIN ${uin}` : '已登录';
    renderChannels();
  }

  async function refreshStatus() {
    const status = await request('/api/qq/status', { method: 'GET' });
    if (!status.available) {
      showLogin();
      setStatus(status.reason || 'QQ 音乐服务不可用');
      qrWrap.hidden = true;
      return status;
    }
    availableChannels = status.channels?.length ? status.channels : availableChannels;
    if (status.loggedIn) {
      showMain(status);
      setStatus('登录成功');
    } else {
      showLogin();
    }
    return status;
  }

  async function refreshQr() {
    stopPolling();
    if (currentKey) {
      request(`/api/qq/qr/cancel?key=${encodeURIComponent(currentKey)}`, { method: 'GET' }).catch(() => {});
      currentKey = null;
    }
    qrWrap.hidden = true;
    setStatus('正在获取二维码…');
    try {
      const { key } = await request(`/api/qq/qr/key?channel=${encodeURIComponent(channel)}`, { method: 'GET' });
      currentKey = key;
      const { image } = await request(`/api/qq/qr/create?key=${encodeURIComponent(key)}`, { method: 'GET' });
      qrImg.src = image;
      qrWrap.hidden = false;
      setStatus('请用手机扫描二维码');
      tipEl.textContent = `当前通道：${CHANNEL_LABELS[channel] || channel}，扫码后请在手机上确认。`;
      pollTimer = setInterval(pollQr, POLL_INTERVAL);
    } catch (error) {
      // 「Failed to fetch」对用户没有任何指导意义——它几乎总是意味着本地的
      // services 没起来（tools/qq-api 依赖没装，或没跑 npm run server）。
      // 这里翻译成可以直接照做的提示。
      const offline = /failed to fetch|networkerror|load failed|network request failed/i.test(
        String(error?.message || ''),
      );
      if (offline) {
        setStatus('连不上本地服务，暂时拿不到二维码');
        tipEl.textContent =
          '在线音乐需要先启动本地服务：Windows 双击「点这里启动喵/安装在线音乐依赖.cmd」装依赖，再双击「启动网站.cmd」；命令行用户跑 npm run qq:setup 然后 npm run server。';
        tipEl.dataset.offline = '1';
      } else {
        setStatus(`获取二维码失败：${error.message}`);
        tipEl.textContent = '请确认本地 qq-api 服务已启动（npm run server 会自动拉起）。';
        delete tipEl.dataset.offline;
      }
    }
  }

  async function pollQr() {
    if (!currentKey) return;
    try {
      const result = await request(`/api/qq/qr/check?key=${encodeURIComponent(currentKey)}`, { method: 'GET' });
      if (result.state === 'waiting') {
        setStatus('等待扫码…');
        return;
      }
      if (result.state === 'scanned') {
        setStatus('已扫码，请在手机上确认登录');
        return;
      }
      stopPolling();
      currentKey = null;
      if (result.state === 'ok') {
        const status = await refreshStatus();
        if (status?.loggedIn) {
          setStatus('登录成功');
          return;
        }
        setStatus('登录状态同步失败，请重试。');
        await refreshQr();
        return;
      }
      if (result.state === 'expired') {
        setStatus('二维码已过期，正在刷新…');
        await refreshQr();
        return;
      }
      setStatus(result.message || '扫码失败，请重试。');
      await refreshQr();
    } catch (error) {
      stopPolling();
      setStatus(`扫码状态获取失败：${error.message}`);
    }
  }

  async function search(keyword) {
    const text = String(keyword || '').trim();
    if (!text) return;
    clearPlayError();
    resultsEl.innerHTML = '<li class="qq-empty">搜索中…</li>';
    try {
      const data = await request(`/api/qq/search?keyword=${encodeURIComponent(text)}&limit=20`, { method: 'GET' });
      const songs = data?.songs ?? [];
      if (!songs.length) {
        resultsEl.innerHTML = '<li class="qq-empty">没有找到歌曲</li>';
        return;
      }
      resultsEl.innerHTML = '';
      for (const song of songs) {
        const li = doc.createElement('li');
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'qq-song';
        button.innerHTML = `<span class="qq-song-name">${escapeHtml(song.name)}</span><span class="qq-song-singer">${escapeHtml(song.singer)}</span>`;
        button.addEventListener('click', async () => {
          button.classList.add('loading');
          noteEl.textContent = `正在加载：${song.name}`;
          clearPlayError();
          try {
            await onPlaySong?.(song);
            noteEl.textContent = `正在播放：${song.name} — ${song.singer}`;
            // 播放成功后收起面板，让歌词与粒子直接露出来
            close();
          } catch (error) {
            noteEl.textContent = '换一首试试，或用下方按钮导入本地文件。';
            showPlayError(error.message);
          } finally {
            button.classList.remove('loading');
          }
        });
        li.appendChild(button);
        resultsEl.appendChild(li);
      }
    } catch (error) {
      resultsEl.innerHTML = `<li class="qq-empty">搜索失败：${escapeHtml(error.message)}</li>`;
    }
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function openPanel() {
    open = true;
    root.hidden = false;
    doc.body.classList.add('qq-open');
    renderChannels();
    setStatus('正在连接 QQ 音乐服务…');
    try {
      const status = await refreshStatus();
      if (status?.available && !status.loggedIn) await refreshQr();
    } catch (error) {
      showLogin();
      setStatus(`无法连接本地服务：${error.message}`);
    }
  }

  function close() {
    open = false;
    root.hidden = true;
    doc.body.classList.remove('qq-open');
    stopPolling();
    if (currentKey) {
      request(`/api/qq/qr/cancel?key=${encodeURIComponent(currentKey)}`, { method: 'GET' }).catch(() => {});
      currentKey = null;
    }
  }

  $('[data-qq-close]').addEventListener('click', () => close());
  $('[data-qq-refresh]').addEventListener('click', () => refreshQr());
  $('[data-qq-logout]').addEventListener('click', async () => {
    try {
      await request('/api/qq/logout', { method: 'POST' });
    } catch {
      // 忽略
    }
    resultsEl.innerHTML = '';
    showLogin();
    await refreshQr();
  });
  if (localButton) localButton.addEventListener('click', () => onPickLocalFile?.());
  $('[data-qq-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    search($('[data-qq-kw]').value);
  });
  root.addEventListener('click', (event) => {
    if (event.target === root) close();
  });
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) close();
  });

  return {
    root,
    attach() {
      return root;
    },
    open: openPanel,
    close,
    isOpen: () => open,
    dispose() {
      stopPolling();
      root.remove();
      doc.body.classList.remove('qq-open');
    },
  };
}
