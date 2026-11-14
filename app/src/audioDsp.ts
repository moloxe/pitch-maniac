export interface StereoTrackData {
  left: Float32Array;
  right: Float32Array;
  length: number;
}

export function clampTranspose(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0;
  return Math.max(-12, Math.min(12, Math.round(semitones)));
}

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1.0;
  return Math.max(0.5, Math.min(1.5, Math.round(speed * 100) / 100));
}

export function semitonesToPitchFactor(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/**
 * Real-time stereo WSOLA time-stretch + pitch-shift processor operating
 * synchronously on dual stem tracks (vocals + backing/no_vocals).
 *
 * Guarantees sample-accurate phase alignment between both stems and zero-drift
 * song position tracking across arbitrary speed and transpose changes.
 */
export class StereoTimePitchProcessor {
  private readonly sampleRate: number;
  private readonly vocals: StereoTrackData;
  private readonly noVocals: StereoTrackData;
  private readonly totalFrames: number;

  // WSOLA synthesis geometry
  private readonly windowSize: number;
  private readonly hopOut: number;
  private readonly searchRadius: number;
  private readonly hannWindow: Float32Array;

  // Overlap-add and correlation state
  private overlapL: Float32Array;
  private overlapR: Float32Array;
  private prevTailL: Float32Array;
  private prevTailR: Float32Array;
  private readyL: Float32Array;
  private readyR: Float32Array;
  private readyCursor: number;
  private hasPrevTail: boolean = false;

  // Playback parameters
  private vocalPresence: number = 0.8;
  private transposeSemitones: number = 0;
  private pitchFactor: number = 1.0;
  private speed: number = 1.0;

  // Song position in input frames (floating point for fractional speed)
  private nominalPos: number = 0;
  private ended: boolean = false;
  private wasBypass: boolean = true;

  constructor(
    sampleRate: number,
    vocals: StereoTrackData,
    noVocals: StereoTrackData,
    windowSize = 2048
  ) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100;
    this.vocals = vocals;
    this.noVocals = noVocals;
    this.totalFrames = Math.max(vocals.length, noVocals.length);

    this.windowSize = windowSize;
    this.hopOut = windowSize >> 1;
    this.searchRadius = Math.max(128, Math.round(this.sampleRate * 0.012));

    // Periodic Hann window satisfying W[i] + W[i + hopOut] === 1.0 (COLA)
    this.hannWindow = new Float32Array(this.windowSize);
    for (let i = 0; i < this.windowSize; i++) {
      this.hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / this.windowSize));
    }

    this.overlapL = new Float32Array(this.hopOut);
    this.overlapR = new Float32Array(this.hopOut);
    this.prevTailL = new Float32Array(this.hopOut);
    this.prevTailR = new Float32Array(this.hopOut);
    this.readyL = new Float32Array(this.hopOut);
    this.readyR = new Float32Array(this.hopOut);
    this.readyCursor = this.hopOut; // Force synthesis on first DSP hop
  }

  public setVocalPresence(val: number): void {
    this.vocalPresence = Math.max(0, Math.min(1, val));
  }

  public setTranspose(semitones: number): void {
    this.transposeSemitones = clampTranspose(semitones);
    this.pitchFactor = semitonesToPitchFactor(this.transposeSemitones);
  }

  public setSpeed(speed: number): void {
    this.speed = clampSpeed(speed);
  }

  public getVocalPresence(): number {
    return this.vocalPresence;
  }

  public getTranspose(): number {
    return this.transposeSemitones;
  }

  public getSpeed(): number {
    return this.speed;
  }

  public getCurrentFrame(): number {
    return Math.max(0, Math.min(this.totalFrames, this.nominalPos));
  }

  public getCurrentTimeSeconds(): number {
    return this.getCurrentFrame() / this.sampleRate;
  }

  public isEnded(): boolean {
    return this.ended;
  }

  public seekSeconds(seconds: number): void {
    const targetFrame = Math.max(0, Math.min(this.totalFrames, seconds * this.sampleRate));
    this.nominalPos = targetFrame;
    this.ended = targetFrame >= this.totalFrames;
    this.resetDspBuffers();
  }

  private resetDspBuffers(): void {
    this.overlapL.fill(0);
    this.overlapR.fill(0);
    this.prevTailL.fill(0);
    this.prevTailR.fill(0);
    this.readyL.fill(0);
    this.readyR.fill(0);
    this.readyCursor = this.hopOut;
    this.hasPrevTail = false;
  }

  private isBypassActive(): boolean {
    return this.transposeSemitones === 0 && Math.abs(this.speed - 1.0) < 1e-4;
  }

  /**
   * Reads a single interpolated stereo sample from the mixed stems at fractional frame `pos`.
   */
  private readMixedLinear(pos: number, channel: 0 | 1): number {
    if (pos < 0 || pos >= this.totalFrames) return 0;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const nextIdx = idx + 1;

    const nvArr = channel === 0 ? this.noVocals.left : this.noVocals.right;
    const vArr = channel === 0 ? this.vocals.left : this.vocals.right;

    let nv = 0;
    if (idx < this.noVocals.length) {
      const s0 = nvArr[idx];
      const s1 = nextIdx < this.noVocals.length ? nvArr[nextIdx] : 0;
      nv = s0 + (s1 - s0) * frac;
    }

    let v = 0;
    if (this.vocalPresence > 0 && idx < this.vocals.length) {
      const s0 = vArr[idx];
      const s1 = nextIdx < this.vocals.length ? vArr[nextIdx] : 0;
      v = s0 + (s1 - s0) * frac;
    }

    return nv + this.vocalPresence * v;
  }

  private readMixedMonoLinear(pos: number): number {
    if (pos < 0 || pos >= this.totalFrames) return 0;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const nextIdx = idx + 1;

    let nv = 0;
    if (idx < this.noVocals.length) {
      const l0 = this.noVocals.left[idx];
      const r0 = this.noVocals.right[idx];
      const l1 = nextIdx < this.noVocals.length ? this.noVocals.left[nextIdx] : 0;
      const r1 = nextIdx < this.noVocals.length ? this.noVocals.right[nextIdx] : 0;
      const m0 = 0.5 * (l0 + r0);
      const m1 = 0.5 * (l1 + r1);
      nv = m0 + (m1 - m0) * frac;
    }

    let v = 0;
    if (this.vocalPresence > 0 && idx < this.vocals.length) {
      const l0 = this.vocals.left[idx];
      const r0 = this.vocals.right[idx];
      const l1 = nextIdx < this.vocals.length ? this.vocals.left[nextIdx] : 0;
      const r1 = nextIdx < this.vocals.length ? this.vocals.right[nextIdx] : 0;
      const m0 = 0.5 * (l0 + r0);
      const m1 = 0.5 * (l1 + r1);
      v = m0 + (m1 - m0) * frac;
    }

    return nv + this.vocalPresence * v;
  }

  /**
   * Finds the input frame offset near `nominalPos` whose pitch-scaled waveform
   * best correlates with `prevTail` to prevent phase cancellations across hops.
   */
  private findBestWsolaStart(nominalPos: number): number {
    if (!this.hasPrevTail) {
      return nominalPos;
    }

    const stepSubsample = 4;
    const compareLen = this.hopOut;

    let prevEnergy = 0;
    for (let i = 0; i < compareLen; i += stepSubsample) {
      const pm = 0.5 * (this.prevTailL[i] + this.prevTailR[i]);
      prevEnergy += pm * pm;
    }

    if (prevEnergy < 1e-6) {
      return nominalPos;
    }

    const P = this.pitchFactor;
    const maxOffset = this.searchRadius;
    const minStart = Math.max(0, nominalPos - maxOffset);
    const maxStart = Math.min(
      Math.max(0, this.totalFrames - 1),
      nominalPos + maxOffset
    );

    const scoreCandidate = (startPos: number): number => {
      let dot = 0;
      let candEnergy = 0;
      for (let i = 0; i < compareLen; i += stepSubsample) {
        const pm = 0.5 * (this.prevTailL[i] + this.prevTailR[i]);
        const cm = this.readMixedMonoLinear(startPos + i * P);
        dot += pm * cm;
        candEnergy += cm * cm;
      }
      if (candEnergy < 1e-9) return -Infinity;
      return dot / Math.sqrt(prevEnergy * candEnergy);
    };

    let bestPos = nominalPos;
    let bestScore = -Infinity;

    // Coarse search
    for (let pos = minStart; pos <= maxStart; pos += 4) {
      const score = scoreCandidate(pos);
      if (score > bestScore) {
        bestScore = score;
        bestPos = pos;
      }
    }

    // Fine refinement around coarse winner
    const fineMin = Math.max(minStart, bestPos - 3);
    const fineMax = Math.min(maxStart, bestPos + 3);
    for (let pos = fineMin; pos <= fineMax; pos += 1) {
      const score = scoreCandidate(pos);
      if (score > bestScore) {
        bestScore = score;
        bestPos = pos;
      }
    }

    return bestPos;
  }

  private synthesizeNextHop(): void {
    if (this.nominalPos >= this.totalFrames) {
      this.readyL.fill(0);
      this.readyR.fill(0);
      this.readyCursor = 0;
      this.ended = true;
      return;
    }

    const bestStart = this.findBestWsolaStart(this.nominalPos);
    const P = this.pitchFactor;
    const hop = this.hopOut;

    // First half of grain overlaps with previous grain's weighted tail
    for (let i = 0; i < hop; i++) {
      const pos = bestStart + i * P;
      const w = this.hannWindow[i];
      const sL = this.readMixedLinear(pos, 0);
      const sR = this.readMixedLinear(pos, 1);

      const outL = this.overlapL[i] + w * sL;
      const outR = this.overlapR[i] + w * sR;

      this.readyL[i] = Math.max(-1, Math.min(1, outL));
      this.readyR[i] = Math.max(-1, Math.min(1, outR));
    }

    // Second half of grain becomes the weighted overlap and reference tail for next hop
    for (let i = 0; i < hop; i++) {
      const pos = bestStart + (hop + i) * P;
      const w = this.hannWindow[hop + i];
      const sL = this.readMixedLinear(pos, 0);
      const sR = this.readMixedLinear(pos, 1);

      this.prevTailL[i] = sL;
      this.prevTailR[i] = sR;
      this.overlapL[i] = w * sL;
      this.overlapR[i] = w * sR;
    }

    this.hasPrevTail = true;
    this.nominalPos += hop * this.speed;
    this.readyCursor = 0;

    if (this.nominalPos >= this.totalFrames) {
      this.nominalPos = this.totalFrames;
    }
  }

  /**
   * Fills `outL` and `outR` with `frameCount` processed stereo samples.
   */
  public processBlock(outL: Float32Array, outR: Float32Array, frameCount: number): void {
    const bypass = this.isBypassActive();

    if (bypass) {
      if (!this.wasBypass) {
        // Returning from DSP mode to direct bypass: clear stale overlap buffers
        this.resetDspBuffers();
        this.wasBypass = true;
      }

      let idx = Math.floor(this.nominalPos);
      const nvL = this.noVocals.left;
      const nvR = this.noVocals.right;
      const vL = this.vocals.left;
      const vR = this.vocals.right;
      const nvLen = this.noVocals.length;
      const vLen = this.vocals.length;
      const vp = this.vocalPresence;

      for (let i = 0; i < frameCount; i++) {
        if (idx >= this.totalFrames) {
          outL[i] = 0;
          outR[i] = 0;
          this.ended = true;
        } else {
          const baseL = idx < nvLen ? nvL[idx] : 0;
          const baseR = idx < nvLen ? nvR[idx] : 0;
          const vocL = vp > 0 && idx < vLen ? vL[idx] : 0;
          const vocR = vp > 0 && idx < vLen ? vR[idx] : 0;
          outL[i] = Math.max(-1, Math.min(1, baseL + vp * vocL));
          outR[i] = Math.max(-1, Math.min(1, baseR + vp * vocR));
          idx++;
        }
      }

      this.nominalPos = Math.min(this.totalFrames, idx);
      if (this.nominalPos >= this.totalFrames) {
        this.ended = true;
      }
      return;
    }

    // Active DSP mode (transpose !== 0 or speed !== 1.0)
    if (this.wasBypass) {
      this.resetDspBuffers();
      this.wasBypass = false;
    }

    for (let i = 0; i < frameCount; i++) {
      if (this.readyCursor >= this.hopOut) {
        if (this.nominalPos >= this.totalFrames) {
          outL[i] = 0;
          outR[i] = 0;
          this.ended = true;
          continue;
        }
        this.synthesizeNextHop();
      }
      outL[i] = this.readyL[this.readyCursor];
      outR[i] = this.readyR[this.readyCursor];
      this.readyCursor++;
    }
  }
}
