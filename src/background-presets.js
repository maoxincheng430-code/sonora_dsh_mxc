// 背景与氛围的纯数据（不依赖 DOM / CSS，便于单测）
export const SCENE_OPTIONS = [
  { id: 'none', name: '默认', desc: '只留粒子宇宙' },
  { id: 'rain', name: '雨', desc: '雨声 · 雨幕' },
  { id: 'thunder', name: '雷雨', desc: '雨声 · 雷声' },
  { id: 'beach', name: '海滩', desc: '浪潮 · 晚风' },
  { id: 'library', name: '图书馆', desc: '纸笔 · 翻书声' },
];

// 内置抽象背景：用脚本生成的渐变图（无版权问题，单张 20~40KB）
export const PRESET_BACKGROUNDS = [
  { id: 'aurora', name: '极光', file: 'backgrounds/aurora.jpg' },
  { id: 'nebula', name: '星云', file: 'backgrounds/nebula.jpg' },
  { id: 'sunset', name: '暮光', file: 'backgrounds/sunset.jpg' },
  { id: 'ocean', name: '深海', file: 'backgrounds/ocean.jpg' },
  { id: 'forest', name: '森林', file: 'backgrounds/forest.jpg' },
  { id: 'charcoal', name: '墨色', file: 'backgrounds/charcoal.jpg' },
];

export function presetUrl(item, base) {
  const root = base || (typeof document !== 'undefined' && document.baseURI) || '';
  try {
    return new URL(item.file, root).href;
  } catch {
    return item.file;
  }
}

export function findPreset(id) {
  return PRESET_BACKGROUNDS.find((item) => item.id === id) || null;
}

