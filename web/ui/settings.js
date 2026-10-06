/**
 * 设置面板：高亮行的背景色、文字颜色、字号。
 *
 * 配色交互采用「色轮（color wheel）」——设计工具里常见的圆形取色盘：
 *   - 圆盘内：色相（角度）× 饱和度（离圆心距离）
 *   - 右侧竖条：明度
 * 拖动即可连续调色，比滑块直观得多。
 * 另提供系统取色器与预设色板作为补充入口，三者双向联动。
 *
 * 设置实时预览并写入 localStorage。
 */

const STORAGE_KEY = 'subtitle-proofreader-settings';

export const DEFAULTS = Object.freeze({
  highlightColor: '#4f8cff', // 行背景色
  highlightAlpha: 0.16, // 行背景不透明度 0~1
  textColor: '#ffffff', // 高亮行的文字颜色
  textColorEnabled: true, // 关掉则用界面默认文字色
  fontSize: 14, // 高亮行字号 px
  fontWeight: 'normal', // normal | bold
});

/** 预设配色：背景与文字成对给出，保证可读 */
const PRESETS = [
  { name: '默认蓝', bg: '#4f8cff', bgA: 0.16, fg: '#ffffff' },
  { name: '青绿', bg: '#2ec4a6', bgA: 0.16, fg: '#ffffff' },
  { name: '琥珀', bg: '#f0a92e', bgA: 0.18, fg: '#ffffff' },
  { name: '玫红', bg: '#e0559b', bgA: 0.16, fg: '#ffffff' },
  { name: '紫色', bg: '#8b5cf6', bgA: 0.16, fg: '#ffffff' },
  { name: '暗底亮字', bg: '#000000', bgA: 0.35, fg: '#ffd166' },
  { name: '亮底暗字', bg: '#ffffff', bgA: 0.10, fg: '#1a1d23' },
  { name: '红高亮', bg: '#ef4444', bgA: 0.18, fg: '#ffffff' },
];

/* ================= 颜色转换 ================= */

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  const to = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  if (h < 60) return { r: (c + m) * 255, g: (x + m) * 255, b: m * 255 };
  if (h < 120) return { r: (x + m) * 255, g: (c + m) * 255, b: m * 255 };
  if (h < 180) return { r: m * 255, g: (c + m) * 255, b: (x + m) * 255 };
  if (h < 240) return { r: m * 255, g: (x + m) * 255, b: (c + m) * 255 };
  if (h < 300) return { r: (x + m) * 255, g: m * 255, b: (c + m) * 255 };
  return { r: (c + m) * 255, g: m * 255, b: (x + m) * 255 };
}

function hslToHex(h, s, l) {
  const { r, g, b } = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

/** WCAG 相对亮度 */
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 在给定底色上挑一个可读的文字色 */
function readableOn(bg) {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111111')
    ? '#ffffff'
    : '#111111';
}

/* ================= 存取与应用 ================= */

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式写入失败可忽略 */
  }
}

export function applySettings(s) {
  const root = document.documentElement;
  const bg = hexToRgb(s.highlightColor);
  root.style.setProperty('--hl-bg', `rgba(${bg.r}, ${bg.g}, ${bg.b}, ${s.highlightAlpha})`);
  root.style.setProperty('--hl-border', s.highlightColor);
  root.style.setProperty('--hl-font-size', `${s.fontSize}px`);
  root.style.setProperty('--hl-font-weight', s.fontWeight);
  root.style.setProperty('--hl-text-color', s.textColorEnabled ? s.textColor : 'var(--text)');
}

/* ================= 色轮组件 ================= */

/**
 * 色轮：左圆盘（色相=角度，饱和度=半径）+ 右竖条（明度）。
 * @param {(hex:string)=>void} onPick 选中颜色变化时回调
 */
function createColorWheel(initialHex, onPick, opts = {}) {
  // 明度上限：默认压到 90%，否则 l=100 时任何色相/饱和度都渲染成纯白，
  // 用户拖动色轮会「毫无反应」（白色、黑色同理难以感知色相）。
  const lMax = opts.lMax ?? 90;
  // 明度下限同理：纯黑下也看不出色相
  const lMin = opts.lMin ?? 10;
  const stage = el('div', 'wheel-stage');

  const wheel = el('canvas', 'wheel-canvas');
  const W = 168;
  wheel.width = W;
  wheel.height = W;
  wheel.title = '拖动选色：角度=色相，距离=饱和度';

  const marker = el('div', 'wheel-marker');
  const strip = el('canvas', 'wheel-strip');
  strip.width = 22;
  strip.height = W;
  strip.title = '拖动调整明度';
  const stripMarker = el('div', 'wheel-strip-marker');

  stage.append(wheel, marker, strip, stripMarker);

  const ctx = wheel.getContext('2d');
  const sctx = strip.getContext('2d');
  const radius = W / 2;

  let hue = 0;
  let sat = 0;
  let light = 50;   // 色轮上的明度，被 lMax 夹紧
  let rawLight = 50; // 用户实际选的明度（可为 100）

  /** 外部设色时：记录真实明度，但色轮上按 lMax 夹紧显示 */
  function setLight(l) {
    rawLight = Math.max(0, Math.min(100, l));
    light = Math.min(rawLight, lMax);
  }

  /** 取当前颜色：用用户真实选的明度，而非夹紧后的值 */
  function currentHex() {
    return hslToHex(hue, sat, rawLight);
  }

  /**
   * 拖色轮前调用：若明度停在纯白/纯黑，把它拉到可着色区间。
   *
   * HSL 里 l=100 时无论色相与饱和度为何都是纯白，l=0 时都是纯黑。
   * 初始值若正好是纯白（文字色默认即如此），用户拖动色轮会「毫无反应」。
   * 这里在首次交互时把 rawLight 拉回 [lMin, lMax]，之后的拖动即可正常显色。
   */
  function unlockLight() {
    if (rawLight > lMax) {
      rawLight = lMax;
      light = lMax;
    } else if (rawLight < lMin) {
      rawLight = lMin;
      light = lMin;
    }
  }

  /** 色轮底图：每 2° 采一次色相色，中心为灰、边缘为纯色 */
  function drawWheel() {
    const img = ctx.createImageData(W, W);
    // 预生成色相环
    const ring = [];
    for (let a = 0; a < 360; a += 2) {
      const rad = ((a - 90) * Math.PI) / 180;
      const c = hslToRgb(a, 100, 50);
      ring.push([Math.cos(rad), Math.sin(rad), c.r, c.g, c.b]);
    }

    for (let y = 0; y < W; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const dx = x - radius;
        const dy = y - radius;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const i = (y * W + x) * 4;

        if (dist > radius) {
          img.data[i + 3] = 0;
          continue;
        }
        const t = Math.min(1, dist / radius); // 0 中心 -> 1 边缘
        const ang = (((Math.atan2(dy, dx) * 180) / Math.PI + 90) % 360 + 360) % 360;
        const [, , r, g, b] = ring[Math.round(ang / 2) % 180];

        // 向中心插值到中性灰
        img.data[i] = r * t + 128 * (1 - t);
        img.data[i + 1] = g * t + 128 * (1 - t);
        img.data[i + 2] = b * t + 128 * (1 - t);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** 明度条：黑 -> 当前色 -> 白 */
  function drawStrip() {
    const grad = sctx.createLinearGradient(0, 0, 0, W);
    // 中点取当前色相/饱和度在 50% 明度下的颜色
    const base = hslToRgb(hue, sat, 50);
    grad.addColorStop(0, '#000000');
    grad.addColorStop(0.5, rgbToHex(base.r, base.g, base.b));
    grad.addColorStop(1, '#ffffff');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, strip.width, W);
  }

  function place() {
    const rad = (sat / 100) * radius;
    const a = ((hue - 90) * Math.PI) / 180;
    marker.style.left = `${radius + Math.cos(a) * rad}px`;
    marker.style.top = `${radius + Math.sin(a) * rad}px`;
    stripMarker.style.top = `${(1 - light / 100) * W - 5}px`;
  }

  function refresh(notify = true) {
    drawStrip();
    place();
    if (notify) onPick(currentHex());
  }

  /** 外部（取色器/色板）设置颜色 */
  function setHex(hex) {
    const { r, g, b } = hexToRgb(hex);
    const hsl = rgbToHsl(r, g, b);
    hue = hsl.h;
    sat = hsl.s;
    setLight(hsl.l);
    refresh(false);
  }

  /* --- 圆盘拖动 --- */
  let dragWheel = false;

  function pickWheel(e) {
    // 明度卡在纯白/纯黑时先拉开，否则拖动看不出变化
    unlockLight();
    const rect = wheel.getBoundingClientRect();
    const x = e.clientX - rect.left - radius;
    const y = e.clientY - rect.top - radius;
    sat = (Math.min(Math.sqrt(x * x + y * y), radius) / radius) * 100;
    hue = (((Math.atan2(y, x) * 180) / Math.PI + 90) % 360 + 360) % 360;
    refresh();
  }

  wheel.addEventListener('pointerdown', (e) => {
    dragWheel = true;
    wheel.setPointerCapture(e.pointerId);
    pickWheel(e);
  });
  wheel.addEventListener('pointermove', (e) => {
    if (dragWheel) pickWheel(e);
  });
  const endWheel = (e) => {
    dragWheel = false;
    if (wheel.hasPointerCapture?.(e.pointerId)) wheel.releasePointerCapture(e.pointerId);
  };
  wheel.addEventListener('pointerup', endWheel);
  wheel.addEventListener('pointercancel', endWheel);

  /* --- 明度条拖动 --- */
  let dragStrip = false;

  function pickLight(e) {
    const rect = strip.getBoundingClientRect();
    const t = 1 - (e.clientY - rect.top) / rect.height;
    setLight(t * 100);
    place();
    onPick(currentHex());
  }

  strip.addEventListener('pointerdown', (e) => {
    dragStrip = true;
    strip.setPointerCapture(e.pointerId);
    pickLight(e);
  });
  strip.addEventListener('pointermove', (e) => {
    if (dragStrip) pickLight(e);
  });
  const endStrip = (e) => {
    dragStrip = false;
    if (strip.hasPointerCapture?.(e.pointerId)) strip.releasePointerCapture(e.pointerId);
  };
  strip.addEventListener('pointerup', endStrip);
  strip.addEventListener('pointercancel', endStrip);

  drawWheel();
  setHex(initialHex);

  return {
    el: stage,
    setHex,
    getHex: currentHex,
  };
}

/* ================= 面板 ================= */

export function openSettings(initial, onChange) {
  const modal = document.getElementById('modal');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  const actions = document.getElementById('modal-actions');

  const work = { ...DEFAULTS, ...initial };

  return new Promise((resolve) => {
    title.textContent = '高亮样式设置';
    body.innerHTML = '';
    actions.innerHTML = '';

    /* ---------- 行背景色 ---------- */
    const bgGroup = group('行背景色');
    const bgWheel = createColorWheel(work.highlightColor, (hex) => {
      work.highlightColor = hex;
      bgPicker.value = hex;
      bgHex.value = hex;
      emit();
    });

    const bgPicker = colorPicker(work.highlightColor, (hex) => {
      work.highlightColor = hex;
      bgHex.value = hex;
      bgWheel.setHex(hex);
      emit();
    });
    const bgHex = hexInput(work.highlightColor, (hex) => {
      work.highlightColor = hex;
      bgPicker.value = hex;
      bgWheel.setHex(hex);
      emit();
    });
    const bgAlpha = slider('不透明度', 0, 1, 0.01, work.highlightAlpha, 2, (v) => {
      work.highlightAlpha = v;
      emit();
    });

    const bgSide = el('div', 'set-side');
    bgSide.append(rowOf('取色', bgPicker, bgHex), bgAlpha.row);
    bgGroup.appendChild(wheelRow(bgWheel, bgSide));

    const bgPresets = el('div', 'set-presets');
    for (const p of PRESETS) {
      const chip = el('button', 'set-chip');
      chip.type = 'button';
      chip.title = `${p.name}（仅背景）`;
      chip.style.background = p.bg;
      chip.addEventListener('click', () => {
        work.highlightColor = p.bg;
        work.highlightAlpha = p.bgA;
        bgPicker.value = p.bg;
        bgHex.value = p.bg;
        bgWheel.setHex(p.bg);
        bgAlpha.set(p.bgA);
        emit();
      });
      bgPresets.appendChild(chip);
    }
    bgGroup.appendChild(labelled('预设配色', bgPresets));
    body.appendChild(bgGroup);

    /* ---------- 文字颜色 ---------- */
    const fgGroup = group('文字颜色');

    const fgToggle = el('input', 'set-check');
    fgToggle.type = 'checkbox';
    fgToggle.checked = work.textColorEnabled;
    const fgToggleLabel = el('label', 'set-check-label');
    fgToggleLabel.textContent = '自定义文字颜色';
    fgToggleLabel.appendChild(fgToggle);
    fgGroup.appendChild(fgToggleLabel);

    const fgWheel = createColorWheel(work.textColor, (hex) => {
      work.textColor = hex;
      work.textColorEnabled = true;
      fgPicker.value = hex;
      fgHex.value = hex;
      fgToggle.checked = true;
      syncFg();
      emit();
      // 文字色明度上限 95%：纯白在浅色背景上会看不见
    }, { lMax: 95 });

    const fgPicker = colorPicker(work.textColor, (hex) => {
      work.textColor = hex;
      work.textColorEnabled = true;
      fgHex.value = hex;
      fgWheel.setHex(hex);
      fgToggle.checked = true;
      syncFg();
      emit();
    });
    const fgHex = hexInput(work.textColor, (hex) => {
      work.textColor = hex;
      work.textColorEnabled = true;
      fgPicker.value = hex;
      fgWheel.setHex(hex);
      fgToggle.checked = true;
      syncFg();
      emit();
    });

    const fgAuto = el('button', 'btn btn-sm');
    fgAuto.type = 'button';
    fgAuto.textContent = '自动（取对比色）';
    fgAuto.title = '按背景亮度自动选黑或白';
    fgAuto.addEventListener('click', () => {
      const auto = readableOn(work.highlightColor);
      work.textColor = auto;
      work.textColorEnabled = true;
      fgPicker.value = auto;
      fgHex.value = auto;
      fgWheel.setHex(auto);
      fgToggle.checked = true;
      syncFg();
      emit();
    });

    const fgSide = el('div', 'set-side');
    fgSide.append(rowOf('取色', fgPicker, fgHex), fgAuto);
    fgGroup.appendChild(wheelRow(fgWheel, fgSide));

    function syncFg() {
      const on = work.textColorEnabled;
      fgWheel.el.classList.toggle('is-off', !on);
      fgPicker.disabled = !on;
      fgHex.disabled = !on;
      fgAuto.disabled = !on;
    }
    fgToggle.addEventListener('change', () => {
      work.textColorEnabled = fgToggle.checked;
      syncFg();
      emit();
    });
    syncFg();
    body.appendChild(fgGroup);

    /* ---------- 字号与字重 ---------- */
    const fontGroup = group('字号与字重');
    const size = slider('字号', 10, 32, 1, work.fontSize, 0, (v) => {
      work.fontSize = v;
      emit();
    });
    const weight = el('select', 'set-select');
    weight.append(opt('常规', 'normal'), opt('加粗', 'bold'));
    weight.value = work.fontWeight;
    weight.addEventListener('change', () => {
      work.fontWeight = weight.value;
      emit();
    });
    fontGroup.append(size.row, labelled('字重', weight));
    body.appendChild(fontGroup);

    /* ---------- 预览 ---------- */
    const prevRow = el('div', 'cue-row is-active');
    const pIdx = el('div', 'cue-idx');
    pIdx.textContent = '1';
    const pTime = el('div', 'cue-time');
    pTime.textContent = '00:00';
    const pMain = el('div', 'cue-main');
    const pText = el('div', 'cue-text');
    pText.textContent = '这是高亮时的显示效果';
    pMain.appendChild(pText);
    prevRow.append(pIdx, pTime, pMain);

    const prevWrap = el('div', 'set-preview');
    prevWrap.appendChild(prevRow);
    body.appendChild(labelled('预览', prevWrap));

    /* ---------- 按钮 ---------- */
    const resetBtn = el('button', 'btn');
    resetBtn.type = 'button';
    resetBtn.textContent = '恢复默认';
    resetBtn.addEventListener('click', () => {
      Object.assign(work, DEFAULTS);
      bgPicker.value = work.highlightColor;
      bgHex.value = work.highlightColor;
      bgWheel.setHex(work.highlightColor);
      bgAlpha.set(work.highlightAlpha);
      fgPicker.value = work.textColor;
      fgHex.value = work.textColor;
      fgWheel.setHex(work.textColor);
      size.set(work.fontSize);
      weight.value = work.fontWeight;
      fgToggle.checked = work.textColorEnabled;
      syncFg();
      emit();
    });

    const cancelBtn = el('button', 'btn');
    cancelBtn.type = 'button';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => finish(null));

    const okBtn = el('button', 'btn btn-primary');
    okBtn.type = 'button';
    okBtn.textContent = '确定';
    okBtn.addEventListener('click', () => finish({ ...work }));

    actions.append(resetBtn, cancelBtn, okBtn);

    function emit() {
      applySettings(work);
      saveSettings(work);
      if (typeof onChange === 'function') onChange({ ...work });
    }

    function finish(value) {
      cleanup();
      if (modal.open) modal.close();
      actions.innerHTML = '';
      resolve(value);
    }
    function onCancel(e) {
      e.preventDefault();
      finish(null);
    }
    function onClose() {
      cleanup();
      actions.innerHTML = '';
      resolve(null);
    }
    function cleanup() {
      modal.removeEventListener('cancel', onCancel);
      modal.removeEventListener('close', onClose);
    }

    modal.addEventListener('cancel', onCancel);
    modal.addEventListener('close', onClose);

    applySettings(work);
    modal.showModal();
  });
}

/* ================= 小工具 ================= */

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function opt(label, value) {
  const o = document.createElement('option');
  o.textContent = label;
  o.value = value;
  return o;
}

function group(title) {
  const g = el('div', 'set-group');
  const h = el('div', 'set-group-title');
  h.textContent = title;
  g.appendChild(h);
  return g;
}

function labelled(text, control) {
  const wrap = el('div', 'set-field');
  const label = el('label', 'set-label');
  label.textContent = text;
  wrap.append(label, control);
  return wrap;
}

/** 色轮 + 右侧控件 的横排 */
function wheelRow(wheel, side) {
  const row = el('div', 'set-row set-row-wheel');
  row.append(wheel.el, side);
  return row;
}

function rowOf(label, a, b) {
  const row = el('div', 'set-row');
  const l = el('label', 'set-label set-label-inline');
  l.textContent = label;
  row.append(l, a, b);
  return row;
}

function colorPicker(value, onInput) {
  const input = el('input', 'set-picker');
  input.type = 'color';
  input.value = value;
  input.title = '系统取色器';
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

function hexInput(value, onChange) {
  const input = el('input', 'set-hex');
  input.type = 'text';
  input.value = value;
  input.spellcheck = false;
  input.setAttribute('aria-label', '十六进制颜色');
  input.addEventListener('input', () => {
    const v = input.value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(v)) onChange(v.startsWith('#') ? v : `#${v}`);
  });
  input.addEventListener('blur', () => {
    input.value = value;
  });
  return input;
}

function slider(label, min, max, step, value, decimals, onInput) {
  const row = el('div', 'set-field set-field-inline');
  const labelEl = el('label', 'set-label');
  labelEl.textContent = label;

  const input = el('input', 'set-range');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  const valueEl = el('span', 'set-value');
  const show = (v) => {
    valueEl.textContent = decimals ? Number(v).toFixed(decimals) : String(Math.round(v));
  };
  show(value);
  input.addEventListener('input', () => {
    show(input.value);
    onInput(Number(input.value));
  });

  row.append(labelEl, input, valueEl);
  return {
    row,
    input,
    set(v) {
      input.value = String(v);
      show(v);
    },
  };
}
