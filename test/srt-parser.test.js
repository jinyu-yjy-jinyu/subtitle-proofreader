import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSubtitle,
  parseTimecode,
  formatTimecode,
  visibleLength,
  summarize,
  FORMAT,
  SEVERITY,
} from '../web/core/srt-parser.js';

test('parseTimecode', () => {
  assert.equal(parseTimecode('00:00:01,500'), 1.5);
  assert.equal(parseTimecode('00:00:01.500'), 1.5);
  assert.equal(parseTimecode('0:00:01.500'), 1.5);
  assert.equal(parseTimecode('01:02:03,004'), 3723.004);
  assert.equal(parseTimecode('00:01.500'), 1.5);
  assert.equal(parseTimecode('00:01:02'), 62);
  assert.equal(parseTimecode('00:00:01'), 1, '省略毫秒的 H:MM:SS');
  assert.equal(parseTimecode('5'), 5, '纯秒数');
  assert.ok(Math.abs(parseTimecode('00:00:01,5') - 1.5) < 1e-9, '毫秒位不足应左补零');
});

test('parseTimecode', () => {
  assert.equal(parseTimecode(''), null);
  assert.equal(parseTimecode('abc'), null);
  assert.equal(parseTimecode('00:aa:01'), null);
  assert.equal(parseTimecode(null), null);
  assert.equal(parseTimecode(undefined), null);
});

test('formatTimecode', () => {
  assert.equal(formatTimecode(0), '00:00:00,000');
  assert.equal(formatTimecode(1.5), '00:00:01,500');
  assert.equal(formatTimecode(3723.004), '01:02:03,004');
  assert.equal(formatTimecode(-5), '00:00:00,000');
  // 四舍五入进位到下一秒
  assert.equal(formatTimecode(1.9999), '00:00:02,000');
  assert.equal(formatTimecode(59.9995), '00:01:00,000');
});

test('formatTimecode', () => {
  // 回归：早期实现用 formatTimecode(total + 1) 处理进位，
  // 1.9999 取整后仍是 .9999 -> 无限递归 -> RangeError 爆栈。
  assert.equal(formatTimecode(1.9999), '00:00:02,000');
  assert.equal(formatTimecode(59.9999), '00:01:00,000');
  assert.equal(formatTimecode(3599.9999), '01:00:00,000');
  assert.equal(formatTimecode(0.0004), '00:00:00,000');
  assert.equal(formatTimecode(0.0005), '00:00:00,001'); // 0.5ms -> 四舍五入到 1ms
  assert.equal(formatTimecode(0.9995), '00:00:01,000'); // 999.5ms -> 进位到 1 秒
  assert.equal(formatTimecode(NaN), '00:00:00,000');
  assert.equal(formatTimecode(Infinity), '00:00:00,000');
});

test('visibleLength CJK 1', () => {
  assert.equal(visibleLength('你好世界'), 4);
  assert.equal(visibleLength(' hello '), 5);
  assert.equal(visibleLength('a b\tc'), 3);
  assert.equal(visibleLength(''), 0);
});

test('SRT', () => {
  const srt = '1\n00:00:00,310 --> 00:00:02,470\n嗨，大家好，我是谨羽。\n\n' +
    '2\n00:00:02,470 --> 00:00:05,000\n今天我们来看看字幕校对。\n';
  const r = parseSubtitle(srt);
  assert.equal(r.format, FORMAT.SRT);
  assert.equal(r.cues.length, 2);
  assert.equal(r.cues[0].index, 1);
  assert.ok(Math.abs(r.cues[0].start - 0.31) < 1e-9);
  assert.ok(Math.abs(r.cues[0].end - 2.47) < 1e-9);
  assert.equal(r.cues[0].text, '嗨，大家好，我是谨羽。');
  assert.equal(r.cues[1].text, '今天我们来看看字幕校对。');
  assert.equal(r.estimated, false);
  assert.equal(r.hasError, false);
});

test('CRLF BOM', () => {
  const srt = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\n你好\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\n世界\r\n';
  const r = parseSubtitle(srt);
  assert.equal(r.format, FORMAT.SRT);
  assert.equal(r.cues.length, 2);
  assert.equal(r.cues[0].text, '你好');
  assert.equal(r.cues[1].text, '世界');
});

test('', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,000\n第一行\n第二行\n';
  const r = parseSubtitle(srt);
  assert.equal(r.cues[0].text, '第一行\n第二行');
  assert.deepEqual(r.cues[0].lines, ['第一行', '第二行']);
});

test('-> error', () => {
  const srt = '1\n00:00:01,000 --> XX:YY\n文本\n';
  const r = parseSubtitle(srt);
  // 整段因时间码无法解析被丢弃，因此不产生条目，也没有 error 级 issue（只有一条含 --&gt; 但解析不出块）
  assert.equal(r.format, FORMAT.PLAIN, '无法解析出任何块时应退回纯文本');
});

test('error', () => {
  const srt =
    '1\n00:00:01,000 --> 00:00:02,000\n好的一条\n\n' +
    '2\n00:00:03,000 --> 不是时间\n坏的一条\n';
  const r = parseSubtitle(srt);
  assert.equal(r.format, FORMAT.SRT);
  assert.equal(r.cues.length, 1, '只保留可解析的条目');
  assert.equal(r.cues[0].text, '好的一条');
  assert.equal(r.hasError, true, '必须报出 error 以阻止覆盖保存');
});

test('结束时间早于开始时间 -> error', () => {
  const srt = '1\n00:00:05,000 --> 00:00:02,000\n文本\n';
  const r = parseSubtitle(srt);
  assert.equal(r.hasError, true);
  assert.ok(r.issues.some((i) => i.message.includes('不晚于开始时间')));
});

test('时间轴回退 -> warning', () => {
  const srt = '1\n00:00:05,000 --> 00:00:06,000\nA\n\n2\n00:00:01,000 --> 00:00:02,000\nB\n';
  const r = parseSubtitle(srt);
  assert.equal(r.hasError, false);
  assert.ok(r.issues.some((i) => i.message.includes('时间轴回退')));
});

test('相邻重叠 -> warning', () => {
  const srt = '1\n00:00:01,000 --> 00:00:04,000\nA\n\n2\n00:00:03,000 --> 00:00:05,000\nB\n';
  const r = parseSubtitle(srt);
  assert.ok(r.issues.some((i) => i.message.includes('重叠')));
});

test('空文本 -> warning', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:03,000 --> 00:00:04,000\n\n';
  const r = parseSubtitle(srt);
  assert.ok(r.issues.some((i) => i.message.includes('文本为空')));
});

test('超出视频时长 -> warning', () => {
  const srt = '1\n00:00:01,000 --> 00:01:00,000\nA\n';
  const r = parseSubtitle(srt, { duration: 10 });
  assert.ok(r.issues.some((i) => i.message.includes('超出视频时长')));
});

test('序号重复 -> warning', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nA\n\n1\n00:00:02,000 --> 00:00:03,000\nB\n';
  const r = parseSubtitle(srt);
  assert.ok(r.issues.some((i) => i.message.includes('序号重复')));
});

test('缺少序号行 -> warning', () => {
  const srt = '00:00:01,000 --> 00:00:02,000\nA\n\n00:00:02,000 --> 00:00:03,000\nB\n';
  const r = parseSubtitle(srt);
  assert.equal(r.cues.length, 2);
  assert.ok(r.issues.some((i) => i.message.includes('缺少序号行')));
});

test('', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nA\n\n7\n00:00:02,000 --> 00:00:03,000\nB\n';
  const r = parseSubtitle(srt);
  assert.equal(r.cues.length, 2);
  assert.equal(r.cues[1].index, 7);
  assert.equal(r.hasError, false);
});

test('ASS', () => {
  const ass = [
    '[Script Info]',
    'Title: test',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.50,0:00:03.20,Default,,0,0,0,,{\\an8}你好，世界',
    'Dialogue: 0,0:00:03.20,0:00:05.00,Default,,0,0,0,,第二句',
  ].join('\n');
  const r = parseSubtitle(ass);
  assert.equal(r.format, FORMAT.ASS);
  assert.equal(r.cues.length, 2);
  assert.ok(Math.abs(r.cues[0].start - 1.5) < 1e-9);
  assert.equal(r.cues[0].text, '你好，世界', '应剥离覆写标签');
  assert.equal(r.cues[1].text, '第二句');
});

test('ASS \\N', () => {
  const ass = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,第一行\\N第二行, 还有逗号',
  ].join('\n');
  const r = parseSubtitle(ass);
  assert.equal(r.cues[0].text, '第一行\n第二行, 还有逗号');
});

test('', () => {
  const txt = '第一句话\n第二句话\n第三句话';
  const r = parseSubtitle(txt);
  assert.equal(r.format, FORMAT.PLAIN);
  assert.equal(r.estimated, true);
  assert.equal(r.cues.length, 3);
  assert.equal(r.cues[2].text, '第三句话');
});

test('', () => {
  const r = parseSubtitle('   \n\n  ');
  assert.equal(r.format, FORMAT.EMPTY);
  assert.equal(r.cues.length, 0);
  assert.equal(r.hasError, false);
});

test('summarize', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:02,000 --> 00:00:03,000\n\n';
  const s = summarize(parseSubtitle(srt));
  assert.equal(s.count, 2);
  assert.equal(s.warnings, 1);
  assert.equal(s.errors, 0);
  assert.equal(s.firstStart, '00:00:01,000');
  assert.equal(s.lastEnd, '00:00:03,000');
});

test('-> ->', () => {
  const srt = '1\n00:00:00,310 --> 00:00:02,470\n嗨，大家好。\n\n2\n00:00:02,470 --> 00:00:05,000\n第二句\n';
  const a = parseSubtitle(srt);
  const out = toSrtLike(a.cues);
  const b = parseSubtitle(out);
  assert.equal(b.cues.length, a.cues.length);
  for (let i = 0; i < a.cues.length; i += 1) {
    assert.equal(b.cues[i].text, a.cues[i].text);
    assert.ok(Math.abs(b.cues[i].start - a.cues[i].start) < 1e-6);
    assert.ok(Math.abs(b.cues[i].end - a.cues[i].end) < 1e-6);
  }
});

// 局部引用，避免顶部再引入一次
function toSrtLike(cues) {
  const eol = '\n';
  const blocks = [];
  let seq = 0;
  for (const cue of cues) {
    const text = (cue.text ?? '').trim();
    if (!text) continue;
    seq += 1;
    blocks.push(`${seq}${eol}${formatTimecode(cue.start)} --> ${formatTimecode(cue.end)}${eol}${text}`);
  }
  return blocks.join(eol + eol) + eol;
}