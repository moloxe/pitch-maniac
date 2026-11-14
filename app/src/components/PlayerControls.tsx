import React, { useEffect, useId, useRef, useState } from "react";
import {
  Play,
  Pause,
  FastForward,
  Rewind,
  FileText,
  Volume2,
  Music2,
  Gauge,
  Minus,
  Plus,
} from "lucide-react";
import { clampSpeed, clampTranspose } from "../audioDsp";

export interface PlayerControlsProps {
  isPlaying: boolean;
  currentTime?: number;
  getCurrentTime?: () => number;
  duration: number;
  vocalPresence: number; // 0 to 1
  transpose: number; // -12 to +12 semitones
  speed: number; // 0.50 to 1.50
  lyricsOpen: boolean;
  onPlayPause: () => void;
  onSeek: (seconds: number) => void;
  onJumpBack: (seconds: number) => void;
  onJumpForward: (seconds: number) => void;
  onVocalPresenceChange: (value: number) => void;
  onTransposeChange: (semitones: number) => void;
  onSpeedChange: (speed: number) => void;
  onToggleLyrics: () => void;
}

export function formatTime(sec: number): string {
  if (isNaN(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function formatTransposeLabel(semitones: number): string {
  const rounded = clampTranspose(semitones);
  if (rounded > 0) return `+${rounded} st`;
  if (rounded < 0) return `${rounded} st`;
  return "0 st";
}

export function formatSpeedLabel(speed: number): string {
  return `${clampSpeed(speed).toFixed(2)}x`;
}

export function computeSliderFillRange(
  value: number,
  min: number,
  max: number,
  anchorValue?: number
): { startPercent: number; endPercent: number } {
  const span = max - min;
  if (span <= 0) return { startPercent: 0, endPercent: 0 };
  const clampPct = (v: number) =>
    Math.min(100, Math.max(0, ((v - min) / span) * 100));

  const valPct = clampPct(value);
  if (anchorValue === undefined) {
    return { startPercent: 0, endPercent: valPct };
  }
  const anchorPct = clampPct(anchorValue);
  return {
    startPercent: Math.min(anchorPct, valPct),
    endPercent: Math.max(anchorPct, valPct),
  };
}

interface SeekBarProps {
  duration: number;
  currentTime?: number;
  getCurrentTime?: () => number;
  isPlaying: boolean;
  onSeek: (seconds: number) => void;
  onJumpBack: (seconds: number) => void;
  onJumpForward: (seconds: number) => void;
}

export const SeekBar: React.FC<SeekBarProps> = ({
  duration,
  currentTime = 0,
  getCurrentTime,
  isPlaying,
  onSeek,
  onJumpBack,
  onJumpForward,
}) => {
  const barRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);

  // Dedicated continuous requestAnimationFrame loop during playback to update progress smoothly
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    const loop = () => {
      setTick((n) => (n + 1) % 1000);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);

  const liveTime = getCurrentTime ? getCurrentTime() : currentTime;
  const displayTime = isDragging ? dragTime : liveTime;
  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (displayTime / duration) * 100)) : 0;

  const calculateTargetFromEvent = (clientX: number): number => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return 0;
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return frac * duration;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    const target = calculateTargetFromEvent(e.clientX);
    setDragTime(target);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      const target = calculateTargetFromEvent(e.clientX);
      setDragTime(target);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      const target = calculateTargetFromEvent(e.clientX);
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onSeek(target);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div className="flex items-center space-x-3 w-full h-5 shrink-0 select-none">
      <span className="text-xs font-mono text-slate-400 w-10 text-right tabular-nums select-none shrink-0">
        {formatTime(displayTime)}
      </span>
      <div
        ref={barRef}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={displayTime}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onJumpBack(5);
          if (e.key === "ArrowRight") onJumpForward(5);
        }}
        className="relative flex-1 h-5 flex items-center cursor-pointer group select-none focus:outline-none"
      >
        <div className="w-full h-1.5 rounded-full bg-slate-700/80 overflow-hidden group-hover:h-2 transition-all">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 pointer-events-none"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div
          className="absolute w-3.5 h-3.5 rounded-full bg-white shadow-md shadow-cyan-500/50 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-transform group-hover:scale-125 pointer-events-none"
          style={{ left: `${progressPercent}%` }}
        />
      </div>
      <span className="text-xs font-mono text-slate-400 w-10 tabular-nums select-none shrink-0">
        {formatTime(duration)}
      </span>
    </div>
  );
};

interface RackSliderRowProps {
  label: string;
  icon: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  anchorValue?: number;
  accentColor: string;
  isModified: boolean;
  valueText: string;
  ariaValueText: string;
  onChange: (value: number) => void;
  onReset: () => void;
  onStepDown?: () => void;
  onStepUp?: () => void;
  resetTitle: string;
}

const RackSliderRow: React.FC<RackSliderRowProps> = ({
  label,
  icon,
  value,
  min,
  max,
  step,
  anchorValue,
  accentColor,
  isModified,
  valueText,
  ariaValueText,
  onChange,
  onReset,
  onStepDown,
  onStepUp,
  resetTitle,
}) => {
  const inputId = useId();
  const { startPercent, endPercent } = computeSliderFillRange(
    value,
    min,
    max,
    anchorValue
  );

  const sliderStyle = {
    "--slider-fill-color": accentColor,
    "--slider-fill-start": `${startPercent}%`,
    "--slider-fill-end": `${endPercent}%`,
  } as React.CSSProperties;

  return (
    <div className="grid grid-cols-[84px_1fr_104px] items-center gap-2.5 h-5">
      {/* Left: Icon + Label */}
      <label
        htmlFor={inputId}
        className="flex items-center space-x-1.5 text-[11px] font-medium text-slate-300 cursor-pointer select-none truncate"
      >
        <span className="shrink-0" style={{ color: accentColor }}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </label>

      {/* Center: Native accessible range slider with optional center detent */}
      <div className="relative flex items-center">
        {anchorValue !== undefined && (
          <span
            aria-hidden="true"
            className="absolute left-1/2 -translate-x-1/2 w-0.5 h-2.5 bg-slate-500/70 rounded-full pointer-events-none"
          />
        )}
        <input
          id={inputId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={ariaValueText}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onDoubleClick={onReset}
          style={sliderStyle}
          className="studio-slider relative z-10"
          title={`${label}: ${ariaValueText} (double-click to reset)`}
        />
      </div>

      {/* Right: Optional stepper buttons + interactive value/reset badge */}
      <div className="flex items-center justify-end space-x-1">
        {onStepDown && (
          <button
            type="button"
            onClick={onStepDown}
            disabled={value <= min}
            aria-label={`Decrease ${label}`}
            className="w-4 h-4 rounded bg-slate-700/70 hover:bg-slate-600 text-slate-300 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors"
          >
            <Minus className="w-2.5 h-2.5" />
          </button>
        )}

        <button
          type="button"
          onClick={onReset}
          title={resetTitle}
          className={`min-w-[54px] px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tabular-nums text-center transition-colors ${
            isModified
              ? "bg-slate-700/90 text-white border border-slate-500/60 hover:bg-slate-600"
              : "text-slate-300 hover:bg-slate-700/60"
          }`}
          style={isModified ? { color: accentColor } : undefined}
        >
          {valueText}
        </button>

        {onStepUp && (
          <button
            type="button"
            onClick={onStepUp}
            disabled={value >= max}
            aria-label={`Increase ${label}`}
            className="w-4 h-4 rounded bg-slate-700/70 hover:bg-slate-600 text-slate-300 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors"
          >
            <Plus className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
    </div>
  );
};

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  isPlaying,
  currentTime = 0,
  getCurrentTime,
  duration,
  vocalPresence,
  transpose,
  speed,
  lyricsOpen,
  onPlayPause,
  onSeek,
  onJumpBack,
  onJumpForward,
  onVocalPresenceChange,
  onTransposeChange,
  onSpeedChange,
  onToggleLyrics,
}) => {
  const vocalPercent = Math.round(vocalPresence * 100);

  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl px-4 py-3 flex flex-col space-y-2.5 shadow-xl shrink-0 box-border">
      {/* Draggable time seeker line */}
      <SeekBar
        duration={duration}
        currentTime={currentTime}
        getCurrentTime={getCurrentTime}
        isPlaying={isPlaying}
        onSeek={onSeek}
        onJumpBack={onJumpBack}
        onJumpForward={onJumpForward}
      />

      {/* Main Controls Row */}
      <div className="flex items-center justify-between w-full shrink-0 gap-3">
        {/* Left: Playback Transport Controls */}
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => onJumpBack(5)}
            className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center space-x-1 text-xs font-semibold shrink-0"
            title="Rewind 5 seconds"
          >
            <Rewind className="w-4 h-4" />
            <span>5s</span>
          </button>

          <button
            onClick={onPlayPause}
            className="p-3.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/25 transition-transform active:scale-95 shrink-0"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>

          <button
            onClick={() => onJumpForward(5)}
            className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center space-x-1 text-xs font-semibold shrink-0"
            title="Forward 5 seconds"
          >
            <FastForward className="w-4 h-4" />
            <span>5s</span>
          </button>
        </div>

        {/* Center: Compact 3-Row Studio Rack (Vocals, Transpose, Speed) */}
        <div className="flex-1 max-w-md bg-slate-800/75 px-3.5 py-2 rounded-xl border border-slate-700/60 flex flex-col gap-1 min-w-0">
          <RackSliderRow
            label="Vocals"
            icon={<Volume2 className="w-3.5 h-3.5" />}
            value={vocalPresence}
            min={0}
            max={1}
            step={0.01}
            accentColor="#22d3ee"
            isModified={vocalPercent === 0}
            valueText={`${vocalPercent}%`}
            ariaValueText={`${vocalPercent}% vocal presence`}
            onChange={onVocalPresenceChange}
            onReset={() => onVocalPresenceChange(vocalPercent === 0 ? 0.8 : 0)}
            resetTitle={
              vocalPercent === 0
                ? "Click to restore vocals (80%)"
                : "Click for Karaoke mode (0% vocals)"
            }
          />

          <RackSliderRow
            label="Transpose"
            icon={<Music2 className="w-3.5 h-3.5" />}
            value={transpose}
            min={-12}
            max={12}
            step={1}
            anchorValue={0}
            accentColor={transpose !== 0 ? "#a78bfa" : "#94a3b8"}
            isModified={transpose !== 0}
            valueText={formatTransposeLabel(transpose)}
            ariaValueText={`${transpose} semitones`}
            onChange={(val) => onTransposeChange(clampTranspose(val))}
            onReset={() => onTransposeChange(0)}
            onStepDown={() => onTransposeChange(clampTranspose(transpose - 1))}
            onStepUp={() => onTransposeChange(clampTranspose(transpose + 1))}
            resetTitle="Click to reset transpose to 0 st"
          />

          <RackSliderRow
            label="Speed"
            icon={<Gauge className="w-3.5 h-3.5" />}
            value={speed}
            min={0.5}
            max={1.5}
            step={0.05}
            anchorValue={1.0}
            accentColor={Math.abs(speed - 1.0) > 1e-4 ? "#fbbf24" : "#94a3b8"}
            isModified={Math.abs(speed - 1.0) > 1e-4}
            valueText={formatSpeedLabel(speed)}
            ariaValueText={`${speed.toFixed(2)}x playback speed`}
            onChange={(val) => onSpeedChange(clampSpeed(val))}
            onReset={() => onSpeedChange(1.0)}
            onStepDown={() => onSpeedChange(clampSpeed(speed - 0.05))}
            onStepUp={() => onSpeedChange(clampSpeed(speed + 0.05))}
            resetTitle="Click to reset speed to 1.00x"
          />
        </div>

        {/* Right: Lyrics toggle */}
        <button
          onClick={onToggleLyrics}
          className={`px-3 py-2.5 rounded-lg border transition-all flex items-center space-x-2 text-xs font-semibold shrink-0 ${
            lyricsOpen
              ? "bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-sm shadow-cyan-500/20"
              : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
          }`}
          title="Toggle Lyrics Sidebar"
        >
          <FileText className="w-4 h-4" />
          <span>Lyrics</span>
        </button>
      </div>
    </div>
  );
};
