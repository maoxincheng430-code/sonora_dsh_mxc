import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 启动脚本放在「点这里启动喵」子目录下，方便用户一眼找到。
const LAUNCHER_DIR = '点这里启动喵';

for (const name of ['启动网站.cmd', '启动桌面版.cmd']) {
  test(`${name} uses ASCII and CRLF for cmd.exe compatibility`, () => {
    const bytes = readFileSync(new URL(`../${LAUNCHER_DIR}/${name}`, import.meta.url));
    assert.ok(bytes.every((byte) => byte < 128), 'batch commands must not depend on a code page');
    assert.ok(!/(?<!\r)\n/.test(bytes.toString('ascii')), 'batch lines must use CRLF');
  });
}

test('desktop launcher clears ELECTRON_RUN_AS_NODE before launching', () => {
  const text = readFileSync(new URL(`../${LAUNCHER_DIR}/启动桌面版.cmd`, import.meta.url), 'ascii');
  // 某些终端/工具会设置 ELECTRON_RUN_AS_NODE；launcher 通过 electron-launch.mjs 清掉它
  assert.match(text, /electron-launch\.mjs/);
  assert.match(text, /set ELECTRON_MIRROR=/);
});

test('launchers cd up to the project root (they live in a subfolder)', () => {
  for (const name of ['启动网站.cmd', '启动桌面版.cmd']) {
    const text = readFileSync(new URL(`../${LAUNCHER_DIR}/${name}`, import.meta.url), 'ascii');
    // 必须用 %~dp0.. 回到项目根目录，否则 node_modules / scripts / server 都找不到
    assert.match(text, /cd \/d "%~dp0\.\./, `${name} 应该 cd 到上一级目录`);
  }
});
