/**
 * 时间轴推算与"当前秒数 -> 字幕条目"定位。
 * 纯函数模块。
 */
import { visibleLength } from './srt-parser.js';

/**
 * 给纯文本条目分配时间轴。
 * 按「去掉空白后的可视字符数」占比分配总时长。
 *
 * @param {Array<{text:string}>} cues  已有 text 的条目（无时间轴）
 * @param {number} duration            视频时长（秒）
 * @param {number} cps                 参考每秒字数；null 时按 duration 自动计算
 * @returns {Array} 返回带 start/end 的新数组（不修改入参）
 */
export function assignEstimatedTimes(cues, duration, cps = null) {
  const list = cues.map((c) => ({ ...c }));
  const filled = list.filter((c) => visibleLength(c.text) > 0);

  if (!list.length) return list;

  const totalChars = filled.reduce((sum, c) => sum + visibleLength(c.text), 0);

  // 有效时长：视频时长，或按 cps 反推
  const effective =
    Number.isFinite(duration) && duration > 0
      ? duration
      : cps > 0
        ? totalChars / cps
        : totalChars * 2; // 兜底：默认约 2 字/秒

  if (totalChars === 0) {
    // 全文为空：均分时间轴，至少保证点击可跳转
    const step = list.length ? effective / list.length : 0;
    let acc = 0;
    for (const cue of list) {
      cue.start = acc;
      acc += step;
      cue.end = acc;
      cue.estimated = true;
    }
    return list;
  }

  let acc = 0;
  for (const cue of list) {
    const weight = visibleLength(cue.text);
    const span = (weight / totalChars) * effective;
    cue.start = acc;
    cue.end = acc + span;
    cue.estimated = true;
    // 空行/纯空白权重为 0，span 也为 0，直接贴在下一条之前，不会除零
    acc += span;
  }

  // 收尾：最后一个「有内容」的条目结束对齐有效时长，吸收浮点误差。
  // 不能直接改 list 末项——末项可能是空行，那样会把它的 start 一起前移并留下尾部空隙。
  let lastFilled = null;
  for (const cue of list) {
    if (visibleLength(cue.text) > 0) lastFilled = cue;
  }
  if (lastFilled) lastFilled.end = effective;

  return list;
}

/**
 * 由「每秒字数」反推总时长。
 * 用于纯文本 + 滑块调节。
 */
export function durationForCps(cues, cps) {
  const totalChars = cues.reduce((s, c) => s + visibleLength(c.text), 0);
  if (!cps || cps <= 0) return 0;
  return totalChars / cps;
}

/** 建议的默认 CPS：取 5 字/秒 */
export function suggestCps(cues) {
  const totalChars = cues.reduce((s, c) => s + visibleLength(c.text), 0);
  if (!totalChars) return 5;
  return Number((totalChars / 5).toFixed(2));
}

/**
 * 保证 start 升序，供二分查找使用。
 * 返回排序后的新数组（不修改入参）。
 */
export function sortByStart(cues) {
  return [...cues].sort((a, b) => a.start - b.start || a.index - b.index);
}

/**
 * 二分查找 t 所在区间，返回所有命中的条目下标（升序）。
 * 允许区间重叠（SRT 常见），故返回数组而非单个值。
 *
 * 先二分定位最后一个 start <= t 的位置，再向前回溯。
 * 回溯上界由「最大单条时长」决定：任何 start < t - maxSpan 的条目都不可能
 * 覆盖 t，因此扫描规模有确定上界，不会随总时长退化。
 *
 * @param {Array} cues 已按 start 升序
 * @param {number} t 当前播放秒数
 */
export function findActiveIndices(cues, t) {
  if (!cues.length || !Number.isFinite(t)) return [];

  let lo = 0;
  let hi = cues.length - 1;
  let lastStartBefore = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      lastStartBefore = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (lastStartBefore === -1) return [];

  // 最大单条跨度，作为回溯的安全边界
  let maxSpan = 0;
  for (const cue of cues) {
    const span = cue.end - cue.start;
    if (Number.isFinite(span) && span > maxSpan) maxSpan = span;
  }
  const floor = t - maxSpan;

  const hits = [];
  for (let i = lastStartBefore; i >= 0; i -= 1) {
    const cue = cues[i];
    if (cue.start < floor) break;
    if (t < cue.end) hits.push(i);
  }
  hits.reverse();
  return hits;
}

/** 便捷：返回第一条命中的条目 */
export function findActiveCue(cues, t) {
  const hits = findActiveIndices(cues, t);
  return hits.length ? hits[0] : -1;
}

/**
 * 保持当前高亮语义：重算时间轴后，把原本命中的条目映射到新位置。
 * @returns {number} 新的应跳转秒数
 */
export function remapTime(oldCues, newCues, oldTime) {
  const oldHits = findActiveIndices(oldCues, oldTime);
  if (!oldHits.length) return newCues.length ? newCues[0].start : 0;
  const cue = oldCues[oldHits[0]];
  const match = newCues.find((c) => c.index === cue.index);
  return match ? match.start : Math.min(oldTime, newCues[newCues.length - 1]?.start ?? 0);
}