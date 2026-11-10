import { invoke } from "@tauri-apps/api/core";

export class DualTrackPlayer {
  private ctx: AudioContext | null = null;
  private vocalsBuffer: AudioBuffer | null = null;
  private noVocalsBuffer: AudioBuffer | null = null;

  private vocalsSource: AudioBufferSourceNode | null = null;
  private noVocalsSource: AudioBufferSourceNode | null = null;

  private vocalsGain: GainNode | null = null;
  private noVocalsGain: GainNode | null = null;
  private masterGain: GainNode | null = null;

  private startTime: number = 0;
  private pauseOffset: number = 0;
  private isPlaying: boolean = false;
  private duration: number = 0;

  private vocalPresence: number = 1.0; // 0.0 (no vocals) to 1.0 (full vocals)
  private onTimeUpdateCallback?: (currentTime: number, duration: number) => void;
  private onEndedCallback?: () => void;
  private animFrameId: number | null = null;

  constructor() {}

  public async loadTracks(vocalsPath: string, noVocalsPath: string): Promise<number> {
    this.stop();
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }

    // Fetch base64 audio data through Tauri backend
    const [vocB64, noVocB64] = await Promise.all([
      invoke<string>("read_local_file_base64", { path: vocalsPath }),
      invoke<string>("read_local_file_base64", { path: noVocalsPath }),
    ]);

    const vocBytes = this.base64ToArrayBuffer(vocB64);
    const noVocBytes = this.base64ToArrayBuffer(noVocB64);

    const [vocBuf, noVocBuf] = await Promise.all([
      this.ctx.decodeAudioData(vocBytes),
      this.ctx.decodeAudioData(noVocBytes),
    ]);

    this.vocalsBuffer = vocBuf;
    this.noVocalsBuffer = noVocBuf;
    this.duration = Math.max(vocBuf.duration, noVocBuf.duration);
    this.pauseOffset = 0;

    return this.duration;
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  public setVocalPresence(val: number) {
    this.vocalPresence = Math.max(0, Math.min(1, val));
    if (this.vocalsGain && this.ctx) {
      this.vocalsGain.gain.setValueAtTime(this.vocalPresence, this.ctx.currentTime);
    }
  }

  public play(offsetSeconds?: number) {
    if (!this.ctx || !this.vocalsBuffer || !this.noVocalsBuffer) return;
    if (this.isPlaying) return;

    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    const startPos = offsetSeconds !== undefined ? offsetSeconds : this.pauseOffset;
    if (startPos >= this.duration) {
      this.pauseOffset = 0;
      return;
    }

    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);

    // Vocals track
    this.vocalsGain = this.ctx.createGain();
    this.vocalsGain.gain.setValueAtTime(this.vocalPresence, this.ctx.currentTime);
    this.vocalsGain.connect(this.masterGain);

    this.vocalsSource = this.ctx.createBufferSource();
    this.vocalsSource.buffer = this.vocalsBuffer;
    this.vocalsSource.connect(this.vocalsGain);

    // Backing (no vocals) track
    this.noVocalsGain = this.ctx.createGain();
    this.noVocalsGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
    this.noVocalsGain.connect(this.masterGain);

    this.noVocalsSource = this.ctx.createBufferSource();
    this.noVocalsSource.buffer = this.noVocalsBuffer;
    this.noVocalsSource.connect(this.noVocalsGain);

    // Start playback synchronized
    const now = this.ctx.currentTime;
    this.startTime = now - startPos;
    this.vocalsSource.start(0, startPos);
    this.noVocalsSource.start(0, startPos);

    this.isPlaying = true;
    this.noVocalsSource.onended = () => {
      if (this.getCurrentTime() >= this.duration - 0.2) {
        this.pause();
        this.pauseOffset = 0;
        this.onEndedCallback?.();
      }
    };

    this.startTracking();
  }

  public pause() {
    if (!this.isPlaying || !this.ctx) return;
    this.pauseOffset = this.getCurrentTime();

    if (this.vocalsSource) {
      try { this.vocalsSource.stop(); } catch { /* ignore */ }
      this.vocalsSource.disconnect();
      this.vocalsSource = null;
    }
    if (this.noVocalsSource) {
      try { this.noVocalsSource.stop(); } catch { /* ignore */ }
      this.noVocalsSource.disconnect();
      this.noVocalsSource = null;
    }

    this.isPlaying = false;
    this.stopTracking();
  }

  public seek(targetSeconds: number) {
    const clamped = Math.max(0, Math.min(this.duration, targetSeconds));
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.pause();
    }
    this.pauseOffset = clamped;
    if (wasPlaying) {
      this.play(clamped);
    }
    this.onTimeUpdateCallback?.(clamped, this.duration);
  }

  public stop() {
    this.pause();
    this.pauseOffset = 0;
  }

  public getCurrentTime(): number {
    if (!this.isPlaying || !this.ctx) {
      return this.pauseOffset;
    }
    return Math.min(this.duration, Math.max(0, this.ctx.currentTime - this.startTime));
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getDuration(): number {
    return this.duration;
  }

  public setOnTimeUpdate(cb: (currentTime: number, duration: number) => void) {
    this.onTimeUpdateCallback = cb;
  }

  public setOnEnded(cb: () => void) {
    this.onEndedCallback = cb;
  }

  private startTracking() {
    this.stopTracking();
    const tick = () => {
      if (!this.isPlaying) return;
      this.onTimeUpdateCallback?.(this.getCurrentTime(), this.duration);
      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stopTracking() {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}
