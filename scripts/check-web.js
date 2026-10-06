const path = require('path');
const http = require('http');

const BASE = 'http://127.0.0.1:5178';

function get(p) {
  return new Promise((resolve, reject) => {
    http
      .get(BASE + p, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      })
      .on('error', reject);
  });
}

(async () => {
  let pass = 0;
  const total = 13;
  const check = (label, cond, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    if (cond) pass += 1;
  };

  const idx = await get('/');
  check('首页可访问', idx.status === 200);
  check('首页引用 app-web.js', idx.body.includes('app-web.js'));
  check('首页含字幕列表容器', idx.body.includes('cue-list'));

  const css = await get('/styles.css');
  check('样式表可访问', css.status === 200 && css.body.includes('.cue-row'));

  const app = await get('/app-web.js');
  check('app-web.js 可访问', app.status === 200);
  check('app-web.js 是 ESM 引用 core', app.body.includes("from './core/srt-parser.js'"));

  for (const f of [
    '/core/srt-parser.js',
    '/core/timing.js',
    '/core/srt-writer.js',
    '/ui/cue-list.js',
    '/ui/player-web.js',
    '/ui/toast-web.js',
  ]) {
    const r = await get(f);
    check(`模块可访问 ${f}`, r.status === 200 && r.body.length > 100, `${r.body.length}B`);
  }

  const traversals = [
    ['/../package.json', '直接 ..'],
    ['/..%2fpackage.json', '编码 ..%2f'],
    ['/%2e%2e/package.json', '编码 %2e%2e'],
    ['/core/../../package.json', '深层回溯'],
  ];
  let blocked = 0;
  for (const [p, label] of traversals) {
    const r = await get(p);
    const isBlocked = r.status === 403 || r.status === 404 || !r.body.includes('zimu-jiaodui');
    if (isBlocked) blocked += 1;
    console.log(`  ${isBlocked ? 'OK  ' : 'LEAK'}  ${label}  status=${r.status}`);
  }
  check('目录穿越全部被拦截', blocked === traversals.length, `${blocked}/${traversals.length}`);

  console.log(`\n通过 ${pass}/${total}`);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});