import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    // Windows 上文件原子写入（tmpdir + rename）会被 watcher 短暂锁住并抛 EBUSY；
    // .mysql 下是便携数据库与下载缓存（大文件、下载时被占用），一律不监听。
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/*.tmpdir/**',
        '**/.*.tmpdir/**',
        '**/.mysql/**',
        '**/server/.data/**',
        // 打包/截图脚本的临时目录里会有被 Chrome 锁住的 profile 文件，监听它会 EBUSY 崩溃
        '**/.tmp-build/**',
        '**/test-results/**',
        '**/playwright_chromiumdev_profile*/**',
        /\.tmpdir/,
        /[\\/]\.mysql[\\/]/,
        /[\\/]\.tmp-build[\\/]/,
      ],
    },
  },
});
