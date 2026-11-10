import React, { useEffect, useRef } from "react";
import { PitchFrame } from "../types";

interface PitchVisualizerProps {
  frames: PitchFrame[];
  currentTime: number;
  micMidi: number | null;
  micVoiced: boolean;
  minMidi?: number;
  maxMidi?: number;
  timeWindowSeconds?: number; // width in seconds shown ahead
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[rounded % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave}`;
}

export const PitchVisualizer: React.FC<PitchVisualizerProps> = ({
  frames,
  currentTime,
  micMidi,
  micVoiced,
  minMidi = 36, // C2
  maxMidi = 84, // C6
  timeWindowSeconds = 5.0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      // Clear background
      ctx.fillStyle = "#090d16";
      ctx.fillRect(0, 0, width, height);

      // Playback head X coordinate (fixed target line at 25% from left)
      const headX = width * 0.22;
      const pixelsPerSecond = (width - headX) / timeWindowSeconds;

      // Draw grid lines for MIDI notes
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

          // Note label
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
      // A note bar is formed by contiguous voiced frames
      const visibleMinTime = currentTime - 1.5;
      const visibleMaxTime = currentTime + timeWindowSeconds;

      ctx.fillStyle = "#06b6d4";
      ctx.shadowBlur = 10;
      ctx.shadowColor = "rgba(6, 182, 212, 0.6)";

      // Draw pitch segments as rounded pill bars
      let segmentStart: PitchFrame | null = null;
      let lastFrame: PitchFrame | null = null;

      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (f.t < visibleMinTime) continue;
        if (f.t > visibleMaxTime && !segmentStart) break;

        if (f.voiced && f.midi >= minMidi && f.midi <= maxMidi) {
          if (!segmentStart) {
            segmentStart = f;
          }
          lastFrame = f;
        } else {
          if (segmentStart && lastFrame) {
            // Draw segment
            drawNoteBar(ctx, segmentStart, lastFrame, currentTime, headX, pixelsPerSecond, height, minMidi, midiRange);
            segmentStart = null;
            lastFrame = null;
          }
        }
      }
      if (segmentStart && lastFrame) {
        drawNoteBar(ctx, segmentStart, lastFrame, currentTime, headX, pixelsPerSecond, height, minMidi, midiRange);
      }
      ctx.shadowBlur = 0;

      // Draw singer's real-time microphone pitch dot / indicator at headX
      if (micVoiced && micMidi && micMidi >= minMidi && micMidi <= maxMidi) {
        const micY = height - ((micMidi - minMidi) / midiRange) * height;

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
        ctx.fillText(midiToNoteName(micMidi), headX + 14, micY + 4);
      }

      animId = requestAnimationFrame(render);
    };

    const drawNoteBar = (
      context: CanvasRenderingContext2D,
      startF: PitchFrame,
      endF: PitchFrame,
      curTime: number,
      hx: number,
      pps: number,
      h: number,
      minM: number,
      rangeM: number
    ) => {
      const startX = hx + (startF.t - curTime) * pps;
      const endX = hx + (Math.max(endF.t, startF.t + 0.05) - curTime) * pps;
      const barW = Math.max(6, endX - startX);

      const avgMidi = (startF.midi + endF.midi) / 2;
      const y = h - ((avgMidi - minM) / rangeM) * h;
      const barH = 10;

      context.beginPath();
      context.roundRect(startX, y - barH / 2, barW, barH, 4);
      context.fill();
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [frames, currentTime, micMidi, micVoiced, minMidi, maxMidi, timeWindowSeconds]);

  return (
    <div className="relative w-full h-full bg-[#090d16] rounded-xl overflow-hidden border border-slate-800 shadow-inner flex flex-col">
      <div className="absolute top-3 left-4 z-10 flex items-center space-x-3 text-xs bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/60 shadow">
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
        width={1000}
        height={320}
        className="w-full h-full block"
      />
    </div>
  );
};
