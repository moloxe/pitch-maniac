import React from "react";
import { Play, Pause, FastForward, Rewind, FileText, Volume2 } from "lucide-react";

interface PlayerControlsProps {
  isPlaying: boolean;
  currentTime: number;
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

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  isPlaying,
  currentTime,
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
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-4 flex flex-col space-y-3 shadow-xl">
      {/* Draggable time seeker line */}
      <div className="flex items-center space-x-3 w-full">
        <span className="text-xs font-mono text-slate-400 w-10 text-right">
          {formatTime(currentTime)}
        </span>
        <div className="relative flex-1 group py-1 flex items-center">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none transition-all group-hover:h-2.5"
            style={{
              background: `linear-gradient(to right, #06b6d4 ${progressPercent}%, #334155 ${progressPercent}%)`,
            }}
          />
        </div>
        <span className="text-xs font-mono text-slate-400 w-10">
          {formatTime(duration)}
        </span>
      </div>

      {/* Main Controls Row */}
      <div className="flex items-center justify-between w-full pt-1">
        {/* Left: Playback Controls */}
        <div className="flex items-center space-x-2">
          {/* -5s Rewind */}
          <button
            onClick={() => onJumpBack(5)}
            className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center space-x-1 text-xs font-semibold"
            title="Rewind 5 seconds"
          >
            <Rewind className="w-4 h-4" />
            <span>5s</span>
          </button>

          {/* Play / Pause button */}
          <button
            onClick={onPlayPause}
            className="p-3.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/25 transition-transform active:scale-95"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>

          {/* +5s Forward */}
          <button
            onClick={() => onJumpForward(5)}
            className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center space-x-1 text-xs font-semibold"
            title="Forward 5 seconds"
          >
            <FastForward className="w-4 h-4" />
            <span>5s</span>
          </button>
        </div>

        {/* Center: Vocal Presence Slider */}
        <div className="flex items-center space-x-3 bg-slate-800/80 px-4 py-2 rounded-xl border border-slate-700/60 max-w-sm w-full mx-4">
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
          className={`px-3 py-2.5 rounded-lg border transition-all flex items-center space-x-2 text-xs font-semibold ${
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
