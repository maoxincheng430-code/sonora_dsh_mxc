import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPomodoro,
  formatPomodoroTime,
  mascotPosition,
  PHASES,
  PHASE_LABELS,
  RING_CIRCUMFERENCE,
} from '../src/pomodoro.js';

// 可注入 now / setInterval / clearInterval 的手动驱动沙箱：测试完全确定、无真实定时器。
function harness(options = {}) {
  let clock = 0;
  const cbs = new Map();
  let nextId = 0;
  const api = createPomodoro({
    work: options.work ?? 25,
    rest: options.rest ?? 5,
    longRest: options.longRest,
    autoNext: options.autoNext,
    mode: options.mode,
    countdown: options.countdown,
    onPhaseComplete: options.onPhaseComplete,
    now: () => clock,
    setInterval: fn => {
      const id = ++nextId;
      cbs.set(id, fn);
      return id;
    },
    clearInterval: id => {
      cbs.delete(id);
    },
    document: null,
  });
  return {
    api,
    advance(ms) {
      clock += ms;
    },
    fire() {
      for (const fn of [...cbs.values()]) fn();
    },
    intervalCount: () => cbs.size,
  };
}

test('PHASES / 标签 / 环形周长常量', () => {
  assert.deepEqual(PHASES, ['work', 'rest']);
  assert.equal(PHASE_LABELS.work, '专注');
  assert.equal(PHASE_LABELS.rest, '休息');
  assert.ok(Math.abs(RING_CIRCUMFERENCE - 326.72) < 0.01);
});

test('formatPomodoroTime 纯函数', () => {
  assert.equal(formatPomodoroTime(0), '00:00');
  assert.equal(formatPomodoroTime(65000), '01:05');
  assert.equal(formatPomodoroTime(1500000), '25:00');
  assert.equal(formatPomodoroTime(-5), '00:00');
  assert.equal(formatPomodoroTime(NaN), '00:00');
});

test('默认状态：专注 25 分钟、未运行', () => {
  const { api } = harness();
  const s = api.getState();
  assert.equal(s.phase, 'work');
  assert.equal(s.minutes, 25);
  assert.equal(s.remainingMs, 25 * 60000);
  assert.equal(s.running, false);
  assert.equal(s.label, '专注');
  assert.equal(s.remainingText, '25:00');
});

test('setMinutes 设置当前阶段时长并复位倒计时，越界被钳制', () => {
  const { api } = harness();
  api.setMinutes(45);
  let s = api.getState();
  assert.equal(s.minutes, 45);
  assert.equal(s.remainingMs, 45 * 60000);
  assert.equal(s.running, false);
  api.setMinutes(1000);
  assert.equal(api.getState().minutes, 180);
  api.setMinutes(0);
  assert.equal(api.getState().minutes, 0.05);
});

test('setPhase 在专注/休息间切换（各自独立时长），非法值抛错', () => {
  const { api } = harness({ work: 30, rest: 10 });
  api.setPhase('rest');
  let s = api.getState();
  assert.equal(s.phase, 'rest');
  assert.equal(s.minutes, 10);
  assert.equal(s.label, '休息');
  assert.equal(s.remainingMs, 10 * 60000);
  api.setPhase('work');
  s = api.getState();
  assert.equal(s.phase, 'work');
  assert.equal(s.minutes, 30);
  api.setPhase('rest');
  api.setMinutes(3); // rest 阶段改的是休息时长
  assert.equal(api.getState().minutes, 3);
  assert.throws(() => api.setPhase('pomodoro'), TypeError);
});

test('start 后剩余时间按 Date.now 差值递减（无漂移）', () => {
  const { api, advance, fire } = harness();
  api.start();
  assert.equal(api.getState().running, true);
  advance(5000);
  fire();
  assert.equal(api.getState().remainingMs, 25 * 60000 - 5000);
  advance(1000);
  fire();
  assert.equal(api.getState().remainingMs, 25 * 60000 - 6000);
  assert.equal(api.getState().remainingText, '24:54');
});

test('pause 停止计时，暂停期间时间流逝不影响；再次 start 从暂停处继续', () => {
  const { api, advance, fire, intervalCount } = harness();
  api.start();
  advance(3000);
  fire();
  api.pause();
  assert.equal(api.getState().running, false);
  assert.equal(api.getState().remainingMs, 25 * 60000 - 3000);
  assert.equal(intervalCount(), 0, '暂停后定时器已清理');
  advance(90000);
  fire(); // 定时器已清，无 tick
  assert.equal(api.getState().remainingMs, 25 * 60000 - 3000);
  api.start();
  advance(2000);
  fire();
  assert.equal(api.getState().remainingMs, 25 * 60000 - 5000);
});

test('reset 停止计时并复位为当前阶段完整时长', () => {
  const { api, advance, fire } = harness();
  api.start();
  advance(12000);
  fire();
  api.reset();
  const s = api.getState();
  assert.equal(s.running, false);
  assert.equal(s.remainingMs, 25 * 60000);
  assert.equal(s.minutes, 25);
});

test('阶段完成触发 onPhaseComplete 并（autoNext）自动进入下一阶段', () => {
  const calls = [];
  const { api, advance, fire } = harness({
    work: 0.05, // 0.05 分钟 = 3s（受 MIN_MINUTES 下界约束）
    rest: 5,
    onPhaseComplete: c => calls.push(c),
  });
  api.start();
  advance(3500);
  fire();
  assert.deepEqual(calls, [{ phase: 'work', nextPhase: 'rest' }]);
  let s = api.getState();
  assert.equal(s.phase, 'rest');
  assert.equal(s.running, true, 'autoNext 默认自动开始休息');
  assert.equal(s.remainingMs, 5 * 60000);
  // 休息结束后回到专注
  advance(5 * 60000 + 1000);
  fire();
  assert.deepEqual(calls[1], { phase: 'rest', nextPhase: 'work' });
  s = api.getState();
  assert.equal(s.phase, 'work');
  assert.equal(s.running, true);
  assert.ok(s.remainingMs <= 3000);
});

test('autoNext=false 完成即停止；onPhaseComplete 可事后赋值；reset 后可再开始', () => {
  const calls = [];
  const { api, advance, fire } = harness({ work: 0.05, autoNext: false });
  api.onPhaseComplete = c => calls.push(c); // 属性赋值也生效
  api.start();
  advance(3500);
  fire();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { phase: 'work', nextPhase: 'rest' });
  let s = api.getState();
  assert.equal(s.running, false);
  assert.equal(s.remainingMs, 0);
  assert.equal(s.phase, 'work');
  api.reset();
  api.start();
  assert.equal(api.getState().running, true);
});

test('dispose 停止计时与定时器，之后的操作全部 no-op', () => {
  const { api, advance, fire, intervalCount } = harness();
  api.start();
  advance(1000);
  fire();
  assert.equal(api.getState().remainingMs, 25 * 60000 - 1000);
  api.dispose();
  assert.equal(intervalCount(), 0, '定时器已清理');
  assert.equal(api.getState().running, false);
  api.start();
  api.reset();
  api.setMinutes(10);
  assert.equal(api.getState().running, false, 'dispose 后 start 无效');
  assert.equal(api.getState().remainingMs, 25 * 60000 - 1000, 'dispose 后状态不再被改动');
});

test('倒计时模式：自定义时长、到点停在 00:00、不进入休息', () => {
  const calls = [];
  const { api, advance, fire } = harness({ mode: 'countdown', countdown: 5, onPhaseComplete: (c) => calls.push(c) });
  const s0 = api.getState();
  assert.equal(s0.mode, 'countdown');
  assert.equal(s0.modeLabel, '倒计时');
  assert.equal(s0.label, '倒计时');
  assert.equal(s0.remainingMs, 5 * 60000);

  api.start();
  advance(5 * 60000 + 500);
  fire();
  const s1 = api.getState();
  assert.equal(s1.running, false);
  assert.equal(s1.remainingMs, 0);
  assert.equal(s1.phase, 'work', '倒计时结束不会切到休息');
  assert.deepEqual(calls, [{ phase: 'work', nextPhase: 'rest' }]);
});

test('正计时模式：从 0 往上走，暂停冻结，reset 归零', () => {
  const { api, advance, fire } = harness({ mode: 'stopwatch' });
  let s = api.getState();
  assert.equal(s.label, '正计时');
  assert.equal(s.remainingMs, 0);
  assert.equal(s.remainingText, '00:00');

  api.start();
  advance(65000);
  fire();
  assert.equal(api.getState().remainingText, '01:05');

  api.pause();
  assert.equal(api.getState().running, false);
  advance(30000);
  fire();
  assert.equal(api.getState().remainingText, '01:05', '暂停后不再走');

  api.reset();
  assert.equal(api.getState().remainingText, '00:00');
});

test('setMode / setCountdown / setAutoNext 生效，非法模式抛错', () => {
  const { api } = harness();
  assert.equal(api.getState().mode, 'pomodoro');

  api.setMode('stopwatch');
  assert.equal(api.getState().mode, 'stopwatch');
  assert.equal(api.getState().remainingMs, 0);

  api.setMode('countdown');
  api.setCountdown(40);
  assert.equal(api.getState().remainingMs, 40 * 60000);
  api.setCountdown(1000);
  assert.equal(api.getState().countdown, 240, '倒计时时长上限 240 分钟');

  api.setMode('pomodoro');
  assert.equal(api.getState().remainingMs, 25 * 60000);

  assert.equal(api.getState().autoNext, true);
  api.setAutoNext(false);
  assert.equal(api.getState().autoNext, false);
  assert.throws(() => api.setMode('nope'), TypeError);
});
test('mascotPosition 把进度映射到圆环上（0 在正上方，顺时针）', () => {
  const top = mascotPosition(0);
  assert.ok(Math.abs(top.x - 50) < 0.01);
  assert.ok(Math.abs(top.y - 6.7) < 0.1);
  assert.equal(top.facing, 'right');

  const right = mascotPosition(0.25);
  assert.ok(Math.abs(right.x - 93.3) < 0.1);
  assert.ok(Math.abs(right.y - 50) < 0.01);

  const bottom = mascotPosition(0.5);
  assert.ok(Math.abs(bottom.x - 50) < 0.01);
  assert.ok(Math.abs(bottom.y - 93.3) < 0.1);
  assert.equal(bottom.facing, 'left');

  const left = mascotPosition(0.75);
  assert.ok(Math.abs(left.x - 6.7) < 0.1);
  assert.ok(Math.abs(left.y - 50) < 0.01);

  // 越过左侧后重新朝右
  assert.equal(mascotPosition(0.9).facing, 'right');
  assert.equal(mascotPosition(0.6).facing, 'left');
});

test('mascotPosition 钳制越界进度', () => {
  assert.deepEqual(mascotPosition(-1), mascotPosition(0));
  assert.deepEqual(mascotPosition(2), mascotPosition(1));
  assert.deepEqual(mascotPosition(NaN), mascotPosition(0));
});

test('每 4 个番茄后进入长休息（默认 15 分钟）', () => {
  const { api, advance, fire } = harness({ work: 1, rest: 1, longRest: 2 });
  api.start();
  assert.equal(api.getState().longBreak, false);
  assert.equal(api.getState().longRestMinutes, 2);

  for (let i = 1; i <= 4; i += 1) {
    advance(60 * 1000);
    fire(); // 完成第 i 个工作阶段，自动进入休息
    if (i < 4) {
      advance(60 * 1000);
      fire(); // 休息结束，回到工作
    }
  }

  const state = api.getState();
  assert.equal(state.phase, 'rest');
  assert.equal(state.longBreak, true);
  assert.equal(state.label, '长休息');
  assert.equal(state.remainingMs, 2 * 60 * 1000);
  assert.equal(state.workCompleted, 4);

  // 长休息结束后回到工作，长休息标记清空
  advance(2 * 60 * 1000);
  fire();
  const next = api.getState();
  assert.equal(next.phase, 'work');
  assert.equal(next.longBreak, false);
  assert.equal(next.label, '专注');
});
