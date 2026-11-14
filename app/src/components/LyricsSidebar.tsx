import React, { useState, useEffect, useMemo, useRef } from "react";
import { X, Save, Check, Sparkles, Loader2, Edit3, AlignLeft } from "lucide-react";
import { ResizeHandle } from "./ResizeHandle";
import {
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
} from "../sidebarResize";

export interface SyncedLyricLine {
  time: number;
  text: string;
}

const LRC_TAG_REGEX = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;

export function parseLrcLyrics(lrc: string): SyncedLyricLine[] {
  if (!lrc || !lrc.trim()) return [];
  const parsed: SyncedLyricLine[] = [];

  for (const rawLine of lrc.split(/\r?\n/)) {
    const tags = [...rawLine.matchAll(LRC_TAG_REGEX)];
    if (tags.length === 0) continue;

    const text = rawLine.replace(LRC_TAG_REGEX, "").trim();
    if (!text) continue;

    for (const match of tags) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const fracStr = match[3] || "";
      const frac = fracStr ? parseInt(fracStr.padEnd(3, "0").slice(0, 3), 10) / 1000 : 0;
      const time = minutes * 60 + seconds + frac;
      parsed.push({ time, text });
    }
  }

  return parsed.sort((a, b) => a.time - b.time);
}

export function getActiveLyricIndex(lines: SyncedLyricLine[], currentTime: number): number {
  if (lines.length === 0) return -1;
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (currentTime + 0.05 >= lines[i].time) {
      active = i;
    } else {
      break;
    }
  }
  return active;
}

interface LyricsSidebarProps {
  isOpen: boolean;
  songId: string | null;
  songTitle: string;
  initialLyrics: string;
  initialSyncedLyrics?: string | null;
  currentTime: number;
  onSeek: (seconds: number) => void;
  onSaveLyrics: (lyrics: string) => Promise<boolean>;
  onFetchLyrics: () => Promise<{ found: boolean; error?: string }>;
  onClose: () => void;
  width?: number;
  maxWidth?: number;
  onResize?: (desiredWidth: number) => void;
  onResetWidth?: () => void;
}

export const LyricsSidebar: React.FC<LyricsSidebarProps> = ({
  isOpen,
  songId,
  songTitle,
  initialLyrics,
  initialSyncedLyrics,
  currentTime,
  onSeek,
  onSaveLyrics,
  onFetchLyrics,
  onClose,
  width = RIGHT_SIDEBAR_DEFAULT_WIDTH,
  maxWidth = RIGHT_SIDEBAR_MAX_WIDTH,
  onResize,
  onResetWidth,
}) => {
  const [lyricsText, setLyricsText] = useState(initialLyrics || "");
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchFeedback, setFetchFeedback] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"sync" | "edit">("edit");

  const activeLineRef = useRef<HTMLButtonElement | null>(null);

  const syncedLines = useMemo(
    () => parseLrcLyrics(initialSyncedLyrics || ""),
    [initialSyncedLyrics]
  );
  const hasSynced = syncedLines.length > 0;

  useEffect(() => {
    setLyricsText(initialLyrics || "");
    setFetchFeedback(null);
  }, [songId, initialLyrics]);

  useEffect(() => {
    setViewMode(hasSynced ? "sync" : "edit");
  }, [songId, hasSynced]);

  const activeLineIndex = useMemo(
    () => (viewMode === "sync" ? getActiveLyricIndex(syncedLines, currentTime) : -1),
    [viewMode, syncedLines, currentTime]
  );

  useEffect(() => {
    if (viewMode === "sync" && activeLineIndex >= 0 && activeLineRef.current) {
      activeLineRef.current.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }
  }, [activeLineIndex, viewMode]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const ok = await onSaveLyrics(lyricsText);
      if (ok) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2000);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoFetch = async () => {
    if (!songId || isFetching) return;
    setIsFetching(true);
    setFetchFeedback(null);
    try {
      const res = await onFetchLyrics();
      if (!res.found) {
        setFetchFeedback(res.error || "No lyrics found automatically. Paste them manually below.");
      }
    } catch (err) {
      setFetchFeedback(`Error fetching lyrics: ${String(err)}`);
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div
      style={{ width: `${width}px` }}
      className="relative h-full bg-slate-950/80 backdrop-blur-md border-l border-slate-800 flex flex-col shrink-0 animate-in slide-in-from-right duration-200"
    >
      {onResize && onResetWidth && (
        <ResizeHandle
          side="right"
          width={width}
          minWidth={RIGHT_SIDEBAR_MIN_WIDTH}
          maxWidth={maxWidth}
          defaultWidth={RIGHT_SIDEBAR_DEFAULT_WIDTH}
          label="Resize lyrics sidebar"
          onResize={onResize}
          onReset={onResetWidth}
        />
      )}
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="overflow-hidden">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">Lyrics</h2>
          <p className="text-[10px] text-slate-400 truncate mt-0.5">{songTitle || "No track active"}</p>
        </div>
        <div className="flex items-center space-x-1 shrink-0">
          <button
            onClick={handleAutoFetch}
            disabled={!songId || isFetching}
            className="p-1.5 rounded-lg text-xs font-medium flex items-center space-x-1 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 disabled:opacity-40 transition-all"
            title="Auto-fetch Lyrics"
          >
            {isFetching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span className="text-[11px]">{isFetching ? "Fetching" : "Auto"}</span>
          </button>

          {hasSynced && (
            <button
              onClick={() => setViewMode(viewMode === "sync" ? "edit" : "sync")}
              className="p-1.5 rounded-lg text-xs font-medium flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
              title={viewMode === "sync" ? "Edit Plain Lyrics" : "Synced Karaoke View"}
            >
              {viewMode === "sync" ? (
                <Edit3 className="w-3.5 h-3.5" />
              ) : (
                <AlignLeft className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {viewMode === "edit" && (
            <button
              onClick={handleSave}
              disabled={isSaving || !songId}
              className={`p-1.5 rounded-lg text-xs font-medium flex items-center space-x-1 transition-all disabled:opacity-40 ${
                savedSuccess
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : "bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30"
              }`}
              title="Save Lyrics"
            >
              {savedSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              <span className="text-[11px]">{savedSuccess ? "Saved" : "Save"}</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title="Close lyrics"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {fetchFeedback && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">
          {fetchFeedback}
        </div>
      )}

      {/* Body: Synced Karaoke View or Editable Plain Text */}
      <div className="flex-1 min-h-0 p-3 flex flex-col">
        {viewMode === "sync" && hasSynced ? (
          <div className="flex-1 overflow-y-auto bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-1.5">
            {syncedLines.map((line, idx) => {
              const isCurrent = idx === activeLineIndex;
              const isPast = activeLineIndex >= 0 && idx < activeLineIndex;
              return (
                <button
                  key={`${line.time}-${idx}`}
                  ref={isCurrent ? activeLineRef : null}
                  onClick={() => onSeek(line.time)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs leading-relaxed transition-all ${
                    isCurrent
                      ? "bg-cyan-500/15 text-cyan-300 font-semibold border border-cyan-500/30 shadow-sm"
                      : isPast
                        ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
                        : "text-slate-300 hover:text-white hover:bg-slate-800/50"
                  }`}
                >
                  {line.text}
                </button>
              );
            })}
          </div>
        ) : (
          <textarea
            value={lyricsText}
            onChange={(e) => setLyricsText(e.target.value)}
            placeholder="Paste lyrics here or click Auto to search online..."
            className="w-full flex-1 bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs leading-relaxed text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-cyan-500/60 font-mono transition-colors"
          />
        )}
      </div>
    </div>
  );
};
