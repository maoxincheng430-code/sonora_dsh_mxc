// 桌面版桥接（纯函数 + 浏览器 API 包装，便于单测与网页版复用）：
//   · isDesktop() 判断是否运行在 Electron 壳里
//   · filesFromDesktopPayload() 把原生文件选择结果转成 File（复用现有导入流程）
// 声音采集（loopback）已移除；顶部按钮现在是静音开关。

export function isDesktop(globalObject = globalThis) {
  return Boolean(globalObject?.sonoraDesktop?.isElectron);
}

/** 把 preload 返回的文件描述转成标准 File 数组（可直接喂 importFiles）。 */
export function filesFromDesktopPayload(payload, { FileCtor = globalThis.File } = {}) {
  if (!Array.isArray(payload)) return [];
  const files = [];
  for (const item of payload) {
    if (!item || !item.data) continue;
    try {
      files.push(
        new FileCtor([item.data], String(item.name || '未命名音频'), {
          type: String(item.type || 'audio/mpeg'),
          lastModified: Number(item.lastModified) || Date.now(),
        }),
      );
    } catch {
      // 单文件失败不影响其它文件
    }
  }
  return files;
}
