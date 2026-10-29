import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCompletedSession,
  addStudySeconds,
  formatStudyDuration,
  loadFocusStats,
  loadFocusHistory,
  saveFocusHistory,
  recordFocusDay,
  focusStreak,
  previousDayKey,
  normalizeFocusHistory,
  dailyGoalProgress,
  normalizeFocusStats,
  saveFocusStats,
  todayKey,
  FOCUS_STORAGE_KEY,
  FOCUS_HISTORY_KEY,
} from '../src/study-stats.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    map,
  };
}

test('todayKey 用本地时区（东八区凌晨不会被算成前一天）', () => {
  assert.equal(todayKey(new Date(2026, 9, 27, 0, 30)), '2026-10-27');
  assert.equal(todayKey(new Date(2026, 0, 1, 23, 59)), '2026-01-01');
});

test('normalizeFocusStats 兼容旧数据（只有 minutes）与损坏数据', () => {
  assert.deepEqual(normalizeFocusStats(null, '2026-10-27'), {
    date: '2026-10-27',
    sessions: 0,
    minutes: 0,
    seconds: 0,
  });
  const legacy = normalizeFocusStats({ date: '2026-10-27', sessions: 2, minutes: 50 }, '2026-10-27');
  assert.equal(legacy.seconds, 3000);
  const broken = normalizeFocusStats({ sessions: -3, minutes: 'x', seconds: NaN }, '2026-10-27');
  assert.equal(broken.sessions, 0);
  assert.equal(broken.seconds, 0);
});

test('addStudySeconds 累加整秒并同步分钟', () => {
  let stats = normalizeFocusStats(null, '2026-10-27');
  stats = addStudySeconds(stats, 90);
  assert.equal(stats.seconds, 90);
  assert.equal(stats.minutes, 1);
  stats = addStudySeconds(stats, 300);
  assert.equal(stats.seconds, 390);
  assert.equal(stats.minutes, 6);
  // 非法值与负数忽略
  assert.equal(addStudySeconds(stats, -5).seconds, 390);
  assert.equal(addStudySeconds(stats, NaN).seconds, 390);
});

test('addCompletedSession 只加个数，不重复计时长', () => {
  const before = { date: '2026-10-27', sessions: 1, minutes: 5, seconds: 320 };
  const after = addCompletedSession(before);
  assert.equal(after.sessions, 2);
  assert.equal(after.seconds, 320);
});

test('formatStudyDuration 输出分钟 / 小时格式', () => {
  assert.equal(formatStudyDuration(0), '0 分钟');
  assert.equal(formatStudyDuration(59), '0 分钟');
  assert.equal(formatStudyDuration(60), '1 分钟');
  assert.equal(formatStudyDuration(3599), '59 分钟');
  assert.equal(formatStudyDuration(3600), '1 小时');
  assert.equal(formatStudyDuration(3900), '1 小时 5 分钟');
  assert.equal(formatStudyDuration(NaN), '0 分钟');
});

test('loadFocusStats 跨天归零，saveFocusStats 可回读', () => {
  const storage = fakeStorage();
  const today = '2026-10-27';
  const stats = addStudySeconds(normalizeFocusStats(null, today), 125);
  saveFocusStats(storage, stats);
  assert.deepEqual(loadFocusStats(storage, today), stats);
  // 换一天 → 归零
  assert.deepEqual(loadFocusStats(storage, '2026-10-28'), {
    date: '2026-10-28',
    sessions: 0,
    minutes: 0,
    seconds: 0,
  });
  // 损坏 JSON 不抛错
  const broken = fakeStorage({ [FOCUS_STORAGE_KEY]: '{oops' });
  assert.equal(loadFocusStats(broken, today).seconds, 0);
  // 无 storage 也不崩
  assert.equal(loadFocusStats(null, today).seconds, 0);
});


// ---------- 连续打卡 / 每日目标 ----------
test('focusStreak：连续天数从今天或昨天往前数', () => {
  const history = recordFocusDay(
    recordFocusDay(recordFocusDay({}, '2026-10-25', 1200), '2026-10-26', 3600),
    '2026-10-27',
    1800,
  );
  assert.deepEqual(focusStreak(history, '2026-10-27'), { days: 3, through: '2026-10-27' });
  // 今天还没学：从昨天往前数，streak 保留
  assert.deepEqual(focusStreak(history, '2026-10-28'), { days: 3, through: '2026-10-27' });
  // 中间断一天：只算到今天
  const broken = recordFocusDay(recordFocusDay({}, '2026-10-26', 600), '2026-10-27', 600);
  delete broken['2026-10-26'];
  assert.deepEqual(focusStreak(broken, '2026-10-27'), { days: 1, through: '2026-10-27' });
  assert.deepEqual(focusStreak({}, '2026-10-27'), { days: 0, through: '' });
});

test('recordFocusDay：脏数据过滤、秒数只增不减、跨月正确', () => {
  let history = recordFocusDay({ bad: 100, '2026-02-28': 300 }, '2026-02-28', 500);
  assert.equal(history.bad, undefined);
  assert.equal(history['2026-02-28'], 500);
  history = recordFocusDay(history, '2026-02-28', 200);
  assert.equal(history['2026-02-28'], 500, '刷新后不能倒退');
  assert.equal(previousDayKey('2026-03-01'), '2026-02-28');
  assert.equal(previousDayKey('2026-01-01'), '2025-12-31');
  assert.deepEqual(normalizeFocusHistory({ '2026-10-01': { seconds: 120 }, '2026-10-02': -5 }), { '2026-10-01': 120 });
});

test('dailyGoalProgress：默认 60 分钟目标，百分比封顶 100', () => {
  assert.deepEqual(dailyGoalProgress(0), { percent: 0, goalMinutes: 60, reached: false, remainingSeconds: 3600 });
  assert.equal(dailyGoalProgress(1800).percent, 50);
  assert.equal(dailyGoalProgress(3600).reached, true);
  assert.equal(dailyGoalProgress(7200).percent, 100);
  assert.equal(dailyGoalProgress(600, 20).percent, 50);
});

test('loadFocusHistory / saveFocusHistory：localStorage 往返', () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  };
  assert.deepEqual(loadFocusHistory(storage), {});
  saveFocusHistory(storage, { '2026-10-27': 1200, bad: 1 });
  assert.deepEqual(loadFocusHistory(storage), { '2026-10-27': 1200 });
  store.set(FOCUS_HISTORY_KEY, '{broken');
  assert.deepEqual(loadFocusHistory(storage), {});
});
