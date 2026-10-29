import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // 固定使用浏览器 IndexedDB：避免本机跑着 MySQL 后端时测试路径漂移。
  await page.addInitScript(() => {
    try { localStorage.setItem('sonora-storage', 'local'); } catch { /* ignore */ }
  });
});

// 右侧设置栏默认收起，交互前先展开（新行为，见「effects sidebar」用例）。
async function openEffects(page) {
  const open = await page.evaluate(() => document.body.classList.contains('effects-open'));
  if (!open) await page.getByRole('button', { name: '展开视觉设置' }).click();
}

function tone() {
  const rate = 22050;
  const samples = rate * 12;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(36 + samples * 2, 4);
  data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const pulse = 0.25 + 0.65 * Math.exp(-((i / rate) % 0.5) * 15);
    data.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 2 * 90) * pulse * 26000), 44 + i * 2);
  }
  return { name: '测试节拍.wav', mimeType: 'audio/wav', buffer: data };
}

test('music library persists, deduplicates, selects and confirms deletion', async ({ page }) => {
  const importSameFile = () => page.evaluate(bytes => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], '测试节拍.wav', { type: 'audio/wav', lastModified: 42 }));
    const input = document.querySelector('[data-file]');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  }, [...tone().buffer]);
  await page.goto('/');
  await page.getByRole('button', { name: '音乐库', exact: true }).click();
  await expect(page.getByText('还没有保存的歌曲')).toBeVisible();
  await page.getByRole('button', { name: '关闭音乐库' }).click();
  await importSameFile();
  await page.getByRole('button', { name: '音乐库', exact: true }).click();
  await expect(page.locator('[data-library-count]')).toHaveText('1 首歌曲');
  await page.reload();
  await expect(page.locator('[data-track]')).toHaveText('还没有音乐');
  await page.getByRole('button', { name: '音乐库', exact: true }).click();
  await page.locator('[data-library-select]').click();
  await expect(page.locator('[data-track]')).toHaveText('测试节拍');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await importSameFile();
  await expect(page.locator('[data-library-select][aria-pressed="true"]')).toHaveCount(1);
  await expect(page.locator('[data-library-count]')).toHaveText('1 首歌曲');
  await page.getByRole('button', { name: '关闭音乐库' }).click();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.getByRole('button', { name: '音乐库', exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-library-delete]').click();
  await expect(page.locator('[data-library-count]')).toHaveText('1 首歌曲');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-library-delete]').click();
  await expect(page.getByText('还没有保存的歌曲')).toBeVisible();
  await page.getByRole('button', { name: '关闭音乐库' }).click();
  await expect(page.locator('[data-track]')).toHaveText('测试节拍.wav');
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
});

test('catalog supports batch import, search, sort, rename, play count and persistence', async ({ page }) => {
  await page.goto('/');
  const files = [
    { name: '甲歌手 - 第一首.wav', mimeType: 'audio/wav', buffer: tone().buffer },
    { name: '乙歌手 - 第二首.wav', mimeType: 'audio/wav', buffer: tone().buffer },
  ];
  await page.getByRole('button', { name: '音乐库', exact: true }).click();
  await page.locator('[data-library-file]').setInputFiles(files);
  await expect(page.locator('[data-library-count]')).toHaveText('2 首歌曲', { timeout: 30000 });
  await expect(page.locator('.catalog-row')).toHaveCount(2);
  // 文件名解析：歌手 - 歌名
  const titles = await page.locator('.catalog-song-title').allTextContents();
  expect([...titles].sort()).toEqual(['第一首', '第二首'].sort());
  const artists = await page.locator('.catalog-song-artist').allTextContents();
  expect([...artists].sort()).toEqual(['乙歌手', '甲歌手'].sort());
  // 搜索
  await page.locator('[data-library-search]').fill('第二');
  await expect(page.locator('.catalog-row')).toHaveCount(1);
  await expect(page.locator('.catalog-song-title')).toHaveText('第二首');
  await page.locator('[data-library-search]').fill('不存在');
  await expect(page.locator('[data-library-status]')).toHaveText('没有找到匹配的歌曲');
  await page.locator('[data-library-search]').fill('');
  await expect(page.locator('.catalog-row')).toHaveCount(2);
  // 排序：标题顺序与同一 localeCompare 规则一致
  await page.locator('[data-library-sort]').selectOption('title');
  const sortedTitles = await page.locator('.catalog-song-title').allTextContents();
  const expectedTitles = await page.evaluate(() => ['第一首', '第二首'].sort((a, b) => a.localeCompare(b, 'zh-CN')));
  expect(sortedTitles).toEqual(expectedTitles);
  // 重命名：只改显示名，不动原文件（重命名当前载入的歌曲，便于后面核对播放次数）
  await page.locator('.catalog-row.active .catalog-rename-button').click();
  await page.locator('.catalog-rename-input').fill('Aurora');
  await page.locator('.catalog-rename-input').press('Enter');
  await expect(page.locator('.catalog-song-title').filter({ hasText: 'Aurora' })).toHaveCount(1);
  await page.getByRole('button', { name: '关闭音乐库' }).click();
  // 播放累积次数
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '音乐库', exact: true }).click();
  const playedRow = page.locator('.catalog-row').filter({ hasText: 'Aurora' });
  await expect(playedRow.locator('.catalog-song-meta')).toContainText('播放 1 次');
  // 删除需二次确认
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-library-delete]').first().click();
  await expect(page.locator('[data-library-count]')).toHaveText('1 首歌曲');
  // 刷新后曲库仍在
  await page.reload();
  await page.getByRole('button', { name: '音乐库', exact: true }).click();
  await expect(page.locator('[data-library-count]')).toHaveText('1 首歌曲');
});

test('library storage keeps metadata separate and handles missing records', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const { MusicLibrary } = await import('/src/library.js');
    const library = new MusicLibrary();
    const file = new File([new Uint8Array(bytes)], '本地.wav', { type: 'audio/wav', lastModified: 9 });
    const first = await library.save(file, 12);
    const duplicate = await library.save(file, 12);
    const list = await library.list();
    const restored = await library.read(first.id);
    const equal = (await restored.arrayBuffer()).byteLength === file.size;
    await library.remove(first.id);
    let missing = '';
    try { await library.read(first.id); } catch (error) { missing = error.message; }
    library.close();
    return { first, duplicate, list, equal, missing };
  }, [...tone().buffer]);
  expect(result.duplicate.id).toBe(result.first.id);
  expect(result.list).toHaveLength(1);
  expect(result.list[0]).not.toHaveProperty('blob');
  expect(result.list[0]).toMatchObject({ duration: 12, lastModified: 9, type: 'audio/wav', title: '本地', artist: '', playCount: 0 });
  expect(result.equal).toBe(true);
  expect(result.missing).toContain('不存在');
});

test('failed decode is not saved and quota failure allows playback', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-file]').setInputFiles({ name: '坏文件.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('bad') });
  await expect(page.getByRole('alert')).toContainText('解码失败');
  await page.getByRole('button', { name: '音乐库', exact: true }).click();
  await expect(page.getByText('还没有保存的歌曲')).toBeVisible();
  await page.getByRole('button', { name: '关闭音乐库' }).click();
  await page.evaluate(async () => {
    const { MusicLibrary } = await import('/src/library.js');
    MusicLibrary.prototype.save = async () => { throw new DOMException('full', 'QuotaExceededError'); };
  });
  await page.locator('[data-file]').setInputFiles(tone());
  await expect(page.getByRole('alert')).toContainText('本次未保存');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
});

test('unavailable database preserves temporary playback', async ({ page }) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => { throw new DOMException('denied', 'SecurityError'); };
  });
  await page.goto('/');
  await page.locator('[data-file]').setInputFiles(tone());
  await expect(page.getByRole('alert')).toContainText('本次未保存');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
});

test('rapid library selections keep the latest song and mobile drawer fits', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async bytes => {
    const { MusicLibrary } = await import('/src/library.js');
    const library = new MusicLibrary();
    for (const name of ['慢歌.wav', '快歌.wav']) {
      await library.save(new File([new Uint8Array(bytes)], name, { type: 'audio/wav', lastModified: 1 }), 12);
    }
    const original = MusicLibrary.prototype.read;
    MusicLibrary.prototype.read = async function (id) {
      if (id.includes('慢歌')) await new Promise(resolve => setTimeout(resolve, 600));
      return original.call(this, id);
    };
  }, [...tone().buffer]);
  // Reload metadata without replacing the controlled delayed read implementation.
  await page.locator('[data-file]').setInputFiles(tone());
  await page.getByRole('button', { name: '音乐库', exact: true }).click();
  await page.locator('[data-library-select]').filter({ hasText: '慢歌' }).click();
  await page.locator('[data-library-select]').filter({ hasText: '快歌' }).click();
  await expect(page.locator('[data-track]')).toHaveText('快歌');
  await page.waitForTimeout(800);
  await expect(page.locator('[data-track]')).toHaveText('快歌');
  await page.evaluate(async () => {
    const { MusicLibrary } = await import('/src/library.js');
    MusicLibrary.prototype.read = async () => { throw new Error('读取歌曲失败，请重新导入。'); };
  });
  await page.locator('[data-library-select]').filter({ hasText: '慢歌' }).click();
  await page.getByRole('button', { name: '关闭音乐库' }).click();
  await expect(page.getByRole('alert')).toContainText('读取歌曲失败');
  await expect(page.locator('[data-track]')).toHaveText('快歌');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '音乐库', exact: true }).click();
  // 抽屉带 0.28s 滑入动画，等动画结束后再量尺寸。
  await page.waitForTimeout(400);
  const box = await page.locator('.library-drawer').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  // 允许设备像素比带来的亚像素误差。
  expect(box.width).toBeLessThanOrEqual(391);
  await page.screenshot({ path: 'test-results/library-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: 'test-results/library-desktop.png' });
});

test('chat lyric identity and scene offset persist', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  await page.locator('.lyrics-panel-mode-button[data-mode="chat"]').click();
  await expect(page.locator('.lyrics-panel-chat')).toBeVisible();
  // 聊天设置默认收起，点开后才能改身份 / 说话比例
  await expect(page.locator('.lyrics-panel-chat-body')).toBeHidden();
  await page.locator('[data-chat-toggle]').click();
  await expect(page.locator('.lyrics-panel-chat-body')).toBeVisible();
  await page.locator('[data-chat-name="ta"]').fill('小明');
  await page.locator('[data-chat-name="me"]').fill('小七');
  await page.locator('[data-chat-bias="random"]').click();
  await page.keyboard.press('Escape');
  const sides = await page.locator('.lyrics-line').evaluateAll((els) => els.slice(0, 6).map((el) => el.dataset.side));
  expect(sides.every((side) => side === 'left' || side === 'right')).toBe(true);
  // 随机模式下双方都会出现，且连续同侧不超过 3 句
  expect(new Set(sides).size).toBe(2);
  let run = 1;
  for (let i = 1; i < sides.length; i += 1) {
    run = sides[i] === sides[i - 1] ? run + 1 : 1;
    expect(run).toBeLessThanOrEqual(3);
  }
  await openEffects(page);
  await expect(page.locator('[data-scene-offset-btn]')).toHaveCount(5);
  await page.locator('[data-scene-offset-btn="up"]').click();
  const offsetText = await page.locator('[data-scene-offset-value]').textContent();
  await page.reload();
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  await page.locator('.lyrics-panel-mode-button[data-mode="chat"]').click();
  await page.locator('[data-chat-toggle]').click();
  await expect(page.locator('[data-chat-name="ta"]')).toHaveValue('小明');
  await expect(page.locator('[data-chat-name="me"]')).toHaveValue('小七');
  await expect(page.locator('[data-chat-bias="random"]')).toHaveAttribute('aria-pressed', 'true');
  await openEffects(page);
  await expect(page.locator('[data-scene-offset-value]')).toHaveText(offsetText);
});

test('online music panel opens from navbar with three sources and closes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '在线音乐' }).click();
  const backdrop = page.locator('.qq-backdrop');
  await expect(backdrop).toBeVisible();
  await expect(page.locator('.qq-panel')).toBeVisible();
  // 三个音源：QQ 音乐 / 网易云音乐 / 酷狗音乐（不再有手机 QQ、微信通道）
  await expect(page.locator('.online-source')).toHaveCount(3);
  await expect(page.locator('.online-source').nth(0)).toContainText('QQ 音乐');
  await expect(page.locator('.online-source').nth(1)).toContainText('网易云音乐');
  await expect(page.locator('.online-source').nth(2)).toContainText('酷狗音乐');
  await expect(page.locator('[data-online-status]')).not.toBeEmpty();
  // 播不出来时仍可用本地文件兜底
  await expect(page.locator('[data-online-local]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(backdrop).toBeHidden();
});

test('online music panel switches sources and shows source-specific search', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '在线音乐' }).click();
  const backdrop = page.locator('.qq-backdrop');
  // 酷狗免登录：切过去直接有搜索框
  await page.locator('.online-source').nth(2).click();
  await expect(page.locator('[data-online-kw]')).toBeVisible();
  await expect(page.locator('[data-online-status]')).toContainText('酷狗');
  // 网易云：未登录也允许搜索试听
  await page.locator('.online-source').nth(1).click();
  await expect(page.locator('.online-source').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-online-kw]')).toBeVisible();
  await expect(page.locator('[data-online-status]')).toContainText('网易云');
  await expect(page.locator('[data-online-phone-toggle]')).toBeVisible();
  await page.locator('[data-online-phone-toggle]').click();
  await expect(page.locator('[data-online-phone-box]')).toBeVisible();
  await page.locator('[data-online-phone]').fill('123');
  await page.locator('[data-online-send]').click();
  await expect(page.locator('[data-online-error]')).toContainText('手机号');

  await page.keyboard.press('Escape');
  await expect(backdrop).toBeHidden();
});

test('cursor trail style selector offers styles and persists', async ({ page }) => {
  await page.goto('/');
  await openEffects(page);
  const select = page.locator('[data-trail-style]');
  await expect(select).toBeVisible();
  expect(await select.locator('option').count()).toBe(10);
  await select.selectOption('fluid');
  await page.reload();
  await openEffects(page);
  await expect(page.locator('[data-trail-style]')).toHaveValue('fluid');
});

test('lyrics display preview reflects chosen color and 3D mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  const preview = page.locator('.lyrics-panel-display-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.lyrics-panel-preview-line').first()).toContainText('夜色');
  await expect(preview.locator('.lyrics-panel-preview-value')).toContainText('跟随曲风');
  // 在调色盘上选一个颜色 → 预览色值变化
  // 视觉设置里也有一个圆形调色盘（可能隐藏），这里只取歌词面板里的那个
  const board = page.locator('.lyrics-panel .color-palette-board').first();
  const box = await board.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await expect(preview.locator('.lyrics-panel-preview-value')).toContainText(/#[0-9a-f]{6}/i);
  // 切到 3D 倾斜 → 预览同步倾斜
  await page.getByRole('button', { name: '3D 倾斜' }).click();
  await expect(preview).toHaveClass(/is-tilt3d/);
});
test('apple / typewriter / glow lyric styles apply and keep word spans', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  for (const mode of ['apple', 'typewriter', 'glow', 'cinema', 'bounce', 'outline', 'island', 'focus', 'duet']) {
    await page.locator(`.lyrics-panel-mode-button[data-mode="${mode}"]`).click();
    await expect(page.locator('.lyrics-overlay')).toHaveAttribute('data-mode', mode);
  }
  // 最后切回逐字样式（对唱等样式不渲染词 span），验证词 span 仍正常
  await page.locator('.lyrics-panel-mode-button[data-mode="glow"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lyrics-word').first()).toBeVisible();
});
test('new lyric camera styles apply and vertical writes vertically', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  for (const mode of ['drift', 'swing', 'vertical', 'kinetic', 'glitch', 'scatter', 'pulse', 'chat']) {
    await page.locator(`.lyrics-panel-mode-button[data-mode="${mode}"]`).click();
    await expect(page.locator('.lyrics-overlay')).toHaveAttribute('data-mode', mode);
  }
  // 竖排模式：当前行文字应使用 vertical-rl 书写方向
  await page.locator('.lyrics-panel-mode-button[data-mode="vertical"]').click();
  const writingMode = await page
    .locator('.lyrics-line.lyrics-active .lyrics-text')
    .first()
    .evaluate((el) => getComputedStyle(el).writingMode);
  expect(writingMode).toBe('vertical-rl');
});

test('karaoke lyric style renders per-word spans and switches back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  await page.locator('.lyrics-panel-mode-button[data-mode="karaoke"]').click();
  await page.keyboard.press('Escape');
  const words = page.locator('.lyrics-word');
  await expect(words.first()).toBeVisible();
  expect(await words.count()).toBeGreaterThan(10);
  // 逐字样式下每行文字被拆成字/词 span
  await expect(page.locator('.lyrics-line.lyrics-active .lyrics-word').first()).toBeAttached();
  // 切回经典模式 → 词 span 消失
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  await page.locator('.lyrics-panel-mode-button[data-mode="classic"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lyrics-word')).toHaveCount(0);
});

test('topbar mute button toggles output mute and persists', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('[data-mute]');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveClass(/is-muted/);
  await expect(button).toHaveAttribute('aria-label', '取消静音');
  // 刷新后保持静音
  await page.reload();
  await expect(page.locator('[data-mute]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-mute]').click();
  await expect(page.locator('[data-mute]')).toHaveAttribute('aria-pressed', 'false');
});

test('focus page shows running mascot and today study total', async ({ page }) => {
  await page.goto('/#focus');
  const mascot = page.locator('.pomodoro-mascot');
  await expect(mascot).toBeVisible();
  await expect(page.locator('[data-study-total]')).toContainText('今日总学习时长');
  await expect(page.locator('[data-focus-stat]')).toContainText('今日专注');
  // 连续打卡 / 今日目标 / 鼓励位（鼓励语在专注 3 分钟后才出现，初始隐藏）
  await expect(page.locator('[data-focus-streak]')).toContainText('连续打卡');
  await expect(page.locator('[data-focus-goal-fill]')).toHaveCount(1);
  await expect(page.locator('[data-focus-cheer]')).toBeHidden();
  // 未开始时不跑，开始后进入奔跑状态
  await expect(mascot).not.toHaveClass(/is-running/);
  await page.getByRole('button', { name: '开始' }).click();
  await expect(mascot).toHaveClass(/is-running/);
  await page.getByRole('button', { name: '暂停' }).click();
  await expect(mascot).not.toHaveClass(/is-running/);
});
test('effects sidebar is collapsed by default and toggles from topbar and close button', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('#effects-panel');
  // 默认收起
  await expect(page.locator('body')).not.toHaveClass(/effects-open/);
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('button', { name: '展开视觉设置' })).toHaveAttribute('aria-expanded', 'false');
  // 顶部齿轮展开
  await page.getByRole('button', { name: '展开视觉设置' }).click();
  await expect(page.locator('body')).toHaveClass(/effects-open/);
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await expect(page.getByRole('button', { name: '收起视觉设置' }).first()).toHaveAttribute('aria-expanded', 'true');
  // 面板内 × 收起
  await page.locator('[data-effects-close]').click();
  await expect(page.locator('body')).not.toHaveClass(/effects-open/);
  // Esc 收起
  await page.getByRole('button', { name: '展开视觉设置' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/effects-open/);
  // 展开状态持久化：刷新后仍保持展开
  await page.getByRole('button', { name: '展开视觉设置' }).click();
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/effects-open/);
});

test('local music playback, twelve combinations, seeking, errors and mobile layout', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#scene canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/desktop-idle.png' });
  await page.locator('[data-file]').setInputFiles(process.env.TEST_AUDIO || tone());
  await expect(page.locator('[data-status]')).toHaveText('音乐已就绪', { timeout: 30000 });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.locator('[data-seek]').inputValue())).toBeGreaterThan(0.2);
  // 设置栏默认收起：先展开再操作
  await openEffects(page);
  for (const type of ['sphere', 'nebula', 'rings', 'wave']) {
    for (const theme of ['cosmic', 'fire', 'mono']) {
      await page.locator(`[data-type="${type}"]`).click();
      await page.locator(`[data-theme="${theme}"]`).click();
      await expect(page.locator(`[data-type="${type}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(`[data-theme="${theme}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
    }
  }
  await page.locator('[data-type="nebula"]').click();
  await page.locator('[data-type="echo"]').click();
  await expect(page.locator('[data-type="echo"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#scene canvas')).toBeVisible();

  await page.locator('[data-theme="cosmic"]').click();
  await page.locator('[data-volume]').fill('0');
  await page.locator('[data-volume]').dispatchEvent('input');
  await page.locator('[data-seek]').evaluate(element => {
    element.value = '5'; element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(async () => Number(await page.locator('[data-seek]').inputValue())).toBeGreaterThanOrEqual(5);
  await page.screenshot({ path: 'test-results/desktop-playing.png' });
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const paused = Number(await page.locator('[data-seek]').inputValue());
  await page.waitForTimeout(350);
  expect(Number(await page.locator('[data-seek]').inputValue())).toBeCloseTo(paused, 0);
  for (const quality of ['low', 'high', 'medium']) await page.locator(`[data-quality="${quality}"]`).click();
  await page.locator('[data-file]').setInputFiles({ name: 'empty.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(0) });
  await expect(page.getByRole('alert')).toContainText('非空');
  await page.locator('[data-file]').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
  await expect(page.getByRole('alert')).toContainText('不支持');
  await page.locator('[data-file]').setInputFiles({ name: 'broken.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('invalid audio') });
  await expect(page.getByRole('alert')).toContainText('解码失败');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('[data-upload]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('real analysis remains responsive when output is muted and resources are released', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (audioFile) => {
    const { AudioEngine } = await import('/src/audio.js');
    const engine = new AudioEngine();
    const file = new File([new Uint8Array(audioFile)], 'tone.wav', { type: 'audio/wav' });
    await engine.load(file);
    await engine.play();
    // 150ms 在两台机器负载高时偶尔取不到首批分析数据，放宽到 400ms 再采样
    const delay = () => new Promise(resolve => setTimeout(resolve, 400));
    await delay();
    const before = engine.sample(0.15);
    engine.setVolume(0);
    await delay();
    const muted = engine.sample(0.15);
    engine.dispose();
    return { before, muted, state: engine.getState(), contextState: engine.context.state };
  }, [...tone().buffer]);
  expect(result.before.volume).toBeGreaterThan(0.01);
  expect(result.muted.volume).toBeGreaterThan(0.01);
  expect(result.muted.bass).toBeGreaterThan(0.01);
  expect(result.state.loaded).toBe(false);
});

test('WebGL failure presents an actionable Chinese message', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (name, ...args) {
      return /webgl/i.test(name) ? null : getContext.call(this, name, ...args);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('WebGL');
  await expect(page.locator('[data-upload]')).toBeEnabled();
});

test('drop import, fullscreen and repeated particle rebuilds keep resources bounded', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(bytes => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], '拖放音乐.wav', { type: 'audio/wav' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, [...tone().buffer]);
  await expect(page.locator('[data-track]')).toHaveText('拖放音乐');
  await page.getByRole('button', { name: '切换全屏' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole('button', { name: '切换全屏' }).click();
  const result = await page.evaluate(async () => {
    const { ParticleScene } = await import('/src/particles.js');
    const container = document.createElement('div');
    container.style.cssText = 'width:300px;height:300px;position:fixed;top:0;left:0';
    document.body.appendChild(container);
    const scene = new ParticleScene(container);
    // Warm up lazily uploaded geometries: the core glow hides in wave mode,
    // so render every shape once before measuring so `before` is the real baseline.
    for (const warmType of ['sphere', 'nebula', 'rings', 'wave']) {
      scene.setType(warmType);
      scene.update(0.016, { volume: .5, bass: .4, beat: 1 }, true);
    }
    const before = scene.renderer.info.memory.geometries;
    for (let i = 0; i < 12; i++) {
      scene.setQuality(['low', 'medium', 'high'][i % 3]);
      scene.setType(['sphere', 'nebula', 'rings', 'wave'][i % 4]);
      scene.setTheme(['cosmic', 'fire', 'mono'][i % 3]);
      scene.update(.04, { volume: .5, bass: .4, beat: i % 2 ? 1 : .1 }, true);
    }
    const after = scene.renderer.info.memory.geometries;
    scene.dispose();
    const canvases = container.querySelectorAll('canvas').length;
    container.remove();
    return { before, after, canvases };
  });
  expect(result.after).toBeLessThanOrEqual(result.before);
  expect(result.canvases).toBe(0);
});
