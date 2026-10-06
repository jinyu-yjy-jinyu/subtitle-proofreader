/**
 * 字幕列表：虚拟滚动、高亮、自动跟随、行内编辑。
 */

const ROW_MIN = 44; // 单行最小高度
const OVERSCAN = 6; // 视口外额外渲染的行数

export class CueList {
  constructor(container, { onSeek, onChange, onFollowToggle } = {}) {
    this.container = container;
    this.onSeek = onSeek || (() => {});
    this.onChange = onChange || (() => {});
    this.onFollowToggle = onFollowToggle || (() => {});

    this.cues = [];
    this.activeIndices = new Set();
    this.follow = true;
    this.userScrollUntil = 0;
    this.wasSuspended = false;
    this.editingIndex = -1;

    this.spacer = document.createElement('div');
    this.spacer.className = 'cue-spacer';
    this.canvas = document.createElement('div');
    this.canvas.className = 'cue-canvas';
    this.container.append(this.spacer, this.canvas);

    this.rowPool = [];
    this.heights = [];

    this.container.addEventListener('scroll', () => this._onScroll(), { passive: true });
    this.container.addEventListener('wheel', () => this._suspendFollow(), { passive: true });

    // 拖动滚动列表时暂停跟随
    let downAt = 0;
    this.container.addEventListener('pointerdown', () => {
      downAt = Date.now();
    });
    this.container.addEventListener('pointerup', () => {
      if (Date.now() - downAt < 250) this._suspendFollow();
    });
  }

  /** 设置数据。cues 需带 text/start/end/index */
  setCues(cues, { keepScroll = false } = {}) {
    this.cues = cues || [];
    this.heights = new Array(this.cues.length).fill(ROW_MIN);
    this.activeIndices = new Set();
    this.editingIndex = -1;
    const saved = keepScroll ? this.container.scrollTop : 0;

    this._rebuild();

    // 先恢复 scrollTop，再重算 canvas 偏移：
    // _rebuild() 内部已按「旧 scrollTop」定位过一次，不重新定位行会错位。
    this.container.scrollTop = saved;
    this._position();
    this._paint();
  }

  /** 批量标记高亮 */
  setActive(indices) {
    const next = new Set(indices);
    // 先清掉上一轮的高亮，避免滚动出去的行残留 is-active
    for (const i of this.activeIndices) {
      if (!next.has(i) && this.rowPool[i]) {
        this.rowPool[i].classList.remove('is-active');
      }
    }
    this.activeIndices = next;
    this._paint();

    // 用户手动滚动后的短暂抑制期已过 -> 自动恢复跟随并同步按钮状态
    if (this.follow && Date.now() > this.userScrollUntil && this.wasSuspended) {
      this.wasSuspended = false;
      this.userScrollUntil = 0;
      this.onFollowToggle(true, false);
    }

    if (this.follow && Date.now() > this.userScrollUntil) {
      this.scrollToActive();
    }
  }

  /** 取消自动跟随（用户手动滚动后） */
  _suspendFollow() {
    if (!this.follow) return;
    this.userScrollUntil = Date.now() + 3000;
    this.wasSuspended = true;
    this.onFollowToggle(false, true);
  }

  resumeFollow() {
    this.follow = true;
    this.userScrollUntil = 0;
    this.wasSuspended = false;
    this.onFollowToggle(true, false);
    this.scrollToActive();
  }

  pauseFollow() {
    this.follow = false;
    this.wasSuspended = false;
    this.userScrollUntil = Number.MAX_SAFE_INTEGER;
    this.onFollowToggle(false, false);
  }

  /** 全量重建 DOM 节点并测量真实高度 */
  _rebuild() {
    this.canvas.innerHTML = '';
    this.rowPool = [];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < this.cues.length; i += 1) {
      const row = this._createRow(i);
      this.rowPool.push(row);
      frag.appendChild(row);
    }
    this.canvas.appendChild(frag);
    // 必须显式 top:0 —— absolute 元素缺 top 时会退回「静态位置」，
    // 也就是排在撑高的 spacer 之后，整块内容被顶到可视区外（表现为「有计数但看不到内容」）。
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.right = '0';
    this._measureAll();
    this._position();
    this._paint(); // 时间列在 _paint 里填充，缺这一步首屏时间码全是空的
  }

  _createRow(i) {
    const cue = this.cues[i];
    const row = document.createElement('div');
    row.className = 'cue-row';
    row.dataset.index = String(i);

    const idx = document.createElement('div');
    idx.className = 'cue-idx';
    idx.textContent = String(cue.index ?? i + 1);

    const time = document.createElement('div');
    time.className = 'cue-time';

    const main = document.createElement('div');
    main.className = 'cue-main';

    const text = document.createElement('div');
    text.className = 'cue-text';
    text.textContent = cue.text ?? '';
    main.appendChild(text);

    row.append(idx, time, main);

    row.addEventListener('click', (e) => {
      if (e.target.closest('.cue-edit')) return;
      this.onSeek(this.cues[i].start, { play: false });
    });
    row.addEventListener('dblclick', (e) => {
      if (e.target.closest('.cue-edit')) return;
      this.beginEdit(i);
    });

    return row;
  }

  _measureAll() {
    for (let i = 0; i < this.rowPool.length; i += 1) {
      const row = this.rowPool[i];
      // 被隐藏的行 offsetHeight 为 0，测量会把缓存高度冲成 0 —— 只测可见行。
      if (row.style.display === 'none' && i !== this.editingIndex) continue;
      this.heights[i] = Math.max(ROW_MIN, row.offsetHeight);
    }
    let total = 0;
    for (const h of this.heights) total += h || ROW_MIN;
    this.spacer.style.height = `${total}px`;
  }

  /** 重新获取行内元素引用（编辑后 text 节点会被替换） */
  _partsOf(row) {
    return {
      idx: row.querySelector('.cue-idx'),
      time: row.querySelector('.cue-time'),
      text: row.querySelector('.cue-text'),
      main: row.querySelector('.cue-main'),
    };
  }

  /** 把某一行滚进可视区（编辑不可见的行前先调用） */
  scrollToIndex(i) {
    let acc = 0;
    for (let k = 0; k < i; k += 1) acc += this.heights[k] || ROW_MIN;
    this.container.scrollTop = acc;
    this._position();
  }

  _position() {
    const scrollTop = this.container.scrollTop;
    const viewport = this.container.clientHeight;
    let start = 0;
    let acc = 0;
    while (start < this.heights.length && acc + this.heights[start] < scrollTop - OVERSCAN * ROW_MIN) {
      acc += this.heights[start];
      start += 1;
    }
    let end = start;
    let accEnd = acc;
    while (end < this.heights.length && accEnd < scrollTop + viewport + OVERSCAN * ROW_MIN) {
      accEnd += this.heights[end];
      end += 1;
    }

    this.canvas.style.transform = `translateY(${acc}px)`;
    this.canvas.style.height = 'auto';

    // 只更新可视区内的行（其余隐藏但保持在 DOM 中以便测量）
    for (let i = 0; i < this.rowPool.length; i += 1) {
      const row = this.rowPool[i];
      if (i >= start && i < end) {
        row.style.display = '';
      } else if (this.editingIndex !== i) {
        row.style.display = 'none';
      }
    }
    this.visibleRange = [start, end];
  }

  _onScroll() {
    // 滚动后可视区变了，必须重绘：否则新进入视口的行时间码是空的
    this._position();
    this._paint();
  }

  /** 把当前高亮行滚到可视区中部 */
  scrollToActive() {
    if (!this.activeIndices.size) return;
    const target = [...this.activeIndices][0];
    if (target == null) return;

    let acc = 0;
    for (let i = 0; i < target; i += 1) acc += this.heights[i] || ROW_MIN;
    const h = this.heights[target] || ROW_MIN;
    const viewport = this.container.clientHeight;
    const top = acc;
    const bottom = acc + h;

    // 已在舒适可视范围内则不打扰
    const margin = Math.min(viewport * 0.25, 120);
    if (top >= this.container.scrollTop + margin && bottom <= this.container.scrollTop + viewport - margin) {
      return;
    }
    this.container.scrollTop = Math.max(0, top - (viewport - h) / 2);
    this._position();
  }

  /** 只更新可见行的文本/状态，避免全量重排 */
  _paint() {
    const [start, end] = this.visibleRange || [0, this.cues.length];
    for (let i = Math.max(0, start); i < Math.min(end, this.cues.length); i += 1) {
      const cue = this.cues[i];
      const row = this.rowPool[i];
      if (!row) continue;

      const active = this.activeIndices.has(i);
      row.classList.toggle('is-active', active);
      row.classList.toggle('is-dirty', Boolean(cue.dirty));
      row.classList.toggle('is-deleted', !(cue.text || '').trim());

      const label = `${fmt(cue.start)}`;
      const flag = cue.estimated ? '<span class="flag" title="估算时间轴">估</span>' : '';
      if (row._timeLabel !== label + flag) {
        const { time } = this._partsOf(row);
        if (time) {
          time.innerHTML = `${label}${flag}`;
          row._timeLabel = label + flag;
        }
      }
    }
  }

  /** Refresh a single line after its text changed (keeps scroll position) */
  updateOne(i, cue) {
    const row = this.rowPool[i];
    if (!row) return;
    this.cues[i] = cue;
    const parts = this._partsOf(row);
    if (parts.text && parts.text.textContent !== cue.text) {
      parts.text.textContent = cue.text;
    }
    // 高度可能变化：确保该行可见后再测量，否则 offsetHeight 为 0
    row.style.display = '';
    this.heights[i] = Math.max(ROW_MIN, row.offsetHeight);
    this._measureAll();
    this._position();
    this._paint();
  }

  beginEdit(i) {
    // 同一行已在编辑：再进来会孤掉上一个 textarea 并误触发 blur 提交
    if (this.editingIndex === i) return;
    if (this.editingIndex >= 0 && this.editingIndex !== i) {
      this.commitEdit(this.editingIndex);
    }
    const row = this.rowPool[i];
    const cue = this.cues[i];
    if (!row || !cue) return;

    this.editingIndex = i;
    // 编辑中的行必须可见，否则输入框会被 _position 隐藏
    row.style.display = '';
    this.scrollToIndex(i); // 保持编辑行在视口内，避免行位置错乱
    const main = this._partsOf(row).main;
    const original = main.innerHTML;
    main.innerHTML = '';

    const ta = document.createElement('textarea');
    ta.className = 'cue-edit';
    ta.value = cue.text ?? '';
    main.appendChild(ta);

    const hint = document.createElement('div');
    hint.className = 'cue-edit-hint';
    hint.textContent = 'Ctrl+Enter 提交 · Esc 取消 · 清空文本即删除该句';
    main.appendChild(hint);

    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    // 展开成 textarea 后行会变高，必须重新测量并重排，
    // 否则 canvas 的 translateY 与 spacer 高度仍按 旧值，下面的行会错位。
    this.heights[i] = Math.max(ROW_MIN, row.offsetHeight);
    this._measureAll();
    this._position();

    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelEdit(i, original);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.commitEdit(i);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.commitEdit(i);
        const next = this.cues[i + 1] ? i + 1 : -1;
        if (next >= 0) this.beginEdit(next);
      }
      e.stopPropagation();
    });
    ta.addEventListener('blur', () => {
      // 延迟，避免与内部按钮点击冲突
      setTimeout(() => {
        if (this.editingIndex === i) this.commitEdit(i);
      }, 120);
    });
  }

  cancelEdit(i, originalHtml) {
    const row = this.rowPool[i];
    if (!row) return;
    this._partsOf(row).main.innerHTML = originalHtml;
    this.editingIndex = -1;
    row.style.display = '';
    this.heights[i] = Math.max(ROW_MIN, row.offsetHeight);
    this._measureAll();
    this._position();
    this._paint();
  }

  commitEdit(i) {
    if (this.editingIndex !== i) return;
    const row = this.rowPool[i];
    if (!row) return;
    const ta = row.querySelector('.cue-edit');
    if (!ta) return;

    const value = ta.value.trim();
    const cue = this.cues[i];
    const changed = value !== (cue.originalText ?? cue.text ?? '').trim();
    cue.text = value;
    cue.dirty = changed;

    const main = this._partsOf(row).main;
    const text = document.createElement('div');
    text.className = 'cue-text';
    text.textContent = value;
    main.innerHTML = '';
    main.appendChild(text);

    this.editingIndex = -1;
    this.heights[i] = Math.max(ROW_MIN, row.offsetHeight);
    this._measureAll();
    this._position();
    this._paint();
    this.onChange(cue, i);
  }
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