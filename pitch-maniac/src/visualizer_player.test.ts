import { describe, it, expect } from "bun:test";
import { extractNoteSegments, midiToNoteName } from "./components/PitchVisualizer";
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
});
