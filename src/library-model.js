// Pure helpers for the music library. No DOM, no IndexedDB — everything here is
// unit-testable with plain Node (`node --test tests/library-model.test.js`).

const EXTENSION_PATTERN = /\.[a-z0-9]{1,8}$/i;
// Leading track numbers such as "01. ", "01、", "01) ", "01 - ", "01 – ".
const INDEX_PATTERNS = [
  /^\s*\d{1,3}\s*[.．、)）](?!\d)\s*/,
  /^\s*\d{1,3}\s*[-–—]\s+/,
];
// "歌手 - 歌名" first: spaced ASCII hyphen, or an en/em dash with optional spaces.
// An unspaced ASCII hyphen is deliberately kept as part of the name ("A-Lin").
const SEPARATOR_PATTERN = /\s+-\s+|\s*[–—]\s*/;

const DAY = 24 * 60 * 60 * 1000;

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const toTimestamp = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

const clampText = (value, max = 120) => String(value ?? '').trim().slice(0, max);

const collapse = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function parseTrackName(value) {
  let name = collapse(value);
  name = name.replace(EXTENSION_PATTERN, '').trim();
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const pattern of INDEX_PATTERNS) {
      if (!pattern.test(name)) continue;
      name = name.replace(pattern, '').trim();
      stripped = true;
    }
  }
  name = collapse(name);
  if (!name) return { title: '', artist: '' };
  const match = SEPARATOR_PATTERN.exec(name);
  if (match) {
    const artist = collapse(name.slice(0, match.index));
    const title = collapse(name.slice(match.index + match[0].length));
    if (artist && title) return { title, artist };
  }
  return { title: name, artist: '' };
}

// Converts a stored record (v1 or v2) into the complete v2 shape. It never keeps
// the audio blob, so list() results are metadata only.
export function normalizeTrack(track) {
  const source = track && typeof track === 'object' ? track : {};
  const name = String(source.name ?? '');
  const parsed = parseTrackName(name);
  const importedAt = toTimestamp(source.importedAt) || toTimestamp(source.lastModified);
  const normalized = {
    ...source,
    id: String(source.id ?? ''),
    name,
    type: String(source.type ?? ''),
    duration: Math.max(0, toNumber(source.duration)),
    size: Math.max(0, toNumber(source.size)),
    lastModified: toTimestamp(source.lastModified),
    importedAt,
    addedAt: toTimestamp(source.addedAt) || importedAt,
    title: clampText(source.title) || parsed.title,
    artist: typeof source.artist === 'string' ? collapse(source.artist) : parsed.artist,
    playCount: Math.max(0, Math.floor(toNumber(source.playCount))),
    lastPlayedAt: toTimestamp(source.lastPlayedAt),
  };
  delete normalized.blob;
  return normalized;
}

// True when a record predates v2 (or lost metadata) and should be written back.
export function needsBackfill(track) {
  if (!track || typeof track !== 'object') return false;
  if (typeof track.title !== 'string' || !track.title.trim()) return true;
  if (typeof track.artist !== 'string') return true;
  if (!Number.isFinite(Number(track.addedAt)) || Number(track.addedAt) <= 0) return true;
  if (!Number.isFinite(Number(track.playCount))) return true;
  if (!Number.isFinite(Number(track.lastPlayedAt))) return true;
  return false;
}

const addedAtOf = (track) => toTimestamp(track.addedAt) || toTimestamp(track.importedAt);
const titleOf = (track) => String(track.title || track.name || '');
const compareTitle = (a, b) => titleOf(a).localeCompare(titleOf(b), 'zh-CN');

export function sortTracks(tracks, sort = 'added') {
  const list = Array.isArray(tracks) ? [...tracks] : [];
  const byAdded = (a, b) => addedAtOf(b) - addedAtOf(a) || compareTitle(a, b);
  switch (sort) {
    case 'title':
      return list.sort((a, b) => compareTitle(a, b) || byAdded(a, b));
    case 'duration':
      return list.sort((a, b) => toNumber(b.duration) - toNumber(a.duration) || byAdded(a, b));
    case 'plays':
      return list.sort((a, b) => toNumber(b.playCount) - toNumber(a.playCount) || byAdded(a, b));
    case 'added':
    default:
      return list.sort(byAdded);
  }
}

const keywordOf = (value) => collapse(value).toLocaleLowerCase('zh-CN');

export function filterTracks(tracks, query) {
  const list = Array.isArray(tracks) ? [...tracks] : [];
  const keyword = keywordOf(query);
  if (!keyword) return list;
  return list.filter((track) =>
    keywordOf(`${track.title ?? ''} ${track.artist ?? ''} ${track.name ?? ''}`).includes(keyword),
  );
}

export function summarizeTracks(tracks) {
  const list = Array.isArray(tracks) ? tracks : [];
  return list.reduce(
    (summary, track) => ({
      count: summary.count + 1,
      duration: summary.duration + Math.max(0, toNumber(track.duration)),
      size: summary.size + Math.max(0, toNumber(track.size)),
      plays: summary.plays + Math.max(0, Math.floor(toNumber(track.playCount))),
    }),
    { count: 0, duration: 0, size: 0, plays: 0 },
  );
}

export function formatDuration(value) {
  const total = Math.max(0, Math.floor(toNumber(value)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const padded = (part) => String(part).padStart(2, '0');
  if (hours) return `${hours}:${padded(minutes)}:${padded(seconds)}`;
  return `${minutes}:${padded(seconds)}`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(value) {
  let bytes = toNumber(value);
  if (bytes <= 0) return '0 B';
  let unit = 0;
  while (bytes >= 1024 && unit < BYTE_UNITS.length - 1) {
    bytes /= 1024;
    unit += 1;
  }
  const precision = unit === 0 || bytes >= 100 ? 0 : 1;
  const rounded = bytes.toFixed(precision).replace(/\.0$/, '');
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

export function formatDate(value) {
  const time = toTimestamp(value);
  if (!time) return '';
  const date = new Date(time);
  const padded = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${padded(date.getMonth() + 1)}-${padded(date.getDate())}`;
}

const dayIndex = (time) => {
  const date = new Date(time);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
};

export function formatAddedAt(value, now = Date.now()) {
  const time = toTimestamp(value);
  if (!time) return '';
  const reference = toTimestamp(now) || Date.now();
  const days = Math.round((dayIndex(reference) - dayIndex(time)) / DAY);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  return formatDate(time);
}
