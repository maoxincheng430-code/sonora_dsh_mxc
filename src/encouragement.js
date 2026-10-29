// 专注鼓励语：在番茄钟运行期间每隔一段时间给一句鼓励，让「坚持」被看见。
// 纯函数在前（可单测），文案池不分阶段、轮换播放，避免一直重复同一句。

export const CHEER_INTERVAL_SECONDS = 180; // 默认每 3 分钟鼓励一次

/** 文案池：可以是字符串，也可以是 (elapsedSeconds) => string 的函数。 */
export const CHEER_TEXTS = [
  '开始了，就已经比「再等等」的自己更好了。',
  '这一小段专注，已经真正属于你。',
  '呼吸放慢一点，事情会一件一件变小。',
  '不用完美，先保持在场。',
  '你已经坐住了，这就是专注的开始。',
  '把注意力收回来，只做眼前这一小步。',
  '手机放远一点，世界安静一点。',
  '累了就挺直背，喝口水，再继续。',
  '这一页、这一行，就是现在的全部任务。',
  '别和进度较劲，和昨天的自己比就好。',
  (elapsed) => `已经坚持 ${Math.floor(elapsed / 60)} 分钟了，状态正在变好。`,
  '你不需要一口气做完，只需要继续做。',
  '专注不是硬撑，是把干扰一件件拿开。',
  '现在这一分钟，就是今天最值钱的一分钟。',
  '做得慢没关系，别停下来就好。',
  '把「我不行」换成「我先做三分钟」。',
  '肩膀放松，眼睛看远一点，再回来。',
  '别人在刷手机，你在把时间存起来。',
  (elapsed) => `${Math.floor(elapsed / 60)} 分钟了，给自己一个小小的高五。`,
  '今天的你，正在悄悄变成更稳的人。',
  '进度会奖励留下来的人。',
  '再坚持一下，这段专注快收尾了。',
];

export const COMPLETE_CHEER = '完成一个番茄！站起来走两步，喝口水，休息也是专注的一部分。';
export const REST_DONE_CHEER = '休息结束，回来继续吧。你刚才做得很好。';

/** 距离开始过了几个「鼓励周期」（0 开始）；未开始返回 -1。 */
export function cheerBucket(elapsedSeconds, intervalSeconds = CHEER_INTERVAL_SECONDS) {
  const elapsed = Number(elapsedSeconds);
  if (!Number.isFinite(elapsed) || elapsed < 0) return -1;
  const interval = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : CHEER_INTERVAL_SECONDS;
  return Math.floor(elapsed / interval);
}

/** 当前周期对应的鼓励语（按 bucket 轮换，不会连续重复）。 */
export function cheerForBucket(bucket, pool = CHEER_TEXTS, elapsedSeconds = 0) {
  if (!Number.isInteger(bucket) || bucket < 0 || !Array.isArray(pool) || pool.length === 0) return null;
  const index = bucket % pool.length;
  const entry = pool[index];
  const text = typeof entry === 'function' ? entry(Math.max(0, Number(elapsedSeconds) || 0)) : String(entry);
  return { bucket, index, text };
}

/** 便捷入口：按已专注秒数直接拿鼓励语。 */
export function encouragementFor(elapsedSeconds, { intervalSeconds = CHEER_INTERVAL_SECONDS, pool = CHEER_TEXTS } = {}) {
  const bucket = cheerBucket(elapsedSeconds, intervalSeconds);
  if (bucket < 0) return null;
  return cheerForBucket(bucket, pool, elapsedSeconds);
}
