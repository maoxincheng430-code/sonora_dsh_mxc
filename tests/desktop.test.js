import test from 'node:test';
import assert from 'node:assert/strict';
import { filesFromDesktopPayload, isDesktop } from '../src/desktop.js';

test('isDesktop 依据 preload 注入的标记判断', () => {
  assert.equal(isDesktop({ sonoraDesktop: { isElectron: true } }), true);
  assert.equal(isDesktop({ sonoraDesktop: {} }), false);
  assert.equal(isDesktop({}), false);
  assert.equal(isDesktop(undefined), false);
});

test('filesFromDesktopPayload 转成 File 并保留元数据', () => {
  const data = new Uint8Array([1, 2, 3]).buffer;
  const files = filesFromDesktopPayload([
    { name: '夜航.mp3', type: 'audio/mpeg', size: 3, lastModified: 1234, data },
    { name: '坏文件', data: null },
    null,
  ]);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, '夜航.mp3');
  assert.equal(files[0].type, 'audio/mpeg');
  assert.equal(files[0].size, 3);
  assert.equal(files[0].lastModified, 1234);
  assert.equal(filesFromDesktopPayload(null).length, 0);
  assert.equal(filesFromDesktopPayload('x').length, 0);
});

