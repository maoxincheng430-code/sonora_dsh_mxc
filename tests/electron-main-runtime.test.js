import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Electron 窗口需要交互桌面，CI/自动化会话里无法真正开窗；
// 这里用 mock 的 electron 模块把 main.cjs 完整执行一遍，
// 验证 loopback 处理器与原生文件 IPC 确实注册、能被调用。
function loadMainWithMock() {
  const handlers = {};
  const windows = [];
  const fakeElectron = {
    app: {
      whenReady: () => Promise.resolve(),
      on: () => {},
      quit: () => {},
    },
    BrowserWindow: class {
      constructor(options) {
        this.options = options;
        this.loaded = null;
        windows.push(this);
      }
      loadURL(url) {
        this.loaded = { url };
      }
      loadFile(file) {
        this.loaded = { file };
      }
      static getAllWindows() {
        return windows;
      }
    },
    ipcMain: {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
  };
  const originalLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return fakeElectron;
    return originalLoad.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve('../electron/main.cjs')];
    require('../electron/main.cjs');
  } finally {
    Module._load = originalLoad;
  }
  return { handlers, windows };
}

test('main.cjs 运行后注册原生文件 IPC 并创建窗口', async () => {
  const { handlers, windows } = loadMainWithMock();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(handlers['audio:pickFiles'], '应注册原生文件选择 IPC');
  const files = await handlers['audio:pickFiles']();
  assert.deepEqual(files, [], '取消对话框时返回空数组');

  assert.equal(windows.length, 1, '应创建主窗口');
  assert.equal(windows[0].options.webPreferences.contextIsolation, true);
  assert.equal(windows[0].options.webPreferences.nodeIntegration, false);
});
