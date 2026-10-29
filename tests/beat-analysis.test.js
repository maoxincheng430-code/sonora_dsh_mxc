import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeBeatGrid,
  beatImpactAt,
  beatPhaseAt,
  energyEnvelope,
  onsetStrength,
  sampleBeat,
} from '../src/beat-analysis.js';

const SAMPLE_RATE = 8000;

/** 合成一段「节拍器」：每 beatInterval 秒一个短促的衰减脉冲。 */
function clickTrack({ bpm = 120, seconds = 12, sampleRate = SAMPLE_RATE, withNoise = false } = {}) {
  const length = Math.floor(seconds * sampleRate);
  const data = new Float32Array(length);
  const interval = 60 / bpm;
  for (let beat = 0; beat * interval < seconds; beat += 1) {
    const start = Math.floor(beat * interval * sampleRate);
    for (let i = 0; i < sampleRate * 0.08 && start + i < length; i += 1) {
      const envelope = Math.exp(-i / (sampleRate * 0.012));
      data[start + i] += Math.sin((i / sampleRate) * Math.PI * 2 * 440) * envelope * 0.9;
    }
  }
  if (withNoise) {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < length; i += 1) data[i] += (random() - 0.5) * 0.05;
  }
  return data;
}

test('energyEnvelope / onsetStrength 归一化并突出起音', () => {
  const data = clickTrack({ bpm: 120, seconds: 6 });
  const envelope = energyEnvelope(data);
  assert.ok(envelope.length > 100);
  for (const value of envelope) assert.ok(value >= 0 && value <= 1);
  const onset = onsetStrength(envelope);
  assert.equal(onset.length, envelope.length);
  const peak = Math.max(...onset);
  assert.ok(peak > 0.5, '起音强度应有明显峰值');
});

test('analyzeBeatGrid 能识别 120 BPM 节拍器（±4 BPM）', () => {
  const grid = analyzeBeatGrid(clickTrack({ bpm: 120 }), SAMPLE_RATE);
  assert.ok(grid.beats.length > 10);
  assert.ok(Math.abs(grid.bpm - 120) <= 4, `BPM 应接近 120，实际 ${grid.bpm}`);
  assert.ok(grid.confidence > 0.2);
  // 拍间隔接近 0.5s
  const intervals = grid.beats.slice(1).map((time, index) => time - grid.beats[index]);
  const median = intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)];
  assert.ok(Math.abs(median - 0.5) < 0.06, `拍间隔应≈0.5s，实际 ${median}`);
});

test('analyzeBeatGrid 能识别 100 BPM，且拍点落在脉冲附近', () => {
  const grid = analyzeBeatGrid(clickTrack({ bpm: 100 }), SAMPLE_RATE);
  assert.ok(Math.abs(grid.bpm - 100) <= 4, `实际 ${grid.bpm}`);
  const interval = 60 / 100;
  // 每个合成脉冲时刻附近应有拍点（容差 80ms）
  for (let beat = 1; beat * interval < 11; beat += 1) {
    const target = beat * interval;
    const near = grid.beats.some((time) => Math.abs(time - target) < 0.08);
    assert.ok(near, `拍点应覆盖 ${target.toFixed(2)}s`);
  }
  assert.ok(grid.downbeats.length > 0);
  assert.ok(grid.downbeats.length < grid.beats.length);
});

test('analyzeBeatGrid 对静音/噪声给出空结果或低保真', () => {
  assert.deepEqual(analyzeBeatGrid(new Float32Array(8000 * 5), SAMPLE_RATE).beats, []);
  assert.equal(analyzeBeatGrid(null, SAMPLE_RATE).bpm, 0);
  assert.equal(analyzeBeatGrid(new Float32Array(0), SAMPLE_RATE).bpm, 0);
});

test('beatImpactAt 拍点处为 1 并指数衰减', () => {
  const beats = [1, 2, 3];
  assert.equal(beatImpactAt(beats, 0.5), 0);
  assert.equal(beatImpactAt(beats, 1), 1);
  assert.ok(beatImpactAt(beats, 1.1) < 1);
  assert.ok(beatImpactAt(beats, 1.1) > beatImpactAt(beats, 1.3));
  assert.equal(beatImpactAt([], 1), 0);
});

test('beatPhaseAt 返回当前拍与小节内相位', () => {
  const beats = [0, 0.5, 1, 1.5];
  assert.deepEqual(beatPhaseAt(beats, -1), { phase: 0, index: -1 });
  assert.equal(beatPhaseAt(beats, 0.25).index, 0);
  assert.ok(Math.abs(beatPhaseAt(beats, 0.25).phase - 0.5) < 1e-6);
  assert.equal(beatPhaseAt(beats, 1.6).index, 3);
});

test('sampleBeat 同时给出拍点、重拍与相位', () => {
  const beats = [0, 0.5, 1, 1.5, 2];
  const downbeats = [0, 2];
  const atBeat = sampleBeat(beats, downbeats, 2);
  assert.ok(Math.abs(atBeat.impact - 1) < 1e-6);
  assert.ok(Math.abs(atBeat.downbeat - 1) < 1e-6);
  const offBeat = sampleBeat(beats, downbeats, 2.25);
  assert.ok(offBeat.impact < 0.3);
  assert.ok(offBeat.downbeat < 0.5);
  assert.ok(offBeat.phase > 0 && offBeat.phase < 1);
});
