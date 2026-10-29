// 在线音乐面板：一个面板里切换三个音源（QQ 音乐 / 网易云音乐 / 酷狗音乐）。
// QQ、网易云支持扫码登录后搜索播放；酷狗免登录搜索播放（部分 VIP 歌拿不到地址）。
// 复用 qq-panel.css 的视觉样式，避免重复一套皮肤。

const SOURCES = [
  {
    id: 'qq',
    label: 'QQ 音乐',
    api: '/api/qq',
    login: true,
    qrChannel: 'qqmusic',
    loginTip: '用手机 QQ 音乐 App 扫码登录。',
  },
  {
    id: 'netease',
    label: '网易云音乐',
    api: '/api/netease',
    login: true,
    loginTip: '用网易云音乐 App 扫码登录。',
  },
  {
    id: 'kugou',
    label: '酷狗音乐',
    api: '/api/kugou',
    login: false,
    loginTip: '酷狗音乐免登录，直接搜索即可（部分 VIP / 版权歌曲可能无法播放）。',
  },
];

const SOURCE_BY_ID = new Map(SOURCES.map((source) => [source.id, source]));

export function createOnlinePanel(options = {}) {
  const doc = options.document ?? (typeof document !== 'undefined' ? document : null);
  const fetchImpl = options.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const apiBase = String(options.apiBase ?? '').replace(/\/$/, '');
  const onPlaySong = typeof options.onPlaySong === 'function' ? options.onPlaySong : null;
  const onPickLocalFile = typeof options.onPickLocalFile === 'function' ? options.onPickLocalFile : null;
  if (!doc) throw new Error('createOnlinePanel 需要 document');
  if (!fetchImpl) throw new Error('createOnlinePanel 需要 fetch');

  const root = doc.createElement('div');
  root.className = 'qq-backdrop';
  root.hidden = true;
  root.innerHTML = `
    <section class="qq-panel online-panel" role="dialog" aria-modal="true" aria-label="在线音乐">
      <header class="qq-head"><h2>在线音乐</h2><button class="qq-close" type="button" data-online-close aria-label="关闭">×</button></header>
      <div class="qq-body">
        <div class="online-sources" role="tablist" aria-label="音乐平台">
          ${SOURCES.map(
            (source) =>
              `<button type="button" role="tab" class="online-source" data-online-source="${source.id}" aria-selected="false">${source.label}</button>`,
          ).join('')}
        </div>
        <p class="qq-status" data-online-status role="status">正在连接…</p>
        <section class="qq-login" data-online-login>
          <div class="qq-qr" data-online-qr-wrap hidden><img data-online-qr alt="登录二维码" width="180" height="180"></div>
          <button class="qq-button" type="button" data-online-refresh>刷新二维码</button>
          <p class="qq-tip" data-online-tip></p>
          <button class="qq-link online-cookie-toggle" type="button" data-online-cookie-toggle>扫码一直失败？手动粘贴 Cookie</button>
          <div class="online-cookie" data-online-cookie-box hidden>
            <textarea class="online-cookie-input" data-online-cookie-input rows="3" placeholder="从 music.163.com 复制 Cookie（需包含 MUSIC_U=...）"></textarea>
            <button class="qq-button" type="button" data-online-cookie-save>保存 Cookie 登录</button>
          </div>
          <button class="qq-link online-phone-toggle" type="button" data-online-phone-toggle>手机号验证码登录</button>
          <div class="online-phone" data-online-phone-box hidden>
            <input class="qq-input" data-online-phone type="tel" inputmode="numeric" autocomplete="tel" placeholder="手机号" aria-label="手机号">
            <div class="online-phone-code">
              <input class="qq-input" data-online-code type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="短信验证码" aria-label="短信验证码">
              <button class="qq-button" type="button" data-online-send>发送验证码</button>
            </div>
            <button class="qq-button qq-button-primary" type="button" data-online-phone-login>验证码登录</button>
          </div>
        </section>
        <section class="qq-main" data-online-main hidden>
          <div class="qq-user"><span data-online-user>已登录</span><button class="qq-link" type="button" data-online-logout>退出登录</button></div>
          <form class="qq-search" data-online-form>
            <input class="qq-input" data-online-kw placeholder="搜索歌曲 / 歌手" aria-label="搜索歌曲" />
            <button class="qq-button qq-button-primary" type="submit">搜索</button>
          </form>
          <ul class="qq-results" data-online-results></ul>
        </section>
        <p class="qq-error" data-online-error role="alert" hidden></p>
        <p class="qq-hint" data-online-note>点击歌曲即可在本页播放，并自动加载歌词。</p>
        <button class="qq-button qq-local" type="button" data-online-local>播不出来？用本地文件渲染同一首歌</button>
      </div>
    </section>`;

  const $ = (selector) => root.querySelector(selector);
  const statusEl = $('[data-online-status]');
  const loginEl = $('[data-online-login]');
  const qrWrap = $('[data-online-qr-wrap]');
  const qrImg = $('[data-online-qr]');
  const tipEl = $('[data-online-tip]');
  const refreshButton = $('[data-online-refresh]');
  const cookieToggle = $('[data-online-cookie-toggle]');
  const cookieBox = $('[data-online-cookie-box]');
  const cookieInput = $('[data-online-cookie-input]');
  const cookieSave = $('[data-online-cookie-save]');
  const phoneToggle = $('[data-online-phone-toggle]');
  const phoneBox = $('[data-online-phone-box]');
  const phoneInput = $('[data-online-phone]');
  const codeInput = $('[data-online-code]');
  const phoneSend = $('[data-online-send]');
  const phoneLogin = $('[data-online-phone-login]');
  const mainEl = $('[data-online-main]');
  const userEl = $('[data-online-user]');
  const logoutButton = $('[data-online-logout]');
  const form = $('[data-online-form]');
  const keywordInput = $('[data-online-kw]');
  const resultsEl = $('[data-online-results]');
  const errorEl = $('[data-online-error]');
  const noteEl = $('[data-online-note]');
  const localButton = $('[data-online-local]');
  const sourceButtons = [...root.querySelectorAll('[data-online-source]')];

  let sourceId = 'qq';
  let loggedIn = false;
  let nickname = '';
  let statusToken = 0;
  let qrTimer = 0;
  let qrKey = '';
  let disposed = false;

  try {
    const saved = localStorage.getItem('sonora-online-source');
    if (saved && SOURCE_BY_ID.has(saved)) sourceId = saved;
  } catch {
    // 忽略
  }

  const source = () => SOURCE_BY_ID.get(sourceId) || SOURCES[0];

  function setHidden(element, hidden) {
    if (element) element.hidden = hidden;
  }

  function showError(message) {
    if (!errorEl) return;
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = '';
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function stopQrPolling() {
    if (qrTimer) clearTimeout(qrTimer);
    qrTimer = 0;
    qrKey = '';
  }

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
    return data;
  }

  function renderSources() {
    const supportsCookie = sourceId === 'netease';
    if (cookieToggle) cookieToggle.hidden = !supportsCookie;
    if (phoneToggle) phoneToggle.hidden = !supportsCookie;
    if (phoneBox && !supportsCookie) phoneBox.hidden = true;
    if (cookieBox && !supportsCookie) {
      cookieBox.hidden = true;
      if (cookieInput) cookieInput.value = '';
    }
    for (const button of sourceButtons) {
      const active = button.dataset.onlineSource === sourceId;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
  }

  function enterMain() {
    setHidden(loginEl, true);
    setHidden(mainEl, false);
    if (userEl) userEl.textContent = nickname ? `已登录：${nickname}` : '已登录';
  }

  function enterLogin() {
    setHidden(mainEl, true);
    setHidden(loginEl, false);
  }

  // 网易云不登录也能搜索/试听一部分歌，所以登录区和搜索区同时显示
  function enterOptionalLogin() {
    setHidden(loginEl, false);
    setHidden(mainEl, false);
    setHidden(logoutButton, true);
    if (userEl) userEl.textContent = '未登录 · 可直接搜索试听';
  }

  function showKugouMode() {
    setHidden(loginEl, true);
    setHidden(mainEl, false);
    if (userEl) userEl.textContent = '酷狗免登录';
    setHidden(logoutButton, true);
    setStatus('酷狗音乐 · 免登录搜索');
    noteEl.textContent = '酷狗音乐免登录，直接搜索即可；部分 VIP / 版权歌曲可能拿不到播放地址。点击歌曲在本页播放并加载歌词。';
  }

  async function refreshStatus() {
    const token = ++statusToken;
    const current = source();
    showError('');
    if (current.id === 'kugou') {
      loggedIn = true;
      showKugouMode();
      return;
    }
    setHidden(loginEl, false);
    setHidden(mainEl, true);
    setStatus(`正在连接 ${current.label}…`);
    try {
      const data = await request(`${current.api}/status`);
      if (!data.available) {
        setStatus(`${current.label}暂不可用：${data.reason || '服务未启动'}`);
        return;
      }
      loggedIn = Boolean(data.loggedIn);
      nickname = data.nickname || '';
      if (loggedIn) {
        enterMain();
        setStatus(`${current.label} · 已登录`);
      } else if (current.id === 'netease') {
        enterOptionalLogin();
        setStatus('网易云音乐 · 未登录（可直接搜索试听，登录后可用歌曲更多）');
        await startQrLogin();
      } else {
        enterLogin();
        setStatus(`${current.label} · 未登录`);
        await startQrLogin();
      }
    } catch (error) {
      // 「Failed to fetch」几乎总是本地服务没起来：
      // tools/qq-api 或 tools/netease 的依赖没装，或者没跑 npm run server。
      // 翻译成用户能照着做的说明，否则他只会看到一个英文报错。
      const offline = /failed to fetch|networkerror|load failed|network request failed/i.test(
        String(error?.message || ''),
      );
      if (offline) {
        setStatus(`${current.label} · 本地服务未启动`);
        showError(
          '在线音乐需要本地服务支持：Windows 双击「点这里启动喵/安装在线音乐依赖.cmd」装依赖，再双击「启动网站.cmd」；'
            + '命令行用户执行 npm run qq:setup && npm run netease:setup，然后 npm run server。',
        );
      } else {
        setStatus(`${current.label}连接失败：${error.message}`);
      }
    }
  }

  async function startQrLogin() {
    const current = source();
    if (!current.login || disposed) return;
    stopQrPolling();
    showError('');
    setHidden(qrWrap, true);
    setStatus(`正在获取 ${current.label} 二维码…`);
    try {
      const channelQuery = current.qrChannel ? `?channel=${encodeURIComponent(current.qrChannel)}` : '';
      const keyData = await request(`${current.api}/qr/key${channelQuery}`);
      qrKey = keyData.key;
      const createData = await request(`${current.api}/qr/create?key=${encodeURIComponent(qrKey)}`);
      const image = createData.image || createData.qrimg || '';
      if (!image) throw new Error('二维码生成失败');
      qrImg.src = image;
      setHidden(qrWrap, false);
      tipEl.textContent = current.loginTip;
      setStatus(`${current.label} · 请用手机扫描二维码`);
      pollQr();
    } catch (error) {
      setStatus(`${current.label}二维码获取失败：${error.message}`);
    }
  }

  function pollQr() {
    const current = source();
    if (!qrKey || disposed) return;
    qrTimer = setTimeout(async () => {
      if (disposed || !qrKey) return;
      try {
        const data = await request(`${current.api}/qr/check?key=${encodeURIComponent(qrKey)}`);
        const state = data.state;
        if (state === 'ok') {
          stopQrPolling();
          setStatus('登录成功，正在同步信息…');
          await refreshStatus();
          if (!loggedIn) {
            setStatus(`${current.label} · 登录未同步`);
            showError('手机已授权，但服务器没有拿到登录态。可以点「刷新二维码」重扫，或改用下方「手机号验证码登录」。');
          }
          return;
        }
        if (state === 'expired') {
          stopQrPolling();
          setStatus(`${current.label} · 二维码已过期，请刷新`);
          tipEl.textContent = '二维码已过期，点「刷新二维码」重新扫码。';
          return;
        }
        if (state === 'scanned') setStatus('已扫码，请在手机上确认登录…');
        pollQr();
      } catch {
        pollQr();
      }
    }, 1800);
  }

  function renderResults(songs) {
    const current = source();
    resultsEl.innerHTML = '';
    if (!songs?.length) {
      resultsEl.innerHTML = '<li class="qq-empty">没有找到歌曲</li>';
      return;
    }
    for (const song of songs) {
      const id = song.id ?? song.mid;
      if (!id) continue;
      const li = doc.createElement('li');
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'qq-song';
      const name = doc.createElement('span');
      name.className = 'qq-song-name';
      name.textContent = song.name || '未知歌曲';
      const singer = doc.createElement('span');
      singer.className = 'qq-song-singer';
      singer.textContent = song.singer || '';
      button.append(name, singer);
      button.addEventListener('click', async () => {
        button.classList.add('loading');
        noteEl.textContent = `正在加载：${song.name}`;
        showError('');
        try {
          await onPlaySong?.({ provider: current.id, id: String(id), name: song.name, singer: song.singer || '', album: song.album || '', cover: song.cover || '' });
          noteEl.textContent = `正在播放：${song.name}${song.singer ? ` — ${song.singer}` : ''}`;
          closePanel();
        } catch (error) {
          noteEl.textContent = '换一首试试，或用下方按钮导入本地文件。';
          showError(error.message || '播放失败');
        } finally {
          button.classList.remove('loading');
        }
      });
      li.append(button);
      resultsEl.append(li);
    }
  }

  async function search(keyword) {
    const text = String(keyword || '').trim();
    if (!text) return;
    const current = source();
    resultsEl.innerHTML = '<li class="qq-empty">搜索中…</li>';
    showError('');
    try {
      const data = await request(`${current.api}/search?keyword=${encodeURIComponent(text)}&limit=20`);
      renderResults(data.songs || []);
      noteEl.textContent = '点击歌曲即可在本页播放，并自动加载歌词。';
    } catch (error) {
      resultsEl.innerHTML = `<li class="qq-empty">搜索失败：${escapeHtml(error.message)}</li>`;
    }
  }

  function selectSource(nextId) {
    if (!SOURCE_BY_ID.has(nextId) || nextId === sourceId) return;
    sourceId = nextId;
    try {
      localStorage.setItem('sonora-online-source', sourceId);
    } catch {
      // 忽略
    }
    stopQrPolling();
    renderSources();
    resultsEl.innerHTML = '';
    keywordInput.value = '';
    nickname = '';
    loggedIn = false;
    setHidden(logoutButton, false);
    refreshStatus();
  }

  function closePanel() {
    root.hidden = true;
    doc.body.classList.remove('qq-open');
    stopQrPolling();
  }

  function openPanel() {
    root.hidden = false;
    doc.body.classList.add('qq-open');
    renderSources();
    refreshStatus();
  }

  sourceButtons.forEach((button) => {
    button.addEventListener('click', () => selectSource(button.dataset.onlineSource));
  });
  $('[data-online-close]').addEventListener('click', closePanel);
  root.addEventListener('click', (event) => {
    if (event.target === root) closePanel();
  });
  refreshButton.addEventListener('click', () => startQrLogin());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    search(keywordInput.value);
  });
  logoutButton.addEventListener('click', async () => {
    const current = source();
    try {
      await request(`${current.api}/logout`, { method: 'POST' });
    } catch {
      // 忽略
    }
    stopQrPolling();
    nickname = '';
    loggedIn = false;
    await refreshStatus();
  });
  cookieToggle?.addEventListener('click', () => {
    if (!cookieBox) return;
    cookieBox.hidden = !cookieBox.hidden;
    if (!cookieBox.hidden) cookieInput?.focus?.();
  });

  phoneToggle?.addEventListener('click', () => {
    if (!phoneBox) return;
    phoneBox.hidden = !phoneBox.hidden;
    if (!phoneBox.hidden) phoneInput?.focus?.();
  });

  phoneSend?.addEventListener('click', async () => {
    const phone = String(phoneInput?.value || '').replace(/\D/g, '');
    if (phone.length < 6) {
      showError('请输入有效手机号。');
      return;
    }
    const current = source();
    showError('');
    setStatus(`正在向 ${current.label} 发送验证码…`);
    try {
      const data = await request(`${current.api}/captcha/sent`, { method: 'POST', body: { phone } });
      setStatus(data.message || '验证码已发送，请查看手机短信。');
    } catch (error) {
      showError(error.message || '验证码发送失败');
      setStatus(`${current.label} · 验证码发送失败`);
    }
  });

  phoneLogin?.addEventListener('click', async () => {
    const phone = String(phoneInput?.value || '').replace(/\D/g, '');
    const captcha = String(codeInput?.value || '').replace(/\D/g, '');
    if (phone.length < 6 || captcha.length < 4) {
      showError('请填写手机号和短信验证码。');
      return;
    }
    const current = source();
    showError('');
    setStatus('正在验证登录…');
    try {
      await request(`${current.api}/login/captcha`, { method: 'POST', body: { phone, captcha } });
      setStatus('登录成功，正在同步信息…');
      await refreshStatus();
      if (!loggedIn) showError('登录信息未同步，请再试一次。');
    } catch (error) {
      showError(error.message || '验证码登录失败');
      setStatus(`${current.label} · 验证码登录失败`);
    }
  });

  cookieSave?.addEventListener('click', async () => {
    const raw = String(cookieInput?.value || '').trim();
    if (!raw) {
      showError('请先粘贴网易云 Cookie。');
      return;
    }
    const current = source();
    showError('');
    setStatus('正在校验 Cookie…');
    try {
      const data = await request(`${current.api}/cookie`, { method: 'POST', body: { cookie: raw } });
      nickname = data.nickname || '';
      if (cookieInput) cookieInput.value = '';
      if (cookieBox) cookieBox.hidden = true;
      setStatus(`${current.label} · 已通过 Cookie 登录`);
      await refreshStatus();
    } catch (error) {
      showError(error.message || 'Cookie 登录失败');
      setStatus(`${current.label} · Cookie 登录失败`);
    }
  });

  localButton.addEventListener('click', () => {
    closePanel();
    onPickLocalFile?.();
  });
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !root.hidden) closePanel();
  });

  renderSources();

  return {
    el: root,
    open: openPanel,
    close: closePanel,
    attach(host = doc.body) {
      host.append(root);
    },
    dispose() {
      disposed = true;
      stopQrPolling();
      root.remove();
    },
    getSource: () => sourceId,
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
