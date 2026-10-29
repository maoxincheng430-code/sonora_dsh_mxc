const clamp = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

// 频段边界按 fftSize/sampleRate 换算为 bin 下标，极小的 fftSize 也至少保留一个 bin。
function bandEnd(frequencies, sampleRate, fftSize, hz, minimum) {
  const ratio = sampleRate > 0 && fftSize > 0 ? fftSize / sampleRate : 1;
  return Math.min(frequencies.length, Math.max(minimum, Math.ceil(hz * ratio)));
}

function bandMean(frequencies, from, to) {
  const total = frequencies.length;
  if (!total) return 0;
  const start = Math.min(total - 1, Math.max(0, from));
  const end = Math.min(total, Math.max(start + 1, to));
  let sum = 0;
  for (let i = start; i < end; i++) sum += frequencies[i] / 255;
  return clamp(sum / (end - start));
}

export function analyzeAudio(waveform, frequencies, sampleRate, fftSize) {
  let energy = 0;
  for (const value of waveform) energy += ((value - 128) / 128) ** 2;
  const bassEnd = bandEnd(frequencies, sampleRate, fftSize, 250, 1);
  const midEnd = bandEnd(frequencies, sampleRate, fftSize, 2000, bassEnd + 1);
  const trebleEnd = bandEnd(frequencies, sampleRate, fftSize, 8000, midEnd + 1);
  return {
    volume: clamp(Math.sqrt(energy / (waveform.length || 1))),
    bass: bandMean(frequencies, 0, bassEnd),
    mid: bandMean(frequencies, bassEnd, midEnd),
    treble: bandMean(frequencies, midEnd, trebleEnd),
  };
}

export class AudioEngine {
  constructor() {
    this.context = null;
    this.buffer = null;
    this.source = null;
    this.offset = 0;
    this.startedAt = 0;
    this.playing = false;
    this.name = '';
    this.volume = 0.7;
    this.muted = false;
    this.generation = 0;
    this.playGeneration = 0;
    this.disposed = false;
    this.levels = { volume: 0, bass: 0, mid: 0, treble: 0, beat: 0 };
    this.fluxAverage = 0;
    this.lastRawBass = 0;
    this.lastRawVolume = 0;
    this.beatGate = 0;
    this.previousSpectrum = null;
  }


  ensureContext() {
    if (this.disposed) throw new Error('音频引擎已关闭。');
    if (this.context) return this.context;
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) throw new Error('当前浏览器不支持 Web Audio，请使用现代浏览器。');
    this.context = new Context();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.65;
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    this.analyser.connect(this.gain);
    this.gain.connect(this.context.destination);
    this.waveform = new Uint8Array(this.analyser.fftSize);
    this.frequencies = new Uint8Array(this.analyser.frequencyBinCount);
    this.previousSpectrum = new Uint8Array(this.analyser.frequencyBinCount);
    return this.context;
  }

  cancelPendingLoad() {
    ++this.generation;
    ++this.playGeneration;
  }

  async load(file) {
    const generation = ++this.generation;
    if (!file || !file.size) throw new Error('请选择非空音频文件。');
    // 音轨可以来自纯音频，也可以来自 MP4 / M4V / MOV / WebM 等视频容器（只取音轨解码）。
    const supported =
      /^audio\//i.test(file.type || '') ||
      /^video\/(mp4|quicktime|x-m4v|webm|ogg)$/i.test(file.type || '') ||
      /\.(mp3|wav|ogg|oga|m4a|m4b|aac|flac|opus|webm|mp4|m4v|mov|aif|aiff)$/i.test(file.name || '');
    if (!supported || typeof file.arrayBuffer !== 'function') throw new Error('不支持此文件，请选择 MP3、WAV、OGG、FLAC、M4A 或 MP4 等音视频文件。');
    const context = this.ensureContext();
    try {
      const bytes = await file.arrayBuffer();
      if (generation !== this.generation) return;
      const buffer = await context.decodeAudioData(bytes);
      if (generation !== this.generation || this.disposed) return;
      if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('empty');
      this.pause();
      this.buffer = buffer;
      this.offset = 0;
      this.name = file.name || '未命名音频';
      this.resetLevels();
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      throw new Error('音频解码失败，请尝试其他文件或格式。', { cause: error });
    }
  }

  async play() {
    if (!this.buffer) throw new Error('请先加载音频文件。');
    if (this.playing) return;
    const context = this.ensureContext();
    const generation = this.generation;
    const playGeneration = ++this.playGeneration;
    try { await context.resume(); }
    catch (error) { throw new Error('无法启动音频播放，请再次点击播放。', { cause: error }); }
    if (this.disposed || generation !== this.generation || playGeneration !== this.playGeneration || this.playing) return;
    if (this.offset >= this.buffer.duration) this.offset = 0;
    this.startSource();
  }

  startSource() {
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.analyser);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      this.playing = false;
      this.offset = this.buffer.duration;
      source.disconnect();
      this.resetLevels();
    };
    this.source = source;
    this.startedAt = this.context.currentTime;
    this.playing = true;
    source.start(0, this.offset);
  }

  stopSource() {
    const source = this.source;
    this.source = null;
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* A naturally ended source is already stopped. */ }
    source.disconnect();
  }

  pause() {
    ++this.playGeneration;
    this.offset = this.getState().currentTime;
    this.playing = false;
    this.stopSource();
    this.resetLevels();
  }

  seek(seconds) {
    if (!this.buffer || !Number.isFinite(seconds)) return;
    const wasPlaying = this.playing;
    this.stopSource();
    this.offset = Math.min(this.buffer.duration, Math.max(0, seconds));
    if (this.offset >= this.buffer.duration) ++this.playGeneration;
    this.playing = false;
    this.resetLevels();
    if (wasPlaying && this.offset < this.buffer.duration) this.startSource();
  }

  setVolume(value) {
    this.volume = clamp(value);
    if (this.gain) this.gain.gain.value = this.volume;
    // 静音时保持 0，避免调音量把静音「顶开」
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume;
  }

  /** 静音开关：只影响输出音量，不打断播放/分析。 */
  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  /** 暴露解码后的 AudioBuffer（节拍分析用；只读）。 */
  getBuffer() {
    return this.buffer;
  }

  getState() {
    const duration = this.buffer?.duration || 0;
    const elapsed = this.playing ? Math.max(0, this.context.currentTime - this.startedAt) : 0;
    return { loaded: !!this.buffer, playing: this.playing, currentTime: Math.min(duration, this.offset + elapsed), duration, name: this.name, volume: this.volume };
  }

  resetLevels() {
    this.levels = { volume: 0, bass: 0, mid: 0, treble: 0, beat: 0 };
    this.fluxAverage = 0;
    this.lastRawBass = 0;
    this.lastRawVolume = 0;
    this.beatGate = 0;
    this.previousSpectrum?.fill(0);
  }

  sample(dt = 1 / 60) {
    if (!this.playing) return { volume: 0, bass: 0, mid: 0, treble: 0, beat: 0 };
    this.analyser.getByteTimeDomainData(this.waveform);
    this.analyser.getByteFrequencyData(this.frequencies);
    const sampleRate = this.context.sampleRate;
    const fftSize = this.analyser.fftSize;
    const raw = analyzeAudio(this.waveform, this.frequencies, sampleRate, fftSize);
    const delta = Math.min(1, Math.max(0, Number.isFinite(dt) ? dt : 1 / 60));
    const blend = 1 - Math.exp(-delta * 18);
    const slow = 1 - Math.exp(-delta * 2);

    // 低频段谱通量：只累计上升沿，稳态响度不会反复触发。
    const bins = Math.min(this.frequencies.length, Math.max(1, Math.ceil(250 * fftSize / sampleRate)));
    const previous = this.previousSpectrum;
    let flux = 0;
    if (previous && previous.length === this.frequencies.length) {
      for (let i = 0; i < bins; i++) {
        const rise = (this.frequencies[i] - previous[i]) / 255;
        if (rise > 0) flux += rise;
      }
      flux /= bins;
    }
    const bassJump = Math.max(0, raw.bass - this.lastRawBass);
    const volumeJump = Math.max(0, raw.volume - this.lastRawVolume);
    const fluxRise = Math.max(0, flux - this.fluxAverage);
    // 自适应阈值：跟随近期谱通量水平，安静段更灵敏，持续段不抖动。
    const threshold = 0.006 + this.fluxAverage * 0.6;
    const onset = Math.max(fluxRise * 2.8, bassJump * 3.2, volumeJump * 2.2) - threshold;

    this.fluxAverage += (flux - this.fluxAverage) * slow;
    this.lastRawBass = raw.bass;
    this.lastRawVolume = raw.volume;
    if (previous) previous.set(this.frequencies);

    this.levels.volume = clamp(this.levels.volume + (raw.volume - this.levels.volume) * blend);
    this.levels.bass = clamp(this.levels.bass + (raw.bass - this.levels.bass) * blend);
    this.levels.mid = clamp(this.levels.mid + (raw.mid - this.levels.mid) * blend);
    this.levels.treble = clamp(this.levels.treble + (raw.treble - this.levels.treble) * blend);
    this.beatGate = Math.max(0, this.beatGate - delta);
    this.levels.beat = clamp(this.levels.beat * Math.exp(-delta * 9));
    if (onset > 0.09 && this.beatGate <= 0) {
      this.levels.beat = 1;
      this.beatGate = 0.15;
    }
    return { ...this.levels };
  }

  dispose() {
    if (this.disposed) return;
    ++this.generation;
    this.pause();
    this.buffer = null;
    this.name = '';
    this.analyser?.disconnect();
    this.gain?.disconnect();
    this.disposed = true;
    if (this.context) void this.context.close().catch(() => {});
  }
}
