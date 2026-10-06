import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSrt, toPlainText, toTimestampedSheet, detectEol } from '../web/core/srt-writer.js';
import { parseSubtitle } from '../web/core/srt-parser.js';

const cues = [
  { index: 1, start: 0.31, end: 2.47, text: '嗨，大家好，我是谨羽。' },
  { index: 2, start: 2.47, end: 5.0, text: '今天我们来看看字幕校对。' },
];

test('toSrt 生成标准格式', () => {
  const out = toSrt(cues);
  assert.equal(
    out,
    '1\n00:00:00,310 --> 00:00:02,470\n嗨，大家好，我是谨羽。\n\n' +
      '2\n00:00:02,470 --> 00:00:05,000\n今天我们来看看字幕校对。\n',
  );
});

test('toSrt 序号重新连续编号', () => {
  const out = toSrt([
    { index: 1, start: 0, end: 1, text: 'A' },
    { index: 9, start: 1, end: 2, text: 'B' },
  ]);
  assert.ok(out.startsWith('1\n'));
  assert.ok(out.includes('\n2\n'));
});

test('toSrt 空文本视为删除并重新编号', () => {
  const out = toSrt([
    { index: 1, start: 0, end: 1, text: 'A' },
    { index: 2, start: 1, end: 2, text: '   ' },
    { index: 3, start: 2, end: 3, text: 'C' },
  ]);
  const r = parseSubtitle(out);
  assert.equal(r.cues.length, 2);
  assert.deepEqual(
    r.cues.map((c) => c.text),
    ['A', 'C'],
  );
  assert.deepEqual(
    r.cues.map((c) => c.index),
    [1, 2],
  );
});

test('toSrt 支持 CRLF', () => {
  const out = toSrt(cues, { eol: '\r\n' });
  assert.ok(out.includes('\r\n'));
  const r = parseSubtitle(out);
  assert.equal(r.cues.length, 2);
  assert.equal(r.cues[0].text, '嗨，大家好，我是谨羽。');
});

test('toSrt 空列表 -> 空串', () => {
  assert.equal(toSrt([]), '');
  assert.equal(toSrt([{ index: 1, start: 0, end: 1, text: '' }]), '');
});

test('toSrt 多行文本保留内部换行', () => {
  const out = toSrt([{ index: 1, start: 0, end: 1, text: '第一行\n第二行' }]);
  const r = parseSubtitle(out);
  assert.equal(r.cues[0].text, '第一行\n第二行');
});

test('toPlainText 一行一条并去空', () => {
  assert.equal(toPlainText(cues), '嗨，大家好，我是谨羽。\n今天我们来看看字幕校对。');
  assert.equal(toPlainText([{ text: 'A' }, { text: '' }, { text: '  ' }, { text: 'B' }]), 'A\nB');
});

test('toTimestampedSheet 含时间区间', () => {
  const out = toTimestampedSheet(cues);
  assert.ok(out.includes('[00:00:00,310 - 00:00:02,470]'));
});

test('detectEol 识别换行风格', () => {
  assert.equal(detectEol('a\r\nb'), '\r\n');
  assert.equal(detectEol('a\nb'), '\n');
  assert.equal(detectEol('a\rb'), '\r');
  assert.equal(detectEol('ab'), '\n');
});

test('往返幂等：写出再解析，文本与时间一致', () => {
  const out = toSrt(cues);
  const r = parseSubtitle(out);
  assert.equal(r.cues.length, 2);
  for (let i = 0; i < cues.length; i += 1) {
    assert.equal(r.cues[i].text, cues[i].text);
    assert.ok(Math.abs(r.cues[i].start - cues[i].start) < 1e-6);
    assert.ok(Math.abs(r.cues[i].end - cues[i].end) < 1e-6);
  }
});