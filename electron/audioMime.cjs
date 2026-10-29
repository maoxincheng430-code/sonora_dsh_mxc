// 本地音频/视频扩展名 → MIME（Electron 主进程用，Node 单测直接引用）。
const MIME_BY_EXT = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/opus',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

const AUDIO_EXTENSIONS = Object.keys(MIME_BY_EXT);

function guessMime(filePath) {
  const ext = String(filePath ?? '').split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

module.exports = { AUDIO_EXTENSIONS, MIME_BY_EXT, guessMime };
