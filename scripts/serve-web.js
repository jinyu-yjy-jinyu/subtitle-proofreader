'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 免安装浏览器版：把渲染层原样放进 web/，
 * 由 WebFileHandler 提供本地文件服务（含 Range，支持视频拖动）。
 *
 * 适用场景：本机 Electron 起不来（虚拟机/远程桌面 GPU 崩溃），
 * 但只想先用起来校对字幕。
 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/mp4',
};

function safeJoin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  // 归一化前先挡掉 .. 与 \0
  if (decoded.includes('\0')) return null;

  const rootResolved = path.resolve(root);
  const rel = decoded.replace(/^[\\/]+/, '');
  const abs = path.resolve(rootResolved, rel);

  // 防目录穿越：必须仍在 web 根目录内
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) return null;
  return abs;
}

async function serve(req, res, webRoot) {
  let urlPath = req.url || '/';
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  let file = safeJoin(webRoot, urlPath);
  if (!file) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }

  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

  // 视频需要 Range 支持，否则无法拖动进度条
  const range = req.headers.range;
  if (range && /^bytes=/.test(range)) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (Number.isNaN(start) || start >= stat.size) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end();
      return;
    }
    end = Math.min(end, stat.size - 1);

    res.writeHead(206, {
      'content-type': type,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${stat.size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

function startServer({ port = 5178, webRoot, openBrowser = true } = {}) {
  const http = require('node:http');
  const server = http.createServer((req, res) => {
    serve(req, res, webRoot).catch((e) => {
      res.writeHead(500).end(String(e && e.message));
    });
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log('');
    console.log('  字幕校对（浏览器版）已启动');
    console.log(`  ${url}`);
    console.log('');
    console.log('  用法：');
    console.log('   1. 打开上面的地址');
    console.log('   2. 点「打开字幕」选择 .srt 文件');
    console.log('   3. 点「打开视频」选择视频文件');
    console.log('');
    console.log('  注意：mkv/avi 等格式浏览器仍无法直接播放，');
    console.log('        需要先转成 mp4（或用本机播放器对照）。');
    console.log('  按 Ctrl+C 停止服务。');
    console.log('');
    if (openBrowser) {
      const { spawn } = require('node:child_process');
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    }
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`端口 ${port} 已被占用，请换一个：node scripts\serve-web.js --port 5180`);
    } else {
      console.error('启动失败：', e.message);
    }
    process.exit(1);
  });

  return server;
}

module.exports = { startServer };

if (require.main === module) {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) || 5178 : 5178;
  startServer({
    port,
    webRoot: path.resolve(__dirname, '..', 'web'),
    openBrowser: !args.includes('--no-open'),
  });
}