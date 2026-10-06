import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignEstimatedTimes,
  findActiveIndices,
  findActiveCue,
  sortByStart,
  durationForCps,
  suggestCps,
  remapTime,
} from '../web/core/timing.js';

const cuesOf = (arr) => arr.map((t, i) => ({ index: i + 1, start: 0, end: 0, text: t }));

test('按字数占比分配时间轴，总量守恒', () => {
  // 实际字符数：四个字=3，两个字=3，六个字在这里=6，合计 12
  const cues = cuesOf(['四个字', '两个字', '六个字在这里']);
  const out = assignEstimatedTimes(cues, 10);
  assert.equal(out.length, 3);
  assert.equal(out[0].start, 0);
  // 3 / 12 * 10
  assert.ok(Math.abs(out[0].end - (3 / 12) * 10) < 1e-9);
  // 累计 6 / 12 * 10
  assert.ok(Math.abs(out[1].end - (6 / 12) * 10) < 1e-9);
  assert.ok(Math.abs(out[2].end - 10) < 1e-9, '末条结束应等于总时长');
});

test('每条时长严格等于「字数占比 × 总时长」', () => {
  const out = assignEstimatedTimes(cuesOf(['四个字', '两个字', '六个字在这里']), 10);
  const counts = [3, 3, 6];
  const total = counts.reduce((a, b) => a + b, 0);
  let acc = 0;
  out.forEach((cue, i) => {
    const span = (counts[i] / total) * 10;
    assert.ok(Math.abs(cue.start - acc) < 1e-9, `第 ${i} 条 start`);
    assert.ok(Math.abs(cue.end - (acc + span)) < 1e-9, `第 ${i} 条 end`);
    acc += span;
  });
});

test('分配的时间轴严格不倒退且连续', () => {
  const out = assignEstimatedTimes(cuesOf(['abc', 'de', '', 'f']), 8);
  for (let i = 0; i < out.length; i += 1) {
    assert.ok(out[i].end >= out[i].start, `第 ${i} 条 end 应 >= start`);
    if (i > 0) assert.ok(out[i].start >= out[i - 1].start - 1e-9, '不应倒退');
  }
});

test('空文本条目不改变总量分配', () => {
  const a = assignEstimatedTimes(cuesOf(['abcde', '', 'fgh']), 6);
  const b = assignEstimatedTimes(cuesOf(['abcde', 'fgh']), 6);
  assert.ok(Math.abs(a[0].end - b[0].end) < 1e-9, '空条不应稀释比例');
});

test('全部为空 -> 均分且不产生 NaN', () => {
  const out = assignEstimatedTimes(cuesOf(['', '  ', '']), 9);
  assert.equal(out.length, 3);
  for (const c of out) {
    assert.ok(Number.isFinite(c.start) && Number.isFinite(c.end));
  }
  assert.ok(Math.abs(out[out.length - 1].end - 9) < 1e-9);
});

test('无时长时按 cps 反推', () => {
  const cues = cuesOf(['一二三四五六七八九十']); // 10 字
  const out = assignEstimatedTimes(cues, 0, 5); // 5 字/秒 -> 2 秒
  assert.ok(Math.abs(out[0].end - 2) < 1e-9);
  assert.ok(Math.abs(durationForCps(cues, 5) - 2) < 1e-9);
});

test('durationForCps / suggestCps', () => {
  const cues = cuesOf(['一二三四五']); // 5 字
  assert.ok(Math.abs(durationForCps(cues, 5) - 1) < 1e-9);
  assert.equal(durationForCps(cues, 0), 0);
  assert.equal(suggestCps(cuesOf([])), 5);
  assert.ok(Math.abs(suggestCps(cues) - 1) < 1e-9);
});

test('末尾空行不应吞掉尾部时长', () => {
  const out = assignEstimatedTimes(cuesOf(['abcde', 'fgh', '']), 6);
  // 末项为空：它的 start/end 都应落在最后一条有内容处，且不产生尾部空隙
  assert.ok(Math.abs(out[1].end - 6) < 1e-9, '最后一条有内容的应覆盖到总时长');
  assert.ok(Math.abs(out[2].start - 6) < 1e-9);
  assert.ok(Math.abs(out[2].end - 6) < 1e-9);
  assert.ok(out[1].end <= out[2].end);
});

test('分配的每条时长与字数占比成比例', () => {
  const out = assignEstimatedTimes(cuesOf(['ab', 'cd', 'ef', 'gh']), 8);
  assert.ok(Math.abs(out[0].end - 2) < 1e-9);
  assert.ok(Math.abs(out[1].end - 4) < 1e-9);
  assert.ok(Math.abs(out[2].end - 6) < 1e-9);
  assert.ok(Math.abs(out[3].end - 8) < 1e-9);
});

test('不修改入参', () => {
  const cues = cuesOf(['abc', 'de']);
  const before = JSON.stringify(cues);
  assignEstimatedTimes(cues, 5);
  assert.equal(JSON.stringify(cues), before);
});

test('findActiveIndices 命中区间', () => {
  const cues = sortByStart([
    { index: 1, start: 0.31, end: 2.47 },
    { index: 2, start: 2.47, end: 5.0 },
    { index: 3, start: 5.0, end: 8.0 },
  ]);
  assert.deepEqual(findActiveIndices(cues, 0), []);
  assert.deepEqual(findActiveIndices(cues, 0.31), [0], '起点含');
  assert.deepEqual(findActiveIndices(cues, 1.0), [0]);
  assert.deepEqual(findActiveIndices(cues, 2.469), [0]);
  assert.deepEqual(findActiveIndices(cues, 2.47), [1], '前段右开');
  assert.deepEqual(findActiveIndices(cues, 6.0), [2]);
  assert.deepEqual(findActiveIndices(cues, 100), [], '超出末尾无命中');
});

test('findActiveIndices 支持重叠同时高亮', () => {
  const cues = sortByStart([
    { index: 1, start: 0, end: 10 },
    { index: 2, start: 2, end: 4 },
    { index: 3, start: 3, end: 5 },
  ]);
  assert.deepEqual(findActiveIndices(cues, 3.5), [0, 1, 2]);
  assert.deepEqual(findActiveIndices(cues, 1.0), [0]);
});

test('findActiveIndices 对大数组仍然正确（回溯有界）', () => {
  const cues = [];
  for (let i = 0; i < 20000; i += 1) {
    // 第 i 条：start = i*2, end = i*2+2，最后一条 end = 40000
    cues.push({ index: i + 1, start: i * 2, end: i * 2 + 2 });
  }
  const sorted = sortByStart(cues);
  assert.deepEqual(findActiveIndices(sorted, 19998.5), [9999]);
  assert.deepEqual(findActiveIndices(sorted, 0), [0], '起点含');
  // 最后一条 start=39998 end=40000，39998 落在其左闭区间内
  assert.deepEqual(findActiveIndices(sorted, 39998), [19999]);
  assert.deepEqual(findActiveIndices(sorted, 40000), [], '超出末尾右开区间无命中');
});

test('findActiveIndices 结果与线性扫描结果一致', () => {
  // 随机化时间轴（含重叠），二分 + 回溯必须与朴素扫描完全一致
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const cues = [];
  let t = 0;
  for (let i = 0; i < 300; i += 1) {
    const start = t + rnd() * 0.5;
    const end = start + 0.2 + rnd() * 3; // 时长差异大，制造重叠
    cues.push({ index: i + 1, start, end });
    t = end * 0.7; // 允许下一条从更早处开始 -> 产生重叠
  }
  const sorted = sortByStart(cues);
  for (let probe = 0; probe < 40; probe += 1) {
    const time = rnd() * 12;
    const expected = [];
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i].start <= time && time < sorted[i].end) expected.push(i);
    }
    assert.deepEqual(
      findActiveIndices(sorted, time),
      expected,
      `t=${time.toFixed(3)} 处的命中集合不一致`,
    );
  }
});

test('findActiveCue 返回首条命中', () => {
  const cues = sortByStart([
    { index: 1, start: 0, end: 10 },
    { index: 2, start: 2, end: 4 },
  ]);
  assert.equal(findActiveCue(cues, 3), 0);
  assert.equal(findActiveCue(cues, 100), -1);
});

test('findActiveIndices 边界输入', () => {
  assert.deepEqual(findActiveIndices([], 1), []);
  assert.deepEqual(findActiveIndices(sortByStart([{ index: 1, start: 0, end: 1 }]), NaN), []);
});

test('remapTime 重算后保持同一句', () => {
  const oldCues = sortByStart([
    { index: 1, start: 0, end: 5 },
    { index: 2, start: 5, end: 10 },
  ]);
  const newCues = sortByStart([
    { index: 1, start: 0, end: 2 },
    { index: 2, start: 2, end: 10 },
  ]);
  // 旧时间 6 命中第 2 条 -> 新时间应为第 2 条起点 2
  assert.equal(remapTime(oldCues, newCues, 6), 2);
});

test('remapTime 无命中时回到开头', () => {
  const oldCues = sortByStart([{ index: 1, start: 0, end: 5 }]);
  const newCues = sortByStart([{ index: 1, start: 0, end: 5 }]);
  assert.equal(remapTime(oldCues, newCues, 99), 0);
});