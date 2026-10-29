import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const name of ['启动网站.cmd', '启动桌面版.cmd']) {
  test(`${name} uses ASCII and CRLF for cmd.exe compatibility`, () => {
    const bytes = readFileSync(new URL(`../${name}`, import.meta.url));
    assert.ok(bytes.every((byte) => byte < 128), 'batch commands must not depend on a code page');
    assert.ok(!/(?<!\r)\n/.test(bytes.toString('ascii')), 'batch lines must use CRLF');
  });
}

test('desktop launcher clears ELECTRON_RUN_AS_NODE before launching', () => {
  const text = readFileSync(new URL('../启动桌面版.cmd', import.meta.url), 'ascii');
  // 某些终端/工具会设置 ELECTRON_RUN_AS_NODE；launcher 通过 electron-launch.mjs 清掉它
  assert.match(text, /electron-launch\.mjs/);
  assert.match(text, /set ELECTRON_MIRROR=/);
});
