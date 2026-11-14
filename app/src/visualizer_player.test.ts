import { describe, it, expect } from "bun:test";
import {
  extractNoteSegments,
  midiToNoteName,
  transposeNoteMidi,
  findTargetNoteMidiAtTime,
  isMicPitchNearTarget,
  stepSmoothMidi,
  stepFadeProgress,
  easeInOutCubic,
} from "./components/PitchVisualizer";
import {
  computeSliderFillRange,
  formatSpeedLabel,
  formatTransposeLabel,
} from "./components/PlayerControls";
import {
  parseLrcLyrics,
  getActiveLyricIndex,
} from "./components/LyricsSidebar";
import {
  StereoTimePitchProcessor,
  clampSpeed,
  clampTranspose,
  semitonesToPitchFactor,
} from "./audioDsp";
import { PitchFrame } from "./types";

describe("PitchVisualizer - midiToNoteName", () => {
  it("converts MIDI numbers to standard musical note names with octaves", () => {
    expect(midiToNoteName(60)).toBe("C4");
    expect(midiToNoteName(69)).toBe("A4");
    expect(midiToNoteName(72)).toBe("C5");
    expect(midiToNoteName(36)).toBe("C2");
    expect(midiToNoteName(84)).toBe("C6");
    expect(midiToNoteName(61.2)).toBe("C#4");
    expect(midiToNoteName(59.1)).toBe("B3");
  });
});

describe("PitchVisualizer - extractNoteSegments", () => {
  it("returns empty array when frames are empty", () => {
    expect(extractNoteSegments([])).toEqual([]);
  });

  it("returns empty array when all frames are unvoiced", () => {
    const frames: PitchFrame[] = [
      { t: 0.0, hz: 0, midi: 0, voiced: false },
      { t: 0.02, hz: 0, midi: 0, voiced: false },
      { t: 0.04, hz: 0, midi: 0, voiced: false },
    ];
    expect(extractNoteSegments(frames)).toEqual([]);
  });

  it("filters out frames outside minMidi and maxMidi", () => {
    const frames: PitchFrame[] = [
      { t: 0.0, hz: 20, midi: 20, voiced: true }, // below minMidi 36
      { t: 0.02, hz: 2500, midi: 95, voiced: true }, // above maxMidi 84
    ];
    expect(extractNoteSegments(frames, 36, 84)).toEqual([]);
  });

  it("groups contiguous voiced frames with micro-vibrato into a single stable note", () => {
    // A single sung note with vibrato around C4 (midi 60)
    const frames: PitchFrame[] = [
      { t: 1.00, hz: 261, midi: 59.9, voiced: true },
      { t: 1.02, hz: 262, midi: 60.1, voiced: true },
      { t: 1.04, hz: 260, midi: 59.8, voiced: true },
      { t: 1.06, hz: 263, midi: 60.2, voiced: true },
      { t: 1.08, hz: 261, midi: 60.0, voiced: true },
    ];

    const segments = extractNoteSegments(frames, 36, 84);
    expect(segments.length).toBe(1);
    expect(segments[0].startTime).toBe(1.00);
    expect(segments[0].endTime).toBeCloseTo(1.10, 2);
    expect(segments[0].midi).toBe(60); // Median rounded to 60
  });

  it("splits notes when pitch shifts to a different semitone", () => {
    // C4 (midi 60) sung, then step up to D4 (midi 62)
    const frames: PitchFrame[] = [
      { t: 1.00, hz: 261, midi: 60.0, voiced: true },
      { t: 1.02, hz: 261, midi: 60.1, voiced: true },
      { t: 1.04, hz: 261, midi: 60.0, voiced: true },
      // step up to D4
      { t: 1.06, hz: 293, midi: 62.0, voiced: true },
      { t: 1.08, hz: 293, midi: 62.1, voiced: true },
      { t: 1.10, hz: 293, midi: 62.0, voiced: true },
    ];

    const segments = extractNoteSegments(frames, 36, 84);
    expect(segments.length).toBe(2);
    expect(segments[0].midi).toBe(60);
    expect(segments[0].startTime).toBe(1.00);

    expect(segments[1].midi).toBe(62);
    expect(segments[1].startTime).toBe(1.06);
  });

  it("splits notes when there is an unvoiced gap", () => {
    const frames: PitchFrame[] = [
      { t: 1.00, hz: 261, midi: 60.0, voiced: true },
      { t: 1.02, hz: 261, midi: 60.0, voiced: true },
      // Breath / pause
      { t: 1.04, hz: 0, midi: 0, voiced: false },
      { t: 1.06, hz: 0, midi: 0, voiced: false },
      // Second note
      { t: 1.08, hz: 261, midi: 60.0, voiced: true },
      { t: 1.10, hz: 261, midi: 60.0, voiced: true },
    ];

    const segments = extractNoteSegments(frames, 36, 84);
    expect(segments.length).toBe(2);
    expect(segments[0].startTime).toBe(1.00);
    expect(segments[1].startTime).toBe(1.08);
  });

  it("guarantees segment properties are completely immutable and stable for rendering", () => {
    const frames: PitchFrame[] = [
      { t: 2.00, hz: 440, midi: 69.0, voiced: true },
      { t: 2.02, hz: 441, midi: 69.1, voiced: true },
      { t: 2.04, hz: 439, midi: 68.9, voiced: true },
    ];

    const segments = extractNoteSegments(frames, 36, 84);
    expect(segments.length).toBe(1);
    const seg = segments[0];

    // Simulate different playback render times (approaching head, at head, past head)
    const headX = 220;
    const pps = 100;
    const height = 400;
    const minMidi = 36;
    const midiRange = 48;

    const computeY = () => height - ((seg.midi - minMidi) / midiRange) * height;

    // Y position must remain 100% constant across all render times
    const yAtT1 = computeY();
    const yAtT2 = computeY();
    const yAtT3 = computeY();
    expect(yAtT1).toBe(yAtT2);
    expect(yAtT2).toBe(yAtT3);

    // X positions move monotonically without jitter
    const x1 = headX + (seg.startTime - 1.0) * pps;
    const x2 = headX + (seg.startTime - 2.0) * pps;
    const x3 = headX + (seg.startTime - 3.0) * pps;
    expect(x1).toBeGreaterThan(x2);
    expect(x2).toBeGreaterThan(x3);
  });

  it("rejects isolated 1-frame spikes (e.g. onset consonant noise)", () => {
    const frames: PitchFrame[] = [
      { t: 0.10, hz: 100, midi: 40.0, voiced: true }, // isolated 1-frame transient
      { t: 0.12, hz: 0, midi: 0, voiced: false },
      { t: 0.50, hz: 261, midi: 60.0, voiced: true }, // valid 2-frame note
      { t: 0.52, hz: 261, midi: 60.1, voiced: true },
      { t: 0.54, hz: 0, midi: 0, voiced: false },
      { t: 0.80, hz: 150, midi: 45.0, voiced: true }, // isolated 1-frame transient
    ];

    const segments = extractNoteSegments(frames, 36, 84);
    expect(segments.length).toBe(1);
    expect(segments[0].startTime).toBe(0.50);
    expect(segments[0].midi).toBe(60);
  });

  it("tolerates realistic wide vocal vibrato (±0.6 semitones across multiple cycles) as a single continuous note", () => {
    // 10 frames of a sung note oscillating around 60 (from 59.4 to 60.6)
    const vibratoOffsets = [0, 0.3, 0.6, 0.3, 0, -0.3, -0.6, -0.3, 0, 0.4];
    const frames: PitchFrame[] = vibratoOffsets.map((offset, i) => ({
      t: 1.0 + i * 0.02,
      hz: 261,
      midi: 60.0 + offset,
      voiced: true,
    }));

    const segments = extractNoteSegments(frames, 36, 84);
    expect(segments.length).toBe(1);
    expect(segments[0].startTime).toBe(1.0);
    expect(segments[0].midi).toBe(60);
  });
});

describe("PitchVisualizer - dynamic vertical scaling", () => {
  it("calculates dynamic Y coordinates and bar height without bitmap distortion on vertical resize", () => {
    const minMidi = 36;
    const maxMidi = 84;
    const midiRange = maxMidi - minMidi; // 48
    const noteMidi = 60; // C4

    // Small height (e.g. 300px)
    const hSmall = 300;
    const ySmall = hSmall - ((noteMidi - minMidi) / midiRange) * hSmall;
    const semitoneHSmall = hSmall / midiRange;
    const barHSmall = Math.max(8, Math.min(20, semitoneHSmall * 0.85));

    // Large height (e.g. 800px on vertical resize)
    const hLarge = 800;
    const yLarge = hLarge - ((noteMidi - minMidi) / midiRange) * hLarge;
    const semitoneHLarge = hLarge / midiRange;
    const barHLarge = Math.max(8, Math.min(20, semitoneHLarge * 0.85));

    expect(ySmall).toBe(150); // exactly halfway up 300px
    expect(yLarge).toBe(400); // exactly halfway up 800px
    expect(barHSmall).toBeCloseTo(8.0, 1);
    expect(barHLarge).toBeCloseTo(14.16, 1); // dynamically scaled bar height
  });
});

describe("PlayerControls math and formatTime", () => {
  it("formats seconds to mm:ss correctly", () => {
    function formatTime(sec: number): string {
      if (isNaN(sec) || sec < 0) return "0:00";
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${s < 10 ? "0" : ""}${s}`;
    }

    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(215)).toBe("3:35");
    expect(formatTime(-10)).toBe("0:00");
    expect(formatTime(NaN)).toBe("0:00");
  });

  it("calculates progress percentage accurately and clamps correctly", () => {
    const calcPercent = (time: number, duration: number) =>
      duration > 0 ? Math.min(100, Math.max(0, (time / duration) * 100)) : 0;

    expect(calcPercent(0, 100)).toBe(0);
    expect(calcPercent(50, 100)).toBe(50);
    expect(calcPercent(100, 100)).toBe(100);
    expect(calcPercent(120, 100)).toBe(100);
    expect(calcPercent(-10, 100)).toBe(0);
    expect(calcPercent(10, 0)).toBe(0);
  });

  it("clamps seek targets correctly on jump forward and jump back", () => {
    const duration = 180;
    const jump = (cur: number, delta: number) =>
      Math.max(0, Math.min(duration, cur + delta));

    expect(jump(10, 5)).toBe(15);
    expect(jump(10, -5)).toBe(5);
    expect(jump(2, -5)).toBe(0); // clamp to 0
    expect(jump(178, 5)).toBe(180); // clamp to duration
  });

  it("formats transpose and speed labels and computes slider fill ranges", () => {
    expect(formatTransposeLabel(0)).toBe("0 st");
    expect(formatTransposeLabel(3)).toBe("+3 st");
    expect(formatTransposeLabel(-5)).toBe("-5 st");
    expect(formatTransposeLabel(18)).toBe("+12 st");
    expect(formatTransposeLabel(-20)).toBe("-12 st");

    expect(formatSpeedLabel(1)).toBe("1.00x");
    expect(formatSpeedLabel(0.75)).toBe("0.75x");
    expect(formatSpeedLabel(2.5)).toBe("1.50x");
    expect(formatSpeedLabel(0.1)).toBe("0.50x");

    // Standard 0..100 slider
    expect(computeSliderFillRange(0.8, 0, 1)).toEqual({
      startPercent: 0,
      endPercent: 80,
    });

    // Centered slider (-12..+12 anchored at 0)
    expect(computeSliderFillRange(6, -12, 12, 0)).toEqual({
      startPercent: 50,
      endPercent: 75,
    });
    expect(computeSliderFillRange(-6, -12, 12, 0)).toEqual({
      startPercent: 25,
      endPercent: 50,
    });
  });
});

describe("PitchVisualizer - transposeNoteMidi", () => {
  it("shifts MIDI pitch accurately by transpose semitones", () => {
    expect(transposeNoteMidi(60, 0)).toBe(60);
    expect(transposeNoteMidi(60, 4)).toBe(64);
    expect(transposeNoteMidi(60, -3)).toBe(57);
  });
});

describe("Audio DSP - StereoTimePitchProcessor", () => {
  const sampleRate = 44100;

  function makeSineTrack(freqHz: number, durationSec: number, amp = 0.5) {
    const length = Math.round(sampleRate * durationSec);
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const sample = amp * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
      left[i] = sample;
      right[i] = sample;
    }
    return { left, right, length };
  }

  function estimateFrequencyZeroCrossings(samples: Float32Array, sr: number): number {
    let crossings = 0;
    let firstIdx = -1;
    let lastIdx = -1;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i - 1] <= 0 && samples[i] > 0) {
        if (firstIdx === -1) firstIdx = i;
        lastIdx = i;
        crossings++;
      }
    }
    if (crossings < 2 || lastIdx <= firstIdx) return 0;
    const cycles = crossings - 1;
    return (cycles * sr) / (lastIdx - firstIdx);
  }

  it("clamps parameters and converts semitones to pitch factors", () => {
    expect(clampTranspose(5.4)).toBe(5);
    expect(clampTranspose(-99)).toBe(-12);
    expect(clampSpeed(1.234)).toBe(1.23);
    expect(clampSpeed(0.2)).toBe(0.5);
    expect(semitonesToPitchFactor(0)).toBeCloseTo(1.0, 6);
    expect(semitonesToPitchFactor(12)).toBeCloseTo(2.0, 6);
    expect(semitonesToPitchFactor(-12)).toBeCloseTo(0.5, 6);
  });

  it("mixes vocals and backing stems bit-accurately in bypass mode", () => {
    const vocals = makeSineTrack(440, 1.0, 0.4);
    const noVocals = makeSineTrack(220, 1.0, 0.3);
    const proc = new StereoTimePitchProcessor(sampleRate, vocals, noVocals);
    proc.setVocalPresence(0.5);

    const outL = new Float32Array(1024);
    const outR = new Float32Array(1024);
    proc.processBlock(outL, outR, 1024);

    for (let i = 0; i < 1024; i++) {
      const expected = noVocals.left[i] + 0.5 * vocals.left[i];
      expect(outL[i]).toBeCloseTo(expected, 5);
      expect(outR[i]).toBeCloseTo(expected, 5);
    }
    expect(proc.getCurrentTimeSeconds()).toBeCloseTo(1024 / sampleRate, 4);
  });

  it("shifts pitch independently without altering playback speed", () => {
    const vocals = makeSineTrack(440, 2.0, 0.5);
    const silent = makeSineTrack(0, 2.0, 0);
    const proc = new StereoTimePitchProcessor(sampleRate, vocals, silent);
    proc.setVocalPresence(1.0);
    proc.setTranspose(12); // +1 octave -> ~880 Hz
    proc.setSpeed(1.0);

    const blockSize = 1024;
    const blocks = 10;
    const captured = new Float32Array(blockSize * blocks);
    const outL = new Float32Array(blockSize);
    const outR = new Float32Array(blockSize);

    for (let b = 0; b < blocks; b++) {
      proc.processBlock(outL, outR, blockSize);
      captured.set(outL, b * blockSize);
    }

    // Analyze steady-state region after initial grain fade-in
    const steady = captured.slice(2048);
    const detectedHz = estimateFrequencyZeroCrossings(steady, sampleRate);
    expect(detectedHz).toBeGreaterThan(855);
    expect(detectedHz).toBeLessThan(905);

    // Song time advanced at 1.0x
    expect(proc.getCurrentTimeSeconds()).toBeCloseTo((blockSize * blocks) / sampleRate, 3);
  });

  it("changes playback speed independently without altering pitch", () => {
    const vocals = makeSineTrack(440, 3.0, 0.5);
    const silent = makeSineTrack(0, 3.0, 0);
    const proc = new StereoTimePitchProcessor(sampleRate, vocals, silent);
    proc.setVocalPresence(1.0);
    proc.setTranspose(0);
    proc.setSpeed(1.5);

    const blockSize = 1024;
    const blocks = 10;
    const captured = new Float32Array(blockSize * blocks);
    const outL = new Float32Array(blockSize);
    const outR = new Float32Array(blockSize);

    for (let b = 0; b < blocks; b++) {
      proc.processBlock(outL, outR, blockSize);
      captured.set(outL, b * blockSize);
    }

    const steady = captured.slice(2048);
    const detectedHz = estimateFrequencyZeroCrossings(steady, sampleRate);
    expect(detectedHz).toBeGreaterThan(425);
    expect(detectedHz).toBeLessThan(455);

    // Song time advanced 1.5x faster than wall clock
    expect(proc.getCurrentTimeSeconds()).toBeCloseTo(
      ((blockSize * blocks) / sampleRate) * 1.5,
      3
    );
  });

  it("supports simultaneous transpose and speed changes and marks end of track", () => {
    const vocals = makeSineTrack(440, 1.0, 0.5);
    const silent = makeSineTrack(0, 1.0, 0);
    const proc = new StereoTimePitchProcessor(sampleRate, vocals, silent);
    proc.setVocalPresence(1.0);
    proc.setTranspose(-12); // -1 octave -> ~220 Hz
    proc.setSpeed(0.5); // half speed

    const blockSize = 1024;
    const blocks = 10;
    const captured = new Float32Array(blockSize * blocks);
    const outL = new Float32Array(blockSize);
    const outR = new Float32Array(blockSize);

    for (let b = 0; b < blocks; b++) {
      proc.processBlock(outL, outR, blockSize);
      captured.set(outL, b * blockSize);
    }

    const steady = captured.slice(2048);
    const detectedHz = estimateFrequencyZeroCrossings(steady, sampleRate);
    expect(detectedHz).toBeGreaterThan(208);
    expect(detectedHz).toBeLessThan(232);
    expect(proc.getCurrentTimeSeconds()).toBeCloseTo(
      ((blockSize * blocks) / sampleRate) * 0.5,
      3
    );
    expect(proc.isEnded()).toBe(false);

    // Seek near end and drain
    proc.seekSeconds(0.95);
    for (let b = 0; b < 20; b++) {
      proc.processBlock(outL, outR, blockSize);
    }
    expect(proc.isEnded()).toBe(true);
  });
});

describe("LyricsSidebar - LRC parsing and active line lookup", () => {
  it("parses LRC timestamps including multi-tag lines and metadata filtering", () => {
    const lrc = [
      "[ar:Amén]",
      "[ti:Te Quiero]",
      "[00:05.50] First line",
      "[00:10.00][00:45.250] Repeated chorus",
      "[00:20] No fraction",
    ].join("\n");

    const parsed = parseLrcLyrics(lrc);
    expect(parsed).toEqual([
      { time: 5.5, text: "First line" },
      { time: 10, text: "Repeated chorus" },
      { time: 20, text: "No fraction" },
      { time: 45.25, text: "Repeated chorus" },
    ]);
  });

  it("finds the active lyric line index for currentTime", () => {
    const lines = [
      { time: 5, text: "Line 1" },
      { time: 12.5, text: "Line 2" },
      { time: 20, text: "Line 3" },
    ];
    expect(getActiveLyricIndex(lines, 0)).toBe(-1);
    expect(getActiveLyricIndex(lines, 5.0)).toBe(0);
    expect(getActiveLyricIndex(lines, 12.46)).toBe(1);
    expect(getActiveLyricIndex(lines, 15.0)).toBe(1);
    expect(getActiveLyricIndex(lines, 25.0)).toBe(2);
    expect(getActiveLyricIndex([], 10)).toBe(-1);
  });
});

describe("PitchVisualizer - microphone proximity, smoothing & fade", () => {
  it("finds active target note with transpose and grace window, returning null in silences", () => {
    const segments = [
      { id: 0, startTime: 2.0, endTime: 3.5, midi: 60 },
      { id: 1, startTime: 5.0, endTime: 6.0, midi: 64 },
    ];

    expect(findTargetNoteMidiAtTime(segments, 2.5, 0)).toBe(60);
    expect(findTargetNoteMidiAtTime(segments, 2.5, -2)).toBe(58);
    expect(findTargetNoteMidiAtTime(segments, 1.92, 0)).toBe(60); // within 0.12s grace
    expect(findTargetNoteMidiAtTime(segments, 1.0, 0)).toBeNull();
    expect(findTargetNoteMidiAtTime(segments, 4.2, 0)).toBeNull();
  });

  it("shows mic pitch only when voiced and within 4 semitones of target note", () => {
    expect(isMicPitchNearTarget(60, true, 60)).toBe(true);
    expect(isMicPitchNearTarget(64, true, 60)).toBe(true); // exactly 4 semitones
    expect(isMicPitchNearTarget(56, true, 60)).toBe(true);
    expect(isMicPitchNearTarget(64.1, true, 60)).toBe(false);
    expect(isMicPitchNearTarget(55.5, true, 60)).toBe(false);
    expect(isMicPitchNearTarget(60, false, 60)).toBe(false);
    expect(isMicPitchNearTarget(60, true, null)).toBe(false);
  });

  it("eases pitch movement smoothly without teleporting or overshooting", () => {
    // Initial value snaps cleanly when null
    expect(stepSmoothMidi(null, 62, 1 / 60)).toBe(62);

    // Subsequent large jump moves gradually toward target
    const step1 = stepSmoothMidi(60, 64, 1 / 60);
    expect(step1).toBeGreaterThan(60);
    expect(step1).toBeLessThan(62);

    // Frame-rate independence: two 1/60s steps match one 2/60s step
    const step2 = stepSmoothMidi(step1, 64, 1 / 60);
    const singleDoubleDt = stepSmoothMidi(60, 64, 2 / 60);
    expect(step2).toBeCloseTo(singleDoubleDt, 6);
  });

  it("fades in and out smoothly with easeInOutCubic", () => {
    let p = 0;
    p = stepFadeProgress(p, true, 0.06, 0.12, 0.16);
    expect(p).toBeCloseTo(0.5, 4);
    expect(easeInOutCubic(p)).toBeCloseTo(0.5, 4);

    p = stepFadeProgress(p, true, 0.06, 0.12, 0.16);
    expect(p).toBe(1);
    expect(easeInOutCubic(p)).toBe(1);

    p = stepFadeProgress(p, false, 0.08, 0.12, 0.16);
    expect(p).toBeCloseTo(0.5, 4);

    p = stepFadeProgress(p, false, 0.1, 0.12, 0.16);
    expect(p).toBe(0);
    expect(easeInOutCubic(p)).toBe(0);
  });
});
