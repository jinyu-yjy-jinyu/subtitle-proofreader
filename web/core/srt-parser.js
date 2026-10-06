/**
 * SRT / ASS / 纯文本 字幕解析与校验。
 * 纯函数模块：不依赖 DOM 与 Node API，便于单测。
 */

export const FORMAT = Object.freeze({
  SRT: 'srt',
  ASS: 'ass',
  PLAIN: 'plain',
  EMPTY: 'empty',
});

export const SEVERITY = Object.freeze({ ERROR: 'error', WARNING: 'warning', INFO: 'info' });

/** 去掉 BOM */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** 统一换行为 \n，便于解析 */
function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, '\n');
}

/** 可视字符数：CJK 与全角按 1 计，空白不计 */
export function visibleLength(str) {
  let n = 0;
  for (const ch of String(str)) {
    if (/\s/.test(ch)) continue;
    n += 1;
  }
  return n;
}

/**
 * 解析时间码。支持
 *   00:00:01,500 / 00:00:01.500 / 0:00:01.500 / 01:500 / 00:00:01
 * 返回秒数（float），失败返回 null。
 */
export function parseTimecode(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;

  // H:MM:SS(.mmm) —— 毫秒部分可有可无（有些 SRT 写成 00:00:01 或 00:01:02,5）
  const hmmss = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/.exec(s);
  if (hmmss) {
    const [, h = '0', m, sec, ms = '0'] = hmmss;
    return (
      Number(h) * 3600 + Number(m) * 60 + Number(sec) + Number(ms.padEnd(3, '0')) / 1000
    );
  }

  // MM:SS(.mmm)
  const ms = /^(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/.exec(s);
  if (ms) {
    const [, m, sec, frac = '0'] = ms;
    return Number(m) * 60 + Number(sec) + Number(frac.padEnd(3, '0')) / 1000;
  }

  // 纯秒数，可带小数
  const secondsOnly = /^(\d{1,3})(?:[,.](\d{1,3}))?$/.exec(s);
  if (secondsOnly) {
    const [, sec, frac = '0'] = secondsOnly;
    return Number(sec) + Number(frac.padEnd(3, '0')) / 1000;
  }

  return null;
}

/** 秒 -> 00:00:01,500 */
export function formatTimecode(seconds) {
  let total = Math.max(0, Number(seconds) || 0);
  if (!Number.isFinite(total)) total = 0;

  // 先按毫秒取整并把进位吸收到秒里。
  // 注意不能靠递归（formatTimecode(total + 1)）：1.9999 这样的值取整后仍是 .9999，会无限递归。
  let ms = Math.round(total * 1000);
  let wholeSec = Math.floor(ms / 1000);
  ms -= wholeSec * 1000;

  const s = wholeSec % 60;
  const m = Math.floor(wholeSec / 60) % 60;
  const h = Math.floor(wholeSec / 3600);
  const p2 = (n) => String(n).padStart(2, '0');

  return `${p2(h)}:${p2(m)}:${p2(s)},${String(ms).padStart(3, '0')}`;
}

/** 粗判是否为时间码行 */
function looksLikeTimeLine(line) {
  return /\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}|\d{1,2}:\d{2}[,.]\d{1,3}|\d{1,3}:\d{1,2}[,.]\d{1,3}/.test(
    line,
  );
}

/** 解析 ASS 的 [Events] Format 行，取 Start/End/Text 列位置 */
function readAssFields(formatLine) {
  const idx = {};
  formatLine.split(',').forEach((name, i) => {
    idx[name.trim().toLowerCase()] = i;
  });
  return idx;
}

function parseAss(text) {
  const issues = [];
  const cues = [];
  const lines = text.split('\n');
  let fields = null;
  let inEvents = false;
  let sawEvents = false;

  lines.forEach((rawLine, lineNo) => {
    const line = rawLine.trim();
    if (/^\[/.test(line)) {
      inEvents = /^\[events\]$/i.test(line);
      if (inEvents) sawEvents = true;
      if (/^\[events\]/i.test(line)) {
        const fmtLine = lines
          .slice(lineNo + 1, lineNo + 6)
          .find((l) => /^\s*Format\s*:/i.test(l));
        if (fmtLine) fields = readAssFields(fmtLine.split(':').slice(1).join(':'));
      }
      return;
    }
    if (!inEvents || !/^Dialogue\s*:/i.test(line)) return;
    if (!fields) {
      issues.push({
        severity: SEVERITY.WARNING,
        line: lineNo + 1,
        message: 'ASS 缺少 Format 行，按默认列顺序解析',
      });
      fields = { start: 1, end: 2, text: 9 };
    }

    // Dialogue 行：Format 里 Text 是最后一列，其内容本身可以包含逗号，
    // 因此不能直接取 parts[textIndex]，必须把该位置之后的所有片段重新拼回来。
    const rest = line.slice(line.indexOf(':') + 1);
    const parts = rest.split(',');
    const textIndex = fields.text ?? 9;
    if (parts.length < textIndex + 1) {
      issues.push({
        severity: SEVERITY.ERROR,
        line: lineNo + 1,
        message: `Dialogue 字段数不足（${parts.length} < ${textIndex + 1}）`,
      });
      return;
    }

    const start = parseTimecode((parts[fields.start ?? 1] ?? '').trim());
    const end = parseTimecode((parts[fields.end ?? 2] ?? '').trim());
    const body = parts.slice(textIndex).join(',');
    if (start === null || end === null) {
      issues.push({
        severity: SEVERITY.ERROR,
        line: lineNo + 1,
        message: 'ASS 时间码无法解析',
      });
      return;
    }
    const clean = body.replace(/\{[^}]*\}/g, '').replace(/\\N|\\n/g, '\n').trim();
    cues.push({
      index: cues.length + 1,
      start,
      end,
      text: clean,
      lines: clean ? clean.split('\n') : [],
      lineNo: lineNo + 1,
    });
  });

  if (!sawEvents) {
    issues.push({
      severity: SEVERITY.WARNING,
      line: 1,
      message: '未找到 [Events] 段',
    });
  }
  return { cues, issues };
}

function parseSrtLike(text) {
  const issues = [];
  const cues = [];
  const blocks = text.split(/\n{2,}/);

  blocks.forEach((block, blockNo) => {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) return;

    // 允许首行序号缺失：找到第一行含 --> 的行
    let arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx === -1) {
      issues.push({
        severity: SEVERITY.ERROR,
        line: cues.length ? null : null,
        block: blockNo + 1,
        message: `第 ${blockNo + 1} 段没有 " --> " 时间轴行`,
      });
      return;
    }

    let seq = null;
    if (arrowIdx > 0) {
      const candidate = lines[0].trim();
      if (/^\d+$/.test(candidate)) {
        seq = Number(candidate);
      } else {
        issues.push({
          severity: SEVERITY.WARNING,
          block: blockNo + 1,
          message: `第 ${blockNo + 1} 段序号行不是数字：「${candidate}」`,
        });
      }
    } else {
      issues.push({
        severity: SEVERITY.WARNING,
        block: blockNo + 1,
        message: `第 ${blockNo + 1} 段缺少序号行`,
      });
    }

    const timeLine = lines[arrowIdx];
    const [rawStart, rawEndRaw] = timeLine.split('-->');
    const rawEnd = (rawEndRaw || '').trim().split(/\s+/)[0];
    const start = parseTimecode(rawStart);
    const end = parseTimecode(rawEnd);

    if (start === null || end === null) {
      issues.push({
        severity: SEVERITY.ERROR,
        block: blockNo + 1,
        message: `第 ${blockNo + 1} 段时间码无法解析：「${timeLine.trim()}」`,
      });
      return;
    }

    const body = lines.slice(arrowIdx + 1).join('\n').trim();
    cues.push({
      index: seq ?? cues.length + 1,
      start,
      end,
      text: body,
      lines: body ? body.split('\n') : [],
      blockNo: blockNo + 1,
    });
  });

  return { cues, issues };
}

function parsePlain(text) {
  const lines = text.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) {
      if (out.length && out[out.length - 1].text !== '') {
        out.push({ text: '', sourceLine: i + 1 });
      }
      return;
    }
    out.push({ text: t, sourceLine: i + 1 });
  });
  while (out.length && out[out.length - 1].text === '') out.pop();
  return out.map((item, i) => ({
    index: i + 1,
    start: 0,
    end: 0,
    text: item.text,
    lines: item.text ? [item.text] : [],
    sourceLine: item.sourceLine,
    estimated: true,
  }));
}

/** 交叉校验，返回 issues */
function validate(cues, { duration } = {}) {
  const issues = [];

  const seqs = cues.map((c) => c.index);
  const dup = new Set();
  for (const s of seqs) {
    if (dup.has(s)) {
      issues.push({ severity: SEVERITY.WARNING, message: `序号重复：${s}` });
      break;
    }
    dup.add(s);
  }

  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i];
    const prev = cues[i - 1];
    const next = cues[i + 1];

    if (cue.end <= cue.start) {
      issues.push({
        severity: SEVERITY.ERROR,
        index: cue.index,
        message: `第 ${cue.index} 条结束时间(${formatTimecode(cue.end)}) 不晚于开始时间(${formatTimecode(cue.start)})`,
      });
    }
    if (prev && cue.start < prev.start) {
      issues.push({
        severity: SEVERITY.WARNING,
        index: cue.index,
        message: `第 ${cue.index} 条开始时间早于第 ${prev.index} 条，时间轴回退`,
      });
    }
    if (next && next.start < cue.end) {
      issues.push({
        severity: SEVERITY.WARNING,
        index: cue.index,
        message: `第 ${cue.index} 条与第 ${next.index} 条时间重叠 ${(cue.end - next.start).toFixed(2)}s`,
      });
    }
    if (!cue.text) {
      issues.push({
        severity: SEVERITY.WARNING,
        index: cue.index,
        message: `第 ${cue.index} 条文本为空（保存时将被删除）`,
      });
    }
    if (duration && duration > 0 && cue.end > duration + 0.5) {
      issues.push({
        severity: SEVERITY.WARNING,
        index: cue.index,
        message: `第 ${cue.index} 条结束时间超出视频时长 ${(cue.end - duration).toFixed(2)}s`,
      });
    }
  }

  return issues;
}

/**
 * 主入口：解析字幕文本。
 * @param {string} rawText
 * @param {{duration?: number}} opts
 * @returns {{format:string, cues:Array, issues:Array, estimated:boolean, hasError:boolean}}
 */
export function parseSubtitle(rawText, opts = {}) {
  const original = String(rawText ?? '');
  const text = normalizeNewlines(stripBom(original));

  if (!text.trim()) {
    return { format: FORMAT.EMPTY, cues: [], issues: [], estimated: false, hasError: false };
  }

  let format = FORMAT.PLAIN;
  let cues = [];
  let issues = [];

  // ASS 判定：有 [Events] 段且含 Dialogue 行即可。
  // 不能只认 [Script Info] —— 很多合法 ASS 直接以 [Events] 开头。
  if (/\[Events\]/i.test(text) && /^\s*Dialogue\s*:/im.test(text)) {
    format = FORMAT.ASS;
    ({ cues, issues } = parseAss(text));
  } else if (looksLikeTimeLine(text.split('\n').find((l) => l.includes('-->')) || '')) {
    format = FORMAT.SRT;
    ({ cues, issues } = parseSrtLike(text));
  }

  if (format === FORMAT.SRT && cues.length === 0) {
    // 声称像 SRT 却完全解析不出内容 -> 退回纯文本
    format = FORMAT.PLAIN;
  }

  if (format === FORMAT.PLAIN) {
    cues = parsePlain(text);
    issues = [
      {
        severity: SEVERITY.INFO,
        message: '未检测到时间轴，按纯文本处理（时间轴由字数估算，可拖动滑块微调）',
      },
    ];
  }

  // 纯文本需要外部（timing 模块）填充时间轴
  if (format !== FORMAT.PLAIN) {
    issues.push(...validate(cues, opts));
  }

  const hasError = issues.some((i) => i.severity === SEVERITY.ERROR);
  return {
    format,
    cues,
    issues,
    estimated: format === FORMAT.PLAIN,
    hasError,
  };
}

/** 统计摘要，用于校验面板 */
export function summarize(parsed) {
  const { cues, issues } = parsed;
  const errors = issues.filter((i) => i.severity === SEVERITY.ERROR).length;
  const warnings = issues.filter((i) => i.severity === SEVERITY.WARNING).length;
  const infos = issues.filter((i) => i.severity === SEVERITY.INFO).length;
  const last = cues[cues.length - 1];
  return {
    count: cues.length,
    errors,
    warnings,
    infos,
    firstStart: cues[0] ? formatTimecode(cues[0].start) : '--',
    lastEnd: last ? formatTimecode(last.end) : '--',
  };
}