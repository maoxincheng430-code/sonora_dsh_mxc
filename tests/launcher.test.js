import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// 启动脚本放在「点这里启动喵」子目录下，方便用户一眼找到。
const LAUNCHER_DIR = '点这里启动喵';
const LAUNCHERS = ['启动网站.cmd', '启动桌面版.cmd', '安装在线音乐依赖.cmd'];
const launcherUrl = (name) => new URL(`../${LAUNCHER_DIR}/${name}`, import.meta.url);

for (const name of LAUNCHERS) {
  test(`${name} 不依赖代码页（纯 ASCII）`, () => {
    const bytes = readFileSync(launcherUrl(name));
    assert.ok(
      bytes.every((byte) => byte < 128),
      'batch commands must not depend on a code page',
    );
  });
}

test('.gitattributes 强制 .cmd / .bat 使用 CRLF', () => {
  // git 的规范做法是「索引里存 LF，检出时按 .gitattributes 转换」。
  // 所以这里校验配置本身，而不是工作区的换行符：
  // Linux CI 上检出的是 LF 属于正常现象，Windows 用户 checkout 才会拿到 CRLF。
  const attrPath = new URL('../.gitattributes', import.meta.url);
  assert.ok(existsSync(attrPath), '项目根目录应有 .gitattributes');
  const text = readFileSync(attrPath, 'utf8');
  assert.match(text, /^\*\.cmd\s+text\s+eol=crlf$/m, '.cmd 应声明为 CRLF');
  assert.match(text, /^\*\.bat\s+text\s+eol=crlf$/m, '.bat 应声明为 CRLF');
});

test('启动脚本会 cd 回项目根目录（它们住在子文件夹里）', () => {
  for (const name of LAUNCHERS) {
    const text = readFileSync(launcherUrl(name), 'latin1');
    // 必须用 %~dp0.. 回到项目根目录，否则 node_modules / scripts / server 都找不到
    assert.match(text, /cd \/d "%~dp0\.\."/, `${name} 应该 cd 到上一级目录`);
  }
});

test('桌面启动脚本走 electron-launch.mjs 并配置镜像', () => {
  const text = readFileSync(launcherUrl('启动桌面版.cmd'), 'latin1');
  // 某些终端/工具会设置 ELECTRON_RUN_AS_NODE；launcher 通过 electron-launch.mjs 清掉它
  assert.match(text, /electron-launch\.mjs/);
  assert.match(text, /set ELECTRON_MIRROR=/);
});

test('网站启动脚本包含依赖安装与端口检测逻辑', () => {
  const text = readFileSync(launcherUrl('启动网站.cmd'), 'latin1');
  assert.match(text, /npm install/, '首次运行应自动安装依赖');
  assert.match(text, /5173/, '应检测 5173 端口');
  assert.match(text, /npm run dev/, '应调用 npm run dev');
});

// 在线音乐（QQ / 网易云）挂在 tools/ 下的独立子项目里，主项目的 npm install
// 不会带上它们；没有这步，别人 clone 后点「在线音乐」只会看到 Failed to fetch。
test('在线音乐安装脚本会装齐 tools 下两个服务的依赖', () => {
  const text = readFileSync(launcherUrl('安装在线音乐依赖.cmd'), 'latin1');
  assert.match(text, /cd \/d "%~dp0\.\."/, '应回到项目根目录');
  assert.match(text, /tools\\qq-api/, '应覆盖 QQ 音乐服务');
  assert.match(text, /tools\\netease/, '应覆盖网易云服务');
  // 两个子项目都要各自 npm install（pushd 进入目录再装）
  assert.equal(
    (text.match(/call npm install/g) ?? []).length,
    3,
    '主项目 + 两个子服务各安装一次',
  );
  assert.match(text, /node_modules/, '应检测依赖是否已存在，避免重复安装');
});