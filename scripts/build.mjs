// 构建包装器：把 TEMP/TMP 固定到项目内，避开 Windows 系统临时目录里
// esbuild 临时文件被占用 / 拒绝删除导致的 "Access is denied"。
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = path.join(root, '.tmp-build', `run-${process.pid}`);
mkdirSync(tempDir, { recursive: true });
console.log(`[build] temp: ${tempDir}`);

const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const child = spawn(process.execPath, [viteBin, 'build', ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, TEMP: tempDir, TMP: tempDir },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('[build] 启动 Vite 失败：', error.message);
  process.exit(1);
});

child.on('exit', (code) => {
  if (code === 0) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 临时目录被占用就算了，下次构建会复用
    }
  }
  process.exit(code ?? 1);
});
