// 专注统计（纯函数，便于单测）：
//   · 本地日期 key（按用户本地时区，跨零点归零）
//   · 今日总学习秒数的累加、格式化、localStorage 读写
// 存储结构（localStorage `sonora-focus-stats`）：
//   { date: 'YYYY-MM-DD', sessions: 完成番茄数, minutes: 完成番茄的分钟数, seconds: 今日学习总秒数 }

export const FOCUS_STORAGE_KEY = 'sonora-focus-stats';

/** 本地日期（不要用 toISOString，那是 UTC，东八区凌晨会对不上）。 */
export function todayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 把关卡（可能是旧版 / 损坏 / 跨天）的原始数据规整成今天的统计。 */
export function normalizeFocusStats(raw, date = todayKey()) {
  const base = { date, sessions: 0, minutes: 0, seconds: 0 };
  if (!raw || typeof raw !== 'object') return base;
  const sessions = Math.max(0, Math.floor(Number(raw.sessions) || 0));
  const minutes = Math.max(0, Math.floor(Number(raw.minutes) || 0));
  const seconds = Math.max(0, Math.floor(Number(raw.seconds) || 0));
  // 旧版本只存了 minutes：秒数用分钟数补齐，避免升级后显示成 0
  return { date, sessions, minutes, seconds: seconds || minutes * 60 };
}

/** 累加学习秒数（返回新对象，不修改入参）。 */
export function addStudySeconds(stats, deltaSeconds, date = stats?.date || todayKey()) {
  const next = normalizeFocusStats(stats, date);
  const delta = Math.max(0, Math.floor(Number(deltaSeconds) || 0));
  if (delta <= 0) return next;
  return {
    ...next,
    seconds: next.seconds + delta,
    minutes: Math.floor((next.seconds + delta) / 60),
  };
}

/** 累计完成一个番茄（只记个数；时长由 seconds 实时累加，避免重复计）。 */
export function addCompletedSession(stats, date = stats?.date || todayKey()) {
  const next = normalizeFocusStats(stats, date);
  return { ...next, sessions: next.sessions + 1 };
}

/** 秒数 → “X 小时 Y 分钟” / “Y 分钟”。 */
export function formatStudyDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

/** 从 localStorage 读取今天统计（损坏或跨天自动归零）。 */
export function loadFocusStats(storage, date = todayKey()) {
  try {
    const raw = JSON.parse(storage?.getItem(FOCUS_STORAGE_KEY) || 'null');
    if (raw && raw.date === date) return normalizeFocusStats(raw, date);
  } catch {
    // 忽略损坏的本地数据
  }
  return normalizeFocusStats(null, date);
}

export function saveFocusStats(storage, stats) {
  try {
    storage?.setItem(FOCUS_STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // 隐私模式 / 配额不足时忽略
  }
}

// ---------- 连续打卡 / 每日目标（GitHub 上 FlowTimer / customodoro 的常见功能） ----------
export const FOCUS_HISTORY_KEY = 'sonora-focus-history';
export const DEFAULT_DAILY_GOAL_MINUTES = 60;

/** 历史记录：{ 'YYYY-MM-DD': 当天学习秒数 }，容忍旧格式 / 脏数据。 */
export function normalizeFocusHistory(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const seconds = typeof value === 'number' ? value : Number(value?.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    out[key] = Math.floor(seconds);
  }
  return out;
}

export function loadFocusHistory(storage) {
  try {
    return normalizeFocusHistory(JSON.parse(storage?.getItem(FOCUS_HISTORY_KEY) || 'null'));
  } catch {
    return {};
  }
}

export function saveFocusHistory(storage, history) {
  try {
    storage?.setItem(FOCUS_HISTORY_KEY, JSON.stringify(normalizeFocusHistory(history)));
  } catch {
    // 隐私模式忽略
  }
}

/** 记录某天的学习秒数（只增不减，防止刷新后倒退）。 */
export function recordFocusDay(history, date, seconds) {
  const next = normalizeFocusHistory(history);
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  if (value <= 0) return next;
  next[date] = Math.max(next[date] || 0, value);
  return next;
}

/** 前一天（本地时区，正确处理跨月/跨年）。 */
export function previousDayKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return todayKey(date);
}

/**
 * 连续打卡天数：从今天（今天还没学则从昨天）往前数，遇到没有记录的天就停。
 * @returns {{days:number, through:string}} through 是连续区间的最后一天
 */
export function focusStreak(history, date = todayKey()) {
  const next = normalizeFocusHistory(history);
  const start = next[date] > 0 ? date : previousDayKey(date);
  let cursor = start;
  let days = 0;
  while (cursor && next[cursor] > 0) {
    days += 1;
    cursor = previousDayKey(cursor);
  }
  return { days, through: days > 0 ? start : '' };
}

/** 今日目标进度（默认 60 分钟）。 */
export function dailyGoalProgress(seconds, goalMinutes = DEFAULT_DAILY_GOAL_MINUTES) {
  const goal = Math.max(1, Math.round(Number(goalMinutes) || DEFAULT_DAILY_GOAL_MINUTES));
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const percent = Math.min(100, Math.round((total / (goal * 60)) * 100));
  return { percent, goalMinutes: goal, reached: total >= goal * 60, remainingSeconds: Math.max(0, goal * 60 - total) };
}
