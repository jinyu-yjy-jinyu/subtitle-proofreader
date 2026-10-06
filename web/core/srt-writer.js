/**
 * 字幕序列化：回写 SRT / 导出纯 TXT。
 * 纯函数模块。
 */
import { formatTimecode } from './srt-parser.js';

/**
 * 序列化为标准 SRT。
 * 空文本的条目视为删除，直接跳过；序号重新连续编号。
 *
 * @param {Array} cues
 * @param {{eol?: string}} opts eol 默认 '\n'
 * @returns {string}
 */
export function toSrt(cues, { eol = '\n' } = {}) {
  const blocks = [];
  let seq = 0;
  for (const cue of cues) {
    const text = (cue.text ?? '').trim();
    if (!text) continue; // 删除语义
    seq += 1;
    blocks.push(
      `${seq}${eol}${formatTimecode(cue.start)} --> ${formatTimecode(cue.end)}${eol}${text}`,
    );
  }
  return blocks.length ? blocks.join(eol + eol) + eol : '';
}

/** 导出纯文本：一行一条 */
export function toPlainText(cues) {
  return cues
    .map((c) => (c.text ?? '').trim())
    .filter((t) => t !== '')
    .join('\n');
}

/** 导出带时间轴的可读清单，便于人工核对 */
export function toTimestampedSheet(cues, { eol = '\n' } = {}) {
  return cues
    .filter((c) => (c.text ?? '').trim())
    .map((c) => `[${formatTimecode(c.start)} - ${formatTimecode(c.end)}] ${c.text.trim()}`)
    .join(eol);
}

/** 检测文本使用的换行风格 */
export function detectEol(text) {
  if (/\r\n/.test(text)) return '\r\n';
  if (/\r(?!\n)/.test(text)) return '\r';
  return '\n';
}