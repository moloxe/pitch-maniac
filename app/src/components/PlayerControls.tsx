import React, { useEffect, useRef, useState } from "react";
import { Play, Pause, FastForward, Rewind, FileText, Volume2 } from "lucide-react";

export interface PlayerControlsProps {
  isPlaying: boolean;
  currentTime?: number;
  getCurrentTime?: () => number;
  duration: number;
  vocalPresence: number; // 0 to 1
  lyricsOpen: boolean;
  onPlayPause: () => void;
  onSeek: (seconds: number) => void;
  onJumpBack: (seconds: number) => void;
  onJumpForward: (seconds: number) => void;
  onVocalPresenceChange: (value: number) => void;
  onToggleLyrics: () => void;
}

export function formatTime(sec: number): string {
  if (isNaN(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
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
        {/* Background track: centered vertically inside h-5; hover thickness changes inside h-5 without layout shift */}
        <div className="w-full h-1.5 rounded-full bg-slate-700/80 overflow-hidden group-hover:h-2 transition-all">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 pointer-events-none"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {/* Scrubber thumb: perfectly centered vertically and horizontally, scale on hover avoids layout shift */}
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

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  isPlaying,
  currentTime = 0,
  getCurrentTime,
  duration,
  vocalPresence,
  lyricsOpen,
  onPlayPause,
  onSeek,
  onJumpBack,
  onJumpForward,
  onVocalPresenceChange,
  onToggleLyrics,
}) => {
  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-4 flex flex-col space-y-3 shadow-xl shrink-0 box-border">
      {/* Draggable time seeker line with fixed height to prevent layout shift */}
      <SeekBar
        duration={duration}
        currentTime={currentTime}
        getCurrentTime={getCurrentTime}
        isPlaying={isPlaying}
        onSeek={onSeek}
        onJumpBack={onJumpBack}
        onJumpForward={onJumpForward}
      />

      {/* Main Controls Row with fixed height to prevent layout shift */}
      <div className="flex items-center justify-between w-full h-12 shrink-0 pt-1">
        {/* Left: Playback Controls */}
        <div className="flex items-center space-x-2 shrink-0">
          {/* -5s Rewind */}
          <button
            onClick={() => onJumpBack(5)}
            className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center space-x-1 text-xs font-semibold shrink-0"
            title="Rewind 5 seconds"
          >
            <Rewind className="w-4 h-4" />
            <span>5s</span>
          </button>

          {/* Play / Pause button */}
          <button
            onClick={onPlayPause}
            className="p-3.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/25 transition-transform active:scale-95 shrink-0"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>

          {/* +5s Forward */}
          <button
            onClick={() => onJumpForward(5)}
            className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center space-x-1 text-xs font-semibold shrink-0"
            title="Forward 5 seconds"
          >
            <FastForward className="w-4 h-4" />
            <span>5s</span>
          </button>
        </div>

        {/* Center: Vocal Presence Slider */}
        <div className="flex items-center space-x-3 bg-slate-800/80 px-4 py-2 rounded-xl border border-slate-700/60 max-w-sm w-full mx-4 shrink-0">
          <Volume2 className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="flex flex-col flex-1">
            <div className="flex justify-between items-center text-[11px] mb-1">
              <span className="text-slate-300 font-medium">Vocal Presence</span>
              <span className="font-mono text-cyan-400 font-bold">
                {Math.round(vocalPresence * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={vocalPresence}
              onChange={(e) => onVocalPresenceChange(parseFloat(e.target.value))}
              className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
            />
            <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
              <span>Karaoke (0%)</span>
              <span>Original (100%)</span>
            </div>
          </div>
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
