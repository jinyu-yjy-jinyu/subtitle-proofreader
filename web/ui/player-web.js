/** 浏览器版播放器封装（与 Electron 版接口一致，去掉 keepPlaying）。 */

export class PlayerController {
  constructor(video, { onTime, onStateChange } = {}) {
    this.video = video;
    this.onTime = onTime || (() => {});
    this.onStateChange = onStateChange || (() => {});
    this.currentSrc = '';
    this.rafId = null;
    this.vfcbId = null;
    this.lastEmit = 0;
    this.minInterval = 60;

    this._bind();
  }

  _bind() {
    const v = this.video;

    v.addEventListener('play', () => this.onStateChange('play'));
    v.addEventListener('pause', () => this.onStateChange('pause'));
    v.addEventListener('ended', () => {
      this._stopLoop();
      this.onStateChange('ended');
    });
    v.addEventListener('loadedmetadata', () => this.onStateChange('loadedmetadata'));
    v.addEventListener('error', () => this.onStateChange('error'));
    v.addEventListener('durationchange', () => this.onStateChange('durationchange'));

    v.addEventListener('play', () => this._startLoop());
    v.addEventListener('pause', () => this._stopLoop());
    v.addEventListener('seeked', () => this.onTime(v.currentTime));
    v.addEventListener('timeupdate', () => {
      if (!v.paused) return;
      this.onTime(v.currentTime);
    });

    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.getElementById('modal')?.open) return;
      e.preventDefault();
      this.toggle();
    });
  }

  _startLoop() {
    this._stopLoop();
    this.lastEmit = performance.now();

    if (typeof this.video.requestVideoFrameCallback === 'function') {
      const vfcb = () => {
        const t = performance.now();
        if (t - this.lastEmit >= this.minInterval) {
          this.lastEmit = t;
          this.onTime(this.video.currentTime);
        }
        this.vfcbId = this.video.requestVideoFrameCallback(vfcb);
      };
      this.vfcbId = this.video.requestVideoFrameCallback(vfcb);
    } else {
      const step = () => {
        const t = performance.now();
        if (t - this.lastEmit >= this.minInterval) {
          this.lastEmit = t;
          this.onTime(this.video.currentTime);
        }
        this.rafId = requestAnimationFrame(step);
      };
      this.rafId = requestAnimationFrame(step);
    }
  }

  _stopLoop() {
    if (this.vfcbId != null) {
      if (typeof this.video.cancelVideoFrameCallback === 'function') {
        this.video.cancelVideoFrameCallback(this.vfcbId);
      }
      this.vfcbId = null;
    }
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  setSource(url) {
    if (this.currentSrc === url) return;
    this.currentSrc = url;
    this.video.src = url;
    this.video.load();
  }

  get duration() {
    const d = this.video.duration;
    return Number.isFinite(d) ? d : 0;
  }

  get currentTime() {
    return this.video.currentTime || 0;
  }

  seek(t) {
    const dur = this.duration;
    const target = dur > 0 ? Math.max(0, Math.min(t, dur - 0.01)) : Math.max(0, t);
    this.video.currentTime = target;
    this.onTime(this.video.currentTime);
  }

  toggle() {
    if (this.video.paused) {
      const p = this.video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      this.video.pause();
    }
  }

  setSpeed(rate) {
    this.video.playbackRate = Number(rate) || 1;
  }
}