import React, { useEffect, useRef, useMemo } from "react";
import { PitchFrame } from "../types";

export interface NoteSegment {
  id: number;
  startTime: number;
  endTime: number;
  midi: number;
}

export function extractNoteSegments(
  frames: PitchFrame[],
  minMidi = 36,
  maxMidi = 84
): NoteSegment[] {
  if (!frames || frames.length === 0) return [];

  const rawClusters: PitchFrame[][] = [];
  let current: PitchFrame[] = [];

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f.voiced || f.midi < minMidi || f.midi > maxMidi) {
      if (current.length > 0) {
        rawClusters.push(current);
        current = [];
      }
      continue;
    }

    if (current.length === 0) {
      current.push(f);
    } else {
      const prev = current[current.length - 1];
      const timeDiff = f.t - prev.t;
      // Compare against the moving average of the last few frames to accommodate natural vibrato
      const windowFrames = current.slice(-4);
      const runningMidi =
        windowFrames.reduce((sum, x) => sum + x.midi, 0) / windowFrames.length;
      const pitchDiff = Math.abs(f.midi - runningMidi);

      // Split if time gap exceeds 70ms or distinct pitch step >= 1.1 semitones
      if (timeDiff > 0.07 || pitchDiff >= 1.1) {
        rawClusters.push(current);
        current = [f];
      } else {
        current.push(f);
      }
    }
  }
  if (current.length > 0) rawClusters.push(current);

  // Convert clusters into note segments, filtering out isolated 1-frame spikes
  const segments: NoteSegment[] = [];
  let noteId = 0;

  for (const cluster of rawClusters) {
    if (cluster.length < 2) continue;

    const midis = cluster.map((c) => c.midi).sort((a, b) => a - b);
    const medianMidi = Math.round(midis[Math.floor(midis.length / 2)]);

    if (medianMidi >= minMidi && medianMidi <= maxMidi) {
      const startTime = cluster[0].t;
      const lastT = cluster[cluster.length - 1].t;
      segments.push({
        id: noteId++,
        startTime,
        endTime: Math.max(startTime + 0.05, lastT + 0.02),
        midi: medianMidi,
      });
    }
  }

  return segments;
}

export interface PitchVisualizerProps {
  frames: PitchFrame[];
  currentTime?: number;
  getCurrentTime?: () => number;
  micMidi: number | null;
  micVoiced: boolean;
  minMidi?: number;
  maxMidi?: number;
  timeWindowSeconds?: number; // width in seconds shown ahead
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave}`;
}

export const PitchVisualizer: React.FC<PitchVisualizerProps> = ({
  frames,
  currentTime = 0,
  getCurrentTime,
  micMidi,
  micVoiced,
  minMidi = 36, // C2
  maxMidi = 84, // C6
  timeWindowSeconds = 5.0,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Stable precomputed note segments from pitch frames
  const noteSegments = useMemo(() => {
    return extractNoteSegments(frames, minMidi, maxMidi);
  }, [frames, minMidi, maxMidi]);

  // Keep live references for continuous 60fps render loop
  const timeRef = useRef<() => number>(() => currentTime);
  timeRef.current = getCurrentTime || (() => currentTime);

  const micRef = useRef({ midi: micMidi, voiced: micVoiced });
  micRef.current = { midi: micMidi, voiced: micVoiced };

  const segmentsRef = useRef(noteSegments);
  segmentsRef.current = noteSegments;

  // Cached dimensions ref to avoid per-frame getBoundingClientRect() layout thrashing
  const sizeRef = useRef<{ width: number; height: number; dpr: number }>({
    width: 0,
    height: 0,
    dpr: 1,
  });

  // Track container resize responsively and update canvas buffer dimensions
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const updateDimensions = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const displayW = Math.max(1, Math.floor(rect.width));
      const displayH = Math.max(1, Math.floor(rect.height));
      const targetW = Math.round(displayW * dpr);
      const targetH = Math.round(displayH * dpr);

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      sizeRef.current = { width: displayW, height: displayH, dpr };
    };

    updateDimensions();

    const observer = new ResizeObserver(() => {
      updateDimensions();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animId: number;

    const render = () => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { width, height, dpr } = sizeRef.current;
      if (width <= 0 || height <= 0) {
        animId = requestAnimationFrame(render);
        return;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Clear background
      ctx.fillStyle = "#090d16";
      ctx.fillRect(0, 0, width, height);

      // Playback head X coordinate (fixed target line at 22% from left)
      const headX = width * 0.22;
      const pixelsPerSecond = (width - headX) / timeWindowSeconds;

      // Draw grid lines for MIDI notes adapting dynamically to actual height
      ctx.lineWidth = 1;
      const midiRange = maxMidi - minMidi;

      for (let m = minMidi; m <= maxMidi; m++) {
        const isOctaveC = m % 12 === 0;
        const isSemi = [1, 3, 6, 8, 10].includes(m % 12);
        const y = height - ((m - minMidi) / midiRange) * height;

        if (isOctaveC) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();

          // Note label: constant crisp font size
          ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
          ctx.font = "10px sans-serif";
          ctx.fillText(midiToNoteName(m), 6, y - 3);
        } else if (!isSemi) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
      }

      // Draw vertical target line (playback head)
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(headX, 0);
      ctx.lineTo(headX, height);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw target note bars from pitch curve moving Right to Left
      const curTime = timeRef.current();
      // Calculate visible time window with extra margin on left so notes exiting don't disappear early
      const leftTimeSpan = headX / pixelsPerSecond;
      const visibleMinTime = curTime - leftTimeSpan - 0.5;
      const visibleMaxTime = curTime + timeWindowSeconds + 0.5;

      const segments = segmentsRef.current;
      const semitoneHeight = height / midiRange;
      const barH = Math.max(8, Math.min(20, semitoneHeight * 0.85));

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.endTime < visibleMinTime) continue;
        if (seg.startTime > visibleMaxTime) break;

        const startX = headX + (seg.startTime - curTime) * pixelsPerSecond;
        const endX = headX + (seg.endTime - curTime) * pixelsPerSecond;
        const barW = Math.max(6, endX - startX);

        const y = height - ((seg.midi - minMidi) / midiRange) * height;

        const isPast = endX < headX;
        const isActive = startX <= headX && endX >= headX;

        if (isActive) {
          ctx.fillStyle = "#22d3ee";
          ctx.shadowColor = "rgba(34, 211, 238, 0.8)";
          ctx.shadowBlur = 12;
        } else if (isPast) {
          ctx.fillStyle = "rgba(6, 182, 212, 0.65)";
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = "#06b6d4";
          ctx.shadowColor = "rgba(6, 182, 212, 0.5)";
          ctx.shadowBlur = 8;
        }

        ctx.beginPath();
        ctx.roundRect(startX, y - barH / 2, barW, barH, 4);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Draw singer's real-time microphone pitch dot / indicator at headX
      const { midi: micM, voiced: micV } = micRef.current;
      if (micV && micM !== null && micM >= minMidi && micM <= maxMidi) {
        const micY = height - ((micM - minMidi) / midiRange) * height;

        // Glow ring
        ctx.fillStyle = "#ec4899";
        ctx.shadowColor = "#f43f5e";
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(headX, micY, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(headX, micY, 4, 0, Math.PI * 2);
        ctx.fill();

        // Note label next to singer's pitch
        ctx.fillStyle = "#fb7185";
        ctx.font = "bold 11px sans-serif";
        ctx.fillText(midiToNoteName(micM), headX + 14, micY + 4);
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [minMidi, maxMidi, timeWindowSeconds]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[#090d16] rounded-xl overflow-hidden border border-slate-800 shadow-inner flex flex-col"
    >
      <div className="absolute top-3 left-4 z-10 flex items-center space-x-3 text-xs bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/60 shadow pointer-events-none">
        <span className="flex items-center space-x-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
          <span className="text-slate-300 font-medium">Song Pitch</span>
        </span>
        <span className="text-slate-600">|</span>
        <span className="flex items-center space-x-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-pink-500 animate-pulse"></span>
          <span className="text-slate-300 font-medium">Your Voice (Mic)</span>
        </span>
      </div>

      <canvas
        ref={canvasRef}
        className="w-full h-full block"
      />
    </div>
  );
};
