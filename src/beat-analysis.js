// 轻量节拍分析（纯函数，可在 Node 单测）：
//   1. 分帧算 RMS 能量包络
//   2. 能量正差分 → 起音强度（onset strength）
//   3. 60–200 BPM 自相关搜索周期 + 120 BPM 先验（防倍频）
//   4. 用起音峰做最小二乘拟合「周期 + 相位」（整数帧周期误差会让整首慢慢漂）
//   5. 生成拍点并吸附到附近起音峰，标记 4/4 重拍
// 输出：{ bpm, beats: [秒], downbeats: [秒], duration, confidence }
// 不依赖模型/网络；一首 3 分钟的歌约几十毫秒。

const FRAME = 1024;
const HOP = 256;
const MIN_BPM = 60;
const MAX_BPM = 200;

/** 把音频通道数据压成归一化能量包络（每 HOP 个采样一帧）。 */
export function energyEnvelope(channelData, { frame = FRAME, hop = HOP } = {}) {
  const length = channelData?.length ?? 0;
  if (length < frame) return new Float32Array(0);
  const frames = Math.floor((length - frame) / hop) + 1;
  const out = new Float32Array(frames);
  let max = 1e-6;
  for (let f = 0; f < frames; f += 1) {
    const start = f * hop;
    let sum = 0;
    for (let i = 0; i < frame; i += 1) {
      const v = channelData[start + i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / frame);
    out[f] = rms;
    if (rms > max) max = rms;
  }
  for (let f = 0; f < frames; f += 1) out[f] /= max;
  return out;
}

/** 起音强度：能量包络的正向差分（只保留上升沿）。 */
export function onsetStrength(envelope) {
  const length = envelope?.length ?? 0;
  const out = new Float32Array(length);
  let max = 1e-6;
  for (let i = 1; i < length; i += 1) {
    const diff = envelope[i] - envelope[i - 1];
    const value = diff > 0 ? diff : 0;
    out[i] = value;
    if (value > max) max = value;
  }
  for (let i = 0; i < length; i += 1) out[i] /= max;
  return out;
}

const EMPTY_GRID = (duration) => ({ bpm: 0, beats: [], downbeats: [], duration, confidence: 0 });

/** 在浮点帧号处线性插值取起音强度。 */
function onsetAt(onset, frameFloat) {
  const index = Math.floor(frameFloat);
  if (index < 0 || index >= onset.length - 1) return 0;
  const frac = frameFloat - index;
  return onset[index] * (1 - frac) + onset[index + 1] * frac;
}

/**
 * 估计节拍网格。
 * @param {Float32Array} channelData 单声道 PCM（-1..1）
 * @param {number} sampleRate
 * @returns {{bpm:number, beats:number[], downbeats:number[], duration:number, confidence:number}}
 */
export function analyzeBeatGrid(channelData, sampleRate) {
  const duration = (channelData?.length ?? 0) / (sampleRate || 1);
  if (!channelData || !sampleRate || duration < 1) return EMPTY_GRID(duration);

  const envelope = energyEnvelope(channelData);
  const onset = onsetStrength(envelope);
  const frames = onset.length;
  if (frames < 8) return EMPTY_GRID(duration);

  const hopSec = HOP / sampleRate;
  // 分析窗有宽度：把起音时间取在窗口中心，避免拍点系统性提前半窗
  const frameCenter = FRAME / 2 / sampleRate;
  let peak = 0;
  for (let i = 0; i < frames; i += 1) if (onset[i] > peak) peak = onset[i];
  if (peak < 1e-4) return EMPTY_GRID(duration);

  // 1) 周期搜索：起音强度的自相关，乘 120 BPM 先验避免把 120 判成 60
  let bestLag = 0;
  let bestScore = 0;
  const minLag = Math.max(2, Math.round(60 / MAX_BPM / hopSec));
  const maxLag = Math.max(minLag + 1, Math.round(60 / MIN_BPM / hopSec));
  const tempoPrior = (bpm) => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.7, 2));
  const lagScore = (lag) => {
    let score = 0;
    for (let i = lag; i < frames; i += 1) score += onset[i] * onset[i - lag];
    return (score / (frames - lag)) * tempoPrior(60 / (lag * hopSec));
  };
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const score = lagScore(lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (!bestLag) return EMPTY_GRID(duration);
  const halfLag = Math.round(bestLag / 2);
  if (halfLag >= minLag && lagScore(halfLag) >= bestScore * 0.75) bestLag = halfLag;

  // 2) 相位：以 5ms 步长在「整数帧周期」内搜索起音总强度最大的偏移
  const initialPeriod = bestLag * hopSec;
  let phase = 0;
  let bestPhase = -1;
  for (let offset = 0; offset < initialPeriod; offset += 0.005) {
    let score = 0;
    for (let time = offset; time < duration; time += initialPeriod) score += onsetAt(onset, (time - frameCenter) / hopSec);
    if (score > bestPhase) {
      bestPhase = score;
      phase = offset;
    }
  }

  // 3) 起音峰 + 最小二乘拟合周期/相位
  const peakFrames = [];
  for (let f = 2; f < frames - 2; f += 1) {
    if (onset[f] < 0.18) continue;
    const isPeak =
      onset[f] >= onset[f - 1] &&
      onset[f] >= onset[f + 1] &&
      onset[f] >= onset[f - 2] &&
      onset[f] >= onset[f + 2];
    if (isPeak && (!peakFrames.length || f - peakFrames[peakFrames.length - 1] > 2)) peakFrames.push(f);
  }
  let period = initialPeriod;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const ks = [];
    const ts = [];
    for (const frame of peakFrames) {
      const time = frame * hopSec + frameCenter;
      const k = Math.round((time - phase) / period);
      if (k >= 0 && Math.abs(time - (phase + k * period)) < period * (iteration === 0 ? 0.45 : 0.3)) {
        ks.push(k);
        ts.push(time);
      }
    }
    if (ks.length < 4) break;
    const meanK = ks.reduce((sum, value) => sum + value, 0) / ks.length;
    const meanT = ts.reduce((sum, value) => sum + value, 0) / ts.length;
    let covariance = 0;
    let variance = 0;
    for (let i = 0; i < ks.length; i += 1) {
      covariance += (ks[i] - meanK) * (ts[i] - meanT);
      variance += (ks[i] - meanK) ** 2;
    }
    if (variance <= 0) break;
    const fittedPeriod = covariance / variance;
    if (!Number.isFinite(fittedPeriod) || fittedPeriod < 0.3 || fittedPeriod > 1.0) break;
    period = fittedPeriod;
    phase = meanT - period * meanK;
  }

  // 4) 生成拍点并轻量吸附到起音峰（±20ms）
  const generated = [];
  const firstIndex = Math.max(0, Math.ceil((0 - phase) / period));
  for (let k = firstIndex; ; k += 1) {
    const time = phase + k * period;
    if (time > duration) break;
    if (time >= 0) generated.push(time);
  }
  if (generated.length < 4) return EMPTY_GRID(duration);

  const radius = Math.max(1, Math.round(0.02 / hopSec));
  const snapped = generated.map((time) => {
    const frame = (time - frameCenter) / hopSec;
    let bestFrame = Math.round(frame);
    let bestValue = -1;
    for (let f = Math.max(0, Math.round(frame) - radius); f <= Math.min(frames - 1, Math.round(frame) + radius); f += 1) {
      if (onset[f] > bestValue) {
        bestValue = onset[f];
        bestFrame = f;
      }
    }
    return Number((bestFrame * hopSec + frameCenter).toFixed(3));
  });
  const beats = snapped.filter((time, index) => index === 0 || time - snapped[index - 1] > period * 0.5);
  if (beats.length < 4) return EMPTY_GRID(duration);

  // 5) 重拍：比较每 4 拍一组的平均起音强度，选出更强的相位
  const strengths = beats.map((time) => onsetAt(onset, (time - frameCenter) / hopSec));
  let bestPhaseIndex = 0;
  let bestPhaseStrength = -1;
  for (let candidate = 0; candidate < 4; candidate += 1) {
    let sum = 0;
    let count = 0;
    for (let i = candidate; i < strengths.length; i += 4) {
      sum += strengths[i];
      count += 1;
    }
    const avg = count ? sum / count : 0;
    if (avg > bestPhaseStrength) {
      bestPhaseStrength = avg;
      bestPhaseIndex = candidate;
    }
  }
  const downbeats = beats.filter((_, index) => index % 4 === bestPhaseIndex);

  const total = onset.reduce((sum, value) => sum + value, 0) || 1;
  const confidence = Math.max(0, Math.min(1, (bestScore * frames) / total));

  return {
    bpm: Number((60 / period).toFixed(2)),
    beats,
    downbeats,
    duration: Number(duration.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
  };
}

/** 从 AudioBuffer 分析（浏览器）。 */
export function analyzeAudioBuffer(audioBuffer) {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') return null;
  const channelCount = Math.max(1, audioBuffer.numberOfChannels | 0);
  const length = audioBuffer.length | 0;
  const mono = new Float32Array(length);
  for (let c = 0; c < channelCount; c += 1) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) mono[i] += data[i] / channelCount;
  }
  const grid = analyzeBeatGrid(mono, audioBuffer.sampleRate);
  return grid.beats.length ? grid : null;
}

/** 某一时刻的节拍包络（0..1，拍点瞬间为 1，指数衰减）。 */
export function beatImpactAt(beats, time, decay = 0.16) {
  if (!beats?.length || !Number.isFinite(time) || time < beats[0]) return 0;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return Math.exp(-Math.max(0, time - beats[lo]) / decay);
}

/** 当前拍在区间内的相位（0..1）与拍序号。 */
export function beatPhaseAt(beats, time) {
  if (!beats?.length || !Number.isFinite(time) || time < beats[0]) return { phase: 0, index: -1 };
  let index = 0;
  for (let i = beats.length - 1; i >= 0; i -= 1) {
    if (beats[i] <= time) {
      index = i;
      break;
    }
  }
  const current = beats[index];
  const previous = beats[index - 1] ?? current - 0.5;
  const next = beats[index + 1] ?? current + Math.max(0.05, current - previous);
  const span = Math.max(0.05, next - current);
  return { phase: Math.max(0, Math.min(1, (time - current) / span)), index };
}

/** 合成粒子用的卡点强度：拍点包络 + 重拍包络 + 相位。 */
export function sampleBeat(beats, downbeats, time, { decay = 0.16, downbeatDecay = 0.24 } = {}) {
  return {
    impact: beatImpactAt(beats, time, decay),
    downbeat: beatImpactAt(downbeats, time, downbeatDecay),
    ...beatPhaseAt(beats, time),
  };
}
