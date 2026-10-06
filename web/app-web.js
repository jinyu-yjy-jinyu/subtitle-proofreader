/**
 * 浏览器版入口：逻辑与 Electron 版一致，
 * 只把「打开/保存文件」换成 File API，把「播放源」换成 blob URL。
 */
import { parseSubtitle, summarize, FORMAT } from './core/srt-parser.js';
import {
  assignEstimatedTimes,
  findActiveIndices,
  sortByStart,
  durationForCps,
  suggestCps,
} from './core/timing.js';
import { toSrt, toPlainText, detectEol } from './core/srt-writer.js';
import { CueList } from './ui/cue-list.js';
import { PlayerController } from './ui/player-web.js';
import { toast, showModal, confirmDialog, showIssues } from './ui/toast-web.js';
import { loadSettings, applySettings, openSettings } from './ui/settings.js';

const state = {
  fileName: null,
  eol: '\n',
  format: FORMAT.EMPTY,
  cues: [],
  issues: [],
  estimated: false,
  cps: 5,
  videoDuration: 0,
  unsaved: false,
  settings: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  player: $('player'),
  videoEmpty: $('video-empty'),
  cueList: $('cue-list'),
  cueEmpty: $('cue-empty'),
  fileName: $('file-name'),
  dirtyDot: $('dirty-dot'),
  statusSummary: $('status-summary'),
  statusTime: $('status-time'),
  statusEstimate: $('status-estimate'),
  btnIssues: $('btn-issues'),
  btnFollow: $('btn-follow'),
  cpsWrap: $('cps-wrap'),
  cpsSlider: $('cps-slider'),
  cpsValue: $('cps-value'),
  seek: $('seek'),
  timeLabel: $('time-label'),
  btnPlay: $('btn-play'),
  speed: $('speed'),
};

const player = new PlayerController(els.player, {
  onTime: handleTime,
  onStateChange: handlePlayerState,
});

const cueList = new CueList(els.cueList, {
  onSeek: (t) => {
    player.seek(t);
  },
  onChange: () => {
    state.unsaved = true;
    els.dirtyDot.hidden = false;
    renderStatus();
  },
  onFollowToggle: (on, temporary) => {
    els.btnFollow.classList.toggle('is-on', on);
    els.btnFollow.textContent = on ? '跟随中' : temporary ? '已暂停跟随' : '不跟随';
  },
});

init();

function init() {
  // 先套用已保存的高亮样式，避免刷新后闪烁回默认值
  state.settings = loadSettings();
  applySettings(state.settings);

  bindToolbar();
  bindKeys();
  bindSplitter();

  window.addEventListener('beforeunload', (e) => {
    if (state.unsaved) {
      e.preventDefault();
      e.returnValue = '字幕有未保存的修改';
      return '';
    }
    return undefined;
  });
}

/* ---------------- 设置 ---------------- */
async function openSettingsPanel() {
  const result = await openSettings(state.settings, (s) => {
    // 面板内实时预览：直接反映到已打开的列表
    state.settings = s;
  });

  if (result) {
    state.settings = result;
    toast('设置已保存', '高亮样式已更新', 'ok', 1800);
  } else {
    // 取消时回滚到打开面板前的值
    applySettings(state.settings);
  }
}

/* ---------------- 打开字幕 ---------------- */
let loadSeq = 0;

async function openSubtitle() {
  if (state.unsaved && !(await confirmDiscard())) return;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.srt,.ass,.ssa,.txt,.vtt';
  const file = await pickFile(input);
  if (!file) return;

  // 大文件（上千条）渲染需要一两秒，期间给个提示，
  // 否则界面看起来像「没反应」。同时用序号丢弃过期的异步结果。
  const seq = ++loadSeq;
  const big = file.size > 200 * 1024;
  if (big) toast('正在加载字幕…', `${file.name}（${(file.size / 1024).toFixed(0)} KB）`, 'info', 2000);

  const text = await file.text();
  if (seq !== loadSeq) return; // 已被更新的操作取代

  const parsed = parseSubtitle(text, { duration: state.videoDuration });

  if (!parsed.cues.length) {
    state.fileName = null;
    state.cues = [];
    state.issues = parsed.issues;
    state.unsaved = false;
    cueList.setCues([]);
    els.cueEmpty.style.display = '';
    els.fileName.textContent = `${file.name}（空文件）`;
    els.dirtyDot.hidden = true;
    els.cpsWrap.hidden = true;
    renderStatus();
    toast('字幕文件为空', '没有可校对的文本', 'warn');
    return;
  }

  state.fileName = file.name;
  state.eol = detectEol(text);
  state.format = parsed.format;
  state.issues = parsed.issues;
  state.estimated = parsed.estimated;

  let cues = parsed.cues;
  if (parsed.format === FORMAT.PLAIN) {
    state.cps = suggestCps(cues);
    const dur = state.videoDuration > 0 ? state.videoDuration : durationForCps(cues, state.cps);
    cues = assignEstimatedTimes(cues, dur, state.cps);
    els.cpsSlider.value = String(state.cps);
    els.cpsValue.textContent = state.cps.toFixed(1);
    els.cpsWrap.hidden = false;
  } else {
    els.cpsWrap.hidden = true;
  }

  state.cues = sortByStart(cues).map((c, i) => ({
    ...c,
    order: i,
    originalText: c.text,
    dirty: false,
  }));
  state.unsaved = false;

  // 再确认一次：解析大文件可能耗时，期间用户可能又点了别的文件
  if (seq !== loadSeq) return;

  cueList.setCues(state.cues);
  els.cueEmpty.style.display = 'none';
  els.fileName.textContent = parsed.format === FORMAT.PLAIN
    ? `${file.name}（纯文本·估算时间轴）`
    : file.name;
  els.dirtyDot.hidden = true;
  renderStatus();

  const summary = summarize(parsed);
  toast(`已加载 ${summary.count} 条字幕`, '', 'ok');
  if (parsed.issues.length) showIssues(summary, parsed.issues);
  if (parsed.hasError) toast('文件存在错误', '请修复后再下载', 'error', 6000);
}

/* ---------------- 打开视频 ---------------- */
async function openVideo() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*';
  const file = await pickFile(input);
  if (!file) return;

  if (state.videoURL) URL.revokeObjectURL(state.videoURL);
  state.videoURL = URL.createObjectURL(file);

  player.setSource(state.videoURL);
  els.player.classList.remove('hidden');
  els.videoEmpty.style.display = 'none';

  // 浏览器可能播不了该格式（例如 mkv/avi 实际被当成 video/* 选进来）
  els.player.onerror = () => {
    toast('无法播放该视频', '浏览器仅支持 mp4/webm 等格式，请先用 ffmpeg 转成 mp4', 'error', 7000);
  };
  els.player.onloadedmetadata = () => {
    state.videoDuration = els.player.duration || 0;
    renderStatus();
  };
  toast('已加载视频', file.name, 'ok');
}

/* ---------------- 下载 ---------------- */
function download(kind) {
  if (!state.cues.length) return;
  const text = kind === 'txt' ? toPlainText(state.cues) : toSrt(state.cues, { eol: '\n' });
  const base = (state.fileName || 'subtitle').replace(/\.[^.]+$/, '');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = kind === 'txt' ? `${base}.txt` : `${base}.srt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);

  state.unsaved = false;
  els.dirtyDot.hidden = true;
  toast('已下载', a.download, 'ok');
}

/* ---------------- 时间同步 ---------------- */
function handleTime(t) {
  if (!state.cues.length) return;
  cueList.setActive(findActiveIndices(state.cues, t));
  updateTimeUI(t);
}

function handlePlayerState(ev) {
  if (ev === 'play') els.btnPlay.textContent = '⏸';
  if (ev === 'pause' || ev === 'ended') els.btnPlay.textContent = '▶';
  if (ev === 'loadedmetadata' && els.player.duration > 0) {
    state.videoDuration = els.player.duration;
    renderStatus();
  }
}

function updateTimeUI(t) {
  const dur = player.duration || state.videoDuration || 0;
  const f = fmt(t);
  const fd = fmt(dur);
  els.timeLabel.textContent = `${f} / ${fd}`;
  els.statusTime.textContent = `${f} / ${fd}`;
  if (dur > 0) els.seek.value = String(Math.round((t / dur) * 1000));
}

function fmt(sec) {
  if (!Number.isFinite(sec)) return '--:--';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${p(h)}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}

/* ---------------- 状态 ---------------- */
function renderStatus() {
  if (!state.cues.length) {
    els.statusSummary.textContent = '';
    els.btnIssues.hidden = true;
    els.statusEstimate.hidden = true;
    return;
  }
  const errors = state.issues.filter((i) => i.severity === 'error').length;
  const warnings = state.issues.filter((i) => i.severity === 'warning').length;
  const parts = [`${state.cues.length} 条`];
  if (errors) parts.push(`${errors} 错误`);
  if (warnings) parts.push(`${warnings} 警告`);
  els.statusSummary.textContent = parts.join(' · ');
  els.btnIssues.hidden = state.issues.length === 0;
  els.btnIssues.textContent = '查看校验详情';
  els.statusEstimate.hidden = !state.estimated;
}

/* ---------------- 事件绑定 ---------------- */
function pickFile(input) {
  return new Promise((resolve) => {
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

/** 取元素并挂事件；元素缺失只警告，不让整个初始化崩掉 */
function on(id, event, handler) {
  const el = $(id);
  if (!el) {
    console.warn('[app] 元素不存在，已跳过绑定:', id);
    return;
  }
  el.addEventListener(event, handler);
}

function bindToolbar() {
  on('btn-open-video', 'click', openVideo);
  on('btn-open-video-2', 'click', openVideo);
  on('btn-open-sub', 'click', openSubtitle);
  on('btn-open-sub-2', 'click', openSubtitle);

  on('btn-download', 'click', async () => {
    const choice = await showModal({
      title: '下载',
      body: '<p>选择导出格式：</p>',
      actions: [
        { label: '纯文本 (.txt)', value: 'txt' },
        { label: 'SRT (.srt)', value: 'srt', variant: 'primary' },
        { label: '取消', value: null },
      ],
    });
    if (choice) download(choice);
  });

  on('btn-issues', 'click', () =>
    showIssues(summarize({ cues: state.cues, issues: state.issues }), state.issues));

  on('btn-follow', 'click', () => {
    if (cueList.follow) cueList.pauseFollow();
    else cueList.resumeFollow();
  });

  on('btn-settings', 'click', openSettingsPanel);

  on('btn-play', 'click', () => player.toggle());
  on('btn-prev-cue', 'click', () => jumpCue(-1));
  on('btn-next-cue', 'click', () => jumpCue(1));
  on('speed', 'change', () => player.setSpeed(els.speed.value));

  on('seek', 'input', () => {
    const dur = player.duration || state.videoDuration || 0;
    if (dur > 0) player.seek((Number(els.seek.value) / 1000) * dur);
  });

  on('cps-slider', 'input', () => {
    const cps = Number(els.cpsSlider.value);
    els.cpsValue.textContent = cps.toFixed(1);
    if (!state.estimated || cueList.editingIndex >= 0) return;
    const bare = state.cues.map((c) => ({ ...c }));
    const dur = state.videoDuration > 0 ? state.videoDuration : durationForCps(bare, cps);
    const next = assignEstimatedTimes(bare, dur, cps);
    next.forEach((c) => {
      const orig = state.cues.find((x) => x.order === c.order);
      if (orig) {
        c.dirty = orig.dirty;
        c.originalText = orig.originalText;
      }
    });
    state.cues = sortByStart(next);
    cueList.setCues(state.cues, { keepScroll: true });
    state.cps = cps;
  });
}

function jumpCue(dir) {
  if (!state.cues.length) return;
  const t = player.currentTime;
  const list = state.cues;
  let target = -1;
  if (dir > 0) {
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].start > t + 0.25) { target = i; break; }
    }
  } else {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].start < t - 0.25) { target = i; break; }
    }
  }
  if (target >= 0) {
    player.seek(list[target].start);
    cueList.setActive([target]);
  }
}

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); download('srt'); return; }
    if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      if (e.shiftKey) openSubtitle(); else openVideo();
      return;
    }
    if (e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); player.seek(player.currentTime + 1); }
    if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); player.seek(Math.max(0, player.currentTime - 1)); }
  });
}

function bindSplitter() {
  const splitter = $('splitter');
  const layout = document.querySelector('.layout');
  const videoPane = document.querySelector('.pane-video');
  if (!splitter || !layout || !videoPane) {
    console.warn('[app] 分隔条元素缺失，跳过分隔功能');
    return;
  }
  let dragging = false;

  splitter.addEventListener('pointerdown', (e) => {
    dragging = true;
    splitter.classList.add('dragging');
    splitter.setPointerCapture(e.pointerId);
  });
  splitter.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = layout.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    videoPane.style.flexBasis = `${Math.max(20, Math.min(80, pct))}%`;
  });
  splitter.addEventListener('pointerup', () => {
    dragging = false;
    splitter.classList.remove('dragging');
  });
}

async function confirmDiscard() {
  return confirmDialog({
    title: '有未保存的修改',
    message: '当前字幕有未保存的修改，继续将丢弃这些改动。是否继续？',
    okLabel: '丢弃修改并继续',
    danger: true,
  });
}