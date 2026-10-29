import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, analyzeAudio } from '../src/audio.js';

class FakeContext {
  static latest;
  constructor() { FakeContext.latest = this; this.currentTime = 0; this.sampleRate = 48000; this.destination = {}; this.sources = []; }
  createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, connect() {}, disconnect() {}, getByteFrequencyData(a) { a.fill(180); }, getByteTimeDomainData(a) { a.fill(180); } }; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  createBufferSource() { const source = { connect() {}, disconnect() {}, start(when, offset) { this.offset = offset; }, stop() { this.onended?.(); } }; this.sources.push(source); return source; }
  async decodeAudioData() { return { duration: 20 }; }
  async resume() {}
  async close() { this.closed = true; }
}
globalThis.AudioContext = FakeContext;
const file = (name = 'song.mp3') => ({ name, size: 8, type: 'audio/mpeg', arrayBuffer: async () => new ArrayBuffer(8) });

test('load validates files and does not autoplay', async () => {
  const engine = new AudioEngine();
  await assert.rejects(engine.load({ ...file(), size: 0 }), /空/);
  await assert.rejects(engine.load({ ...file('bad.txt'), type: 'text/plain' }), /支持/);
  await engine.load(file());
  assert.deepEqual(engine.getState(), { loaded: true, playing: false, currentTime: 0, duration: 20, name: 'song.mp3', volume: 0.7 });
  engine.dispose();
});

test('load accepts video containers (MP4 / MOV / WebM) and decodes their audio track', async () => {
  const engine = new AudioEngine();
  for (const [name, type] of [
    ['Midnight Rain.mp4', 'video/mp4'],
    ['music.m4v', 'video/x-m4v'],
    ['clip.mov', 'video/quicktime'],
    ['clip.webm', 'video/webm'],
    ['track.m4b', 'audio/mp4'],
  ]) {
    await engine.load({ name, size: 8, type, arrayBuffer: async () => new ArrayBuffer(8) });
    assert.equal(engine.getState().loaded, true, `${name} should load`);
    assert.equal(engine.getState().name, name);
  }
  engine.dispose();
});

test('playback clock, pause, seek, ended and volume stay consistent', async () => {
  const engine = new AudioEngine();
  await engine.load(file());
  await engine.play();
  const context = FakeContext.latest;
  context.currentTime = 3;
  assert.equal(engine.getState().currentTime, 3);
  engine.pause();
  context.currentTime = 8;
  assert.equal(engine.getState().currentTime, 3);
  await engine.play();
  engine.seek(10);
  assert.equal(context.sources.at(-1).offset, 10);
  engine.setVolume(-1);
  assert.equal(engine.getState().volume, 0);
  context.sources.at(-1).onended();
  assert.equal(engine.getState().playing, false);
  assert.equal(engine.getState().currentTime, 20);
  engine.dispose();
  assert.equal(context.closed, true);
});

test('latest file wins when asynchronous decoding completes out of order', async () => {
  const engine = new AudioEngine();
  await engine.load(file('initial.mp3'));
  let finish;
  FakeContext.latest.decodeAudioData = () => new Promise(resolve => { finish = resolve; });
  const slow = engine.load(file('old.mp3'));
  await Promise.resolve();
  FakeContext.latest.decodeAudioData = async () => ({ duration: 30 });
  await engine.load(file('new.mp3'));
  finish({ duration: 10 });
  await slow;
  assert.equal(engine.getState().name, 'new.mp3');
  assert.equal(engine.getState().duration, 30);
  engine.dispose();
});

test('failed decode preserves prior track and disposal invalidates pending load', async () => {
  const engine = new AudioEngine();
  await engine.load(file('good.mp3'));
  FakeContext.latest.decodeAudioData = async () => { throw new Error('bad codec'); };
  await assert.rejects(engine.load(file('broken.mp3')), /解码失败/);
  assert.equal(engine.getState().name, 'good.mp3');
  let finish;
  FakeContext.latest.decodeAudioData = () => new Promise(resolve => { finish = resolve; });
  const pending = engine.load(file('pending.mp3'));
  await Promise.resolve();
  engine.dispose();
  finish({ duration: 10 });
  await pending;
  assert.equal(engine.getState().loaded, false);
});

test('pause cancels playback while browser audio resume is pending', async () => {
  const engine = new AudioEngine();
  await engine.load(file());
  let resumed;
  FakeContext.latest.resume = () => new Promise(resolve => { resumed = resolve; });
  const pending = engine.play();
  engine.pause();
  resumed();
  await pending;
  assert.equal(engine.getState().playing, false);
  engine.dispose();
});

test('invalid new selection supersedes a pending older decode', async () => {
  const engine = new AudioEngine();
  await engine.load(file('initial.mp3'));
  for (const invalid of [{ ...file(), size: 0 }, { ...file('latest.txt'), type: 'text/plain' }]) {
    let finish;
    FakeContext.latest.decodeAudioData = () => new Promise(resolve => { finish = resolve; });
    const older = engine.load(file('older.mp3'));
    await Promise.resolve();
    await assert.rejects(engine.load(invalid));
    finish({ duration: 30 });
    await older;
    assert.equal(engine.getState().name, 'initial.mp3');
    assert.equal(engine.getState().duration, 20);
  }
  engine.dispose();
});

test('seek to end cancels pending play while ordinary seek preserves intent', async () => {
  const engine = new AudioEngine();
  await engine.load(file());
  let resumed;
  FakeContext.latest.resume = () => new Promise(resolve => { resumed = resolve; });
  let pending = engine.play();
  engine.seek(8);
  resumed();
  await pending;
  assert.equal(engine.getState().playing, true);
  assert.equal(engine.getState().currentTime, 8);
  engine.pause();
  pending = engine.play();
  engine.seek(20);
  resumed();
  await pending;
  assert.equal(engine.getState().playing, false);
  assert.equal(engine.getState().currentTime, 20);
  engine.dispose();
});

test('analysis is normalized, silent at rest, and independent of output volume', async () => {
  assert.deepEqual(analyzeAudio(new Uint8Array(8).fill(128), new Uint8Array(8), 48000, 16), { volume: 0, bass: 0, mid: 0, treble: 0 });
  const loud = analyzeAudio(new Uint8Array(8).fill(255), new Uint8Array(8).fill(255), 48000, 16);
  assert.ok(loud.volume > 0.9 && loud.volume <= 1);
  assert.equal(loud.bass, 1);
  assert.equal(loud.mid, 1);
  assert.equal(loud.treble, 1);
  const engine = new AudioEngine();
  await engine.load(file());
  await engine.play();
  engine.setVolume(0);
  const sample = engine.sample(0.1);
  assert.ok(sample.volume > 0 && sample.bass > 0);
  assert.ok(sample.mid > 0 && sample.treble > 0);
  for (const value of Object.values(sample)) assert.ok(value >= 0 && value <= 1);
  engine.pause();
  assert.deepEqual(engine.sample(1), { volume: 0, bass: 0, mid: 0, treble: 0, beat: 0 });
  engine.dispose();
});

test('analyzeAudio separates bass, mid and treble bands and handles tiny fft sizes', () => {
  const sampleRate = 48000;
  const fftSize = 2048;
  const spectrum = () => new Uint8Array(1024);
  const silence = new Uint8Array(8).fill(128);
  const measure = frequencies => analyzeAudio(silence, frequencies, sampleRate, fftSize);
  const bassOnly = spectrum();
  for (let i = 0; i <= 10; i++) bassOnly[i] = 255;
  const bass = measure(bassOnly);
  assert.ok(bass.bass > 0.95 && bass.mid < 0.01 && bass.treble < 0.01);
  const midOnly = spectrum();
  for (let i = 11; i <= 85; i++) midOnly[i] = 255;
  const mid = measure(midOnly);
  assert.ok(mid.mid > 0.95 && mid.bass < 0.01 && mid.treble < 0.01);
  const trebleOnly = spectrum();
  for (let i = 86; i <= 341; i++) trebleOnly[i] = 255;
  const treble = measure(trebleOnly);
  assert.ok(treble.treble > 0.95 && treble.bass < 0.01 && treble.mid < 0.01);
  const half = measure(spectrum().fill(255));
  assert.ok(half.bass > 0.9 && half.mid > 0.9 && half.treble > 0.9);
  // fftSize 很小（bin 宽度远大于频段）时仍要返回 0..1 的有限值且不越界。
  const tiny = analyzeAudio(new Uint8Array(8).fill(128), Uint8Array.from([255, 0, 0, 0, 0, 0, 0, 0]), 48000, 16);
  assert.deepEqual(tiny, { volume: 0, bass: 1, mid: 0, treble: 0 });
  const single = analyzeAudio(silence, Uint8Array.from([255]), 48000, 16);
  assert.ok(single.bass === 1 && single.mid === 1 && single.treble === 1);
  const empty = analyzeAudio(silence, new Uint8Array(0), 48000, 16);
  assert.deepEqual(empty, { volume: 0, bass: 0, mid: 0, treble: 0 });
});

test('beat onset reacts to fresh low hits without retriggering on the decay tail', async () => {
  const engine = new AudioEngine();
  await engine.load(file());
  await engine.play();
  const analyser = engine.analyser;
  const feed = (frequency, waveform = frequency ? 210 : 128) => {
    analyser.getByteFrequencyData = array => array.fill(frequency);
    analyser.getByteTimeDomainData = array => array.fill(waveform);
  };
  feed(0);
  for (let i = 0; i < 5; i++) assert.ok(engine.sample(0.02).beat < 0.05);
  feed(210);
  const hit = engine.sample(0.02);
  assert.equal(hit.beat, 1);
  assert.ok(hit.bass > 0 && hit.mid > 0 && hit.treble > 0);
  // 同一响度持续时不应再次触发，包络只能单调衰减。
  let previous = hit.beat;
  for (let i = 0; i < 12; i++) {
    const beat = engine.sample(0.05).beat;
    assert.ok(beat <= previous + 1e-9);
    previous = beat;
  }
  assert.ok(previous < 0.1);
  // 尾部归零后的新重拍仍要灵敏触发。
  feed(0);
  for (let i = 0; i < 4; i++) engine.sample(0.05);
  feed(210);
  assert.equal(engine.sample(0.02).beat, 1);
  engine.pause();
  assert.deepEqual(engine.sample(0.02), { volume: 0, bass: 0, mid: 0, treble: 0, beat: 0 });
  engine.dispose();
});

test('setMuted 静音主增益归零，取消静音恢复音量，且不打断播放', async () => {
  const engine = new AudioEngine();
  await engine.load(file());
  await engine.play();
  engine.setVolume(0.4);
  assert.equal(engine.gain.gain.value, 0.4);
  assert.equal(engine.setMuted(true), true);
  assert.equal(engine.gain.gain.value, 0, '静音后主增益为 0');
  assert.equal(engine.getState().playing, true, '静音不打断播放');
  engine.setVolume(0.8);
  assert.equal(engine.gain.gain.value, 0, '静音状态下调音量不会出声');
  assert.equal(engine.getState().volume, 0.8, '音量值仍然记住');
  engine.setMuted(false);
  assert.equal(engine.gain.gain.value, 0.8, '取消静音恢复记住的音量');
  engine.dispose();
});
