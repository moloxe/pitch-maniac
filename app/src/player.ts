import { invoke } from "@tauri-apps/api/core";
import {
  StereoTimePitchProcessor,
  StereoTrackData,
  clampSpeed,
  clampTranspose,
} from "./audioDsp";

const DSP_BUFFER_SIZE = 1024;

function extractStereoData(buffer: AudioBuffer): StereoTrackData {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  return {
    left,
    right,
    length: buffer.length,
  };
}

export class DualTrackPlayer {
  private ctx: AudioContext | null = null;
  private vocalsBuffer: AudioBuffer | null = null;
  private noVocalsBuffer: AudioBuffer | null = null;

  private processor: StereoTimePitchProcessor | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private keepAliveSource: ConstantSourceNode | null = null;
  private masterGain: GainNode | null = null;

  private anchorSongTime: number = 0;
  private anchorAudioTime: number = 0;
  private pauseOffset: number = 0;
  private isPlaying: boolean = false;
  private duration: number = 0;

  private vocalPresence: number = 0.8; // 0.0 (no vocals) to 1.0 (full vocals)
  private transposeSemitones: number = 0; // -12 to +12
  private playbackSpeed: number = 1.0; // 0.50 to 1.50

  private onTimeUpdateCallback?: (currentTime: number, duration: number) => void;
  private onEndedCallback?: () => void;
  private animFrameId: number | null = null;
  private endedDispatched: boolean = false;

  constructor() {}

  public async loadTracks(vocalsPath: string, noVocalsPath: string): Promise<number> {
    this.stop();
    if (!this.ctx) {
      this.ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
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
    this.anchorSongTime = 0;

    this.processor = new StereoTimePitchProcessor(
      this.ctx.sampleRate,
      extractStereoData(vocBuf),
      extractStereoData(noVocBuf)
    );
    this.processor.setVocalPresence(this.vocalPresence);
    this.processor.setTranspose(this.transposeSemitones);
    this.processor.setSpeed(this.playbackSpeed);

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
    this.processor?.setVocalPresence(this.vocalPresence);
  }

  public getVocalPresence(): number {
    return this.vocalPresence;
  }

  public setTranspose(semitones: number) {
    this.transposeSemitones = clampTranspose(semitones);
    this.processor?.setTranspose(this.transposeSemitones);
  }

  public getTranspose(): number {
    return this.transposeSemitones;
  }

  public setSpeed(speed: number) {
    const clamped = clampSpeed(speed);
    if (this.isPlaying && this.ctx) {
      // Re-anchor current visual time before changing speed to prevent jump
      const now = this.ctx.currentTime;
      const cur = this.getCurrentTime();
      this.anchorSongTime = cur;
      this.anchorAudioTime = now;
    }
    this.playbackSpeed = clamped;
    this.processor?.setSpeed(this.playbackSpeed);
  }

  public getSpeed(): number {
    return this.playbackSpeed;
  }

  public async play(offsetSeconds?: number) {
    if (!this.ctx || !this.vocalsBuffer || !this.noVocalsBuffer || !this.processor) return;
    if (this.isPlaying) return;

    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }

    const startPos = offsetSeconds !== undefined ? offsetSeconds : this.pauseOffset;
    if (startPos >= this.duration) {
      this.pauseOffset = 0;
      this.anchorSongTime = 0;
      return;
    }

    this.processor.seekSeconds(startPos);
    this.endedDispatched = false;

    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);

    // Use 1 silent input channel so WebKit/Safari reliably fires onaudioprocess
    this.scriptNode = this.ctx.createScriptProcessor(DSP_BUFFER_SIZE, 1, 2);
    this.keepAliveSource = this.ctx.createConstantSource();
    this.keepAliveSource.offset.setValueAtTime(0, this.ctx.currentTime);
    this.keepAliveSource.connect(this.scriptNode);
    this.scriptNode.connect(this.masterGain);

    this.anchorSongTime = startPos;
    this.anchorAudioTime = this.ctx.currentTime;

    this.scriptNode.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!this.processor || !this.ctx || !this.isPlaying) return;

      const outL = event.outputBuffer.getChannelData(0);
      const outR = event.outputBuffer.getChannelData(1);

      const blockStartSongTime = this.processor.getCurrentTimeSeconds();
      this.processor.processBlock(outL, outR, event.outputBuffer.length);

      this.anchorSongTime = blockStartSongTime;
      this.anchorAudioTime = this.ctx.currentTime;

      if (this.processor.isEnded() && !this.endedDispatched) {
        this.endedDispatched = true;
        setTimeout(() => {
          if (!this.isPlaying) return;
          this.stopActiveNodes();
          this.pauseOffset = 0;
          this.anchorSongTime = 0;
          this.onTimeUpdateCallback?.(0, this.duration);
          this.onEndedCallback?.();
        }, 0);
      }
    };

    this.keepAliveSource.start();
    this.isPlaying = true;
    this.startTracking();
  }

  private stopActiveNodes() {
    if (this.scriptNode) {
      this.scriptNode.onaudioprocess = null;
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    if (this.keepAliveSource) {
      try {
        this.keepAliveSource.stop();
      } catch {
        /* ignore */
      }
      this.keepAliveSource.disconnect();
      this.keepAliveSource = null;
    }
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
    this.isPlaying = false;
    this.stopTracking();
  }

  public pause() {
    if (!this.isPlaying || !this.ctx) return;
    const current = this.getCurrentTime();
    this.pauseOffset = current;
    this.anchorSongTime = current;
    this.stopActiveNodes();
    this.onTimeUpdateCallback?.(this.pauseOffset, this.duration);
  }

  public seek(targetSeconds: number) {
    const clamped = Math.max(0, Math.min(this.duration, targetSeconds));
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.stopActiveNodes();
    }
    this.pauseOffset = clamped;
    this.anchorSongTime = clamped;
    this.processor?.seekSeconds(clamped);
    if (wasPlaying) {
      void this.play(clamped);
    }
    this.onTimeUpdateCallback?.(clamped, this.duration);
  }

  public stop() {
    this.pause();
    this.pauseOffset = 0;
    this.anchorSongTime = 0;
    this.processor?.seekSeconds(0);
    this.onTimeUpdateCallback?.(0, this.duration);
  }

  public getCurrentTime(): number {
    if (!this.isPlaying || !this.ctx) {
      return this.pauseOffset;
    }
    const elapsed = Math.max(0, this.ctx.currentTime - this.anchorAudioTime);
    const maxStep = (DSP_BUFFER_SIZE / this.ctx.sampleRate) * this.playbackSpeed * 2;
    const interpolated = this.anchorSongTime + Math.min(elapsed * this.playbackSpeed, maxStep);
    return Math.min(this.duration, Math.max(0, interpolated));
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
    let lastEmitTime = 0;
    const tick = (time: number) => {
      if (!this.isPlaying) return;
      // Throttle root callback updates to ~200ms (5Hz) to keep React thread fluid
      if (time - lastEmitTime >= 200) {
        this.onTimeUpdateCallback?.(this.getCurrentTime(), this.duration);
        lastEmitTime = time;
      }
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
