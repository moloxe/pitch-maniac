import React, { useEffect, useRef, useState } from "react";
import { Song, SearchResultItem } from "../types";
import { Search, Trash2, Music, Plus, Video, FileAudio, Loader2, GripVertical } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ResizeHandle } from "./ResizeHandle";
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
} from "../sidebarResize";
import {
  computeInsertionSlot,
  reorderSongList,
  slotToTargetIndex,
} from "../playerSettings";

interface SidebarProps {
  songs: Song[];
  activeSongId: string | null;
  onSelectSong: (song: Song) => void;
  onDeleteSong: (id: string) => void;
  onReorderSongs?: (reordered: Song[]) => void;
  onModalOpenChange?: (open: boolean) => void;
  onAddFromUrl: (url: string) => void;
  onAddFromFile: (filePath: string) => void;
  onSearchYoutube: (query: string) => Promise<SearchResultItem[]>;
  isProcessing: boolean;
  processingProgress: number;
  processingMessage: string;
  width?: number;
  maxWidth?: number;
  onResize?: (desiredWidth: number) => void;
  onResetWidth?: () => void;
}

interface DragRenderState {
  songId: string;
  fromIndex: number;
  insertionSlot: number;
  deltaY: number;
  indicatorTop: number | null;
}

interface DragSession {
  pointerId: number;
  songId: string;
  fromIndex: number;
  startY: number;
  lastClientY: number;
  startScrollTop: number;
  threshold: number;
  active: boolean;
  insertionSlot: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  songs,
  activeSongId,
  onSelectSong,
  onDeleteSong,
  onReorderSongs,
  onModalOpenChange,
  onAddFromUrl,
  onAddFromFile,
  onSearchYoutube,
  isProcessing,
  processingProgress,
  processingMessage,
  width = LEFT_SIDEBAR_DEFAULT_WIDTH,
  maxWidth = LEFT_SIDEBAR_MAX_WIDTH,
  onResize,
  onResetWidth,
}) => {
  const [filterQuery, setFilterQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [ytUrlInput, setYtUrlInput] = useState("");
  const [ytSearchQuery, setYtSearchQuery] = useState("");
  const [ytSearchResults, setYtSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearchingYt, setIsSearchingYt] = useState(false);
  const [failedThumbs, setFailedThumbs] = useState<Record<string, boolean>>({});
  const [dragState, setDragState] = useState<DragRenderState | null>(null);

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragSessionRef = useRef<DragSession | null>(null);
  const suppressNextClickRef = useRef<boolean>(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const filteredSongs = songs.filter(
    (s) =>
      s.title.toLowerCase().includes(filterQuery.toLowerCase()) ||
      s.artist.toLowerCase().includes(filterQuery.toLowerCase())
  );

  const songsRef = useRef(songs);
  songsRef.current = songs;
  const filteredSongsRef = useRef(filteredSongs);
  filteredSongsRef.current = filteredSongs;
  const onReorderSongsRef = useRef(onReorderSongs);
  onReorderSongsRef.current = onReorderSongs;

  useEffect(() => {
    onModalOpenChange?.(showAddModal);
  }, [showAddModal, onModalOpenChange]);

  useEffect(() => {
    return () => {
      onModalOpenChange?.(false);
      dragCleanupRef.current?.();
    };
  }, [onModalOpenChange]);

  const computeIndicatorTop = (
    slot: number,
    fromIndex: number,
    rects: Array<{ top: number; bottom: number; height: number }>
  ): number | null => {
    if (slot === fromIndex || slot === fromIndex + 1 || rects.length === 0) {
      return null;
    }
    const container = listContainerRef.current;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    const scrollTop = container.scrollTop;

    if (slot <= 0) {
      return rects[0].top - containerRect.top + scrollTop - 2;
    }
    if (slot >= rects.length) {
      return rects[rects.length - 1].bottom - containerRect.top + scrollTop + 2;
    }
    const midpoint = (rects[slot - 1].bottom + rects[slot].top) / 2;
    return midpoint - containerRect.top + scrollTop;
  };

  const handleRowPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    song: Song,
    index: number
  ) => {
    if (e.button !== 0) return;
    if (!onReorderSongsRef.current || filteredSongsRef.current.length <= 1) return;

    const targetEl = e.target as HTMLElement | null;
    if (targetEl?.closest("[data-delete-song]")) return;

    const isHandle = Boolean(targetEl?.closest("[data-drag-handle]"));
    if (isHandle) {
      e.preventDefault();
    }

    dragCleanupRef.current?.();

    const container = listContainerRef.current;
    const session: DragSession = {
      pointerId: e.pointerId,
      songId: song.id,
      fromIndex: index,
      startY: e.clientY,
      lastClientY: e.clientY,
      startScrollTop: container?.scrollTop ?? 0,
      threshold: isHandle ? 2 : 5,
      active: false,
      insertionSlot: index,
    };
    dragSessionRef.current = session;

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    let rafId: number | null = null;
    let lastFrameTs = 0;

    const updateDragVisuals = (clientY: number) => {
      const visible = filteredSongsRef.current;
      const rects = visible.map((s) => {
        const el = rowRefs.current.get(s.id);
        if (!el) return { top: 0, bottom: 0, height: 0 };
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      });
      const slot = computeInsertionSlot(clientY, rects);
      const scrollDelta = (listContainerRef.current?.scrollTop ?? 0) - session.startScrollTop;
      const deltaY = clientY - session.startY + scrollDelta;
      session.insertionSlot = slot;
      setDragState({
        songId: session.songId,
        fromIndex: session.fromIndex,
        insertionSlot: slot,
        deltaY,
        indicatorTop: computeIndicatorTop(slot, session.fromIndex, rects),
      });
    };

    const stopAutoScroll = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      lastFrameTs = 0;
    };

    const runAutoScroll = (ts: number) => {
      if (!session.active) {
        stopAutoScroll();
        return;
      }
      const scroller = listContainerRef.current;
      if (scroller && scroller.scrollHeight > scroller.clientHeight) {
        const dt = lastFrameTs > 0 ? Math.min(0.05, (ts - lastFrameTs) / 1000) : 1 / 60;
        lastFrameTs = ts;
        const rect = scroller.getBoundingClientRect();
        const edgeZone = Math.min(44, rect.height / 3);
        let speedPxPerSec = 0;

        if (session.lastClientY < rect.top + edgeZone) {
          const depth = Math.min(2, (rect.top + edgeZone - session.lastClientY) / Math.max(1, edgeZone));
          speedPxPerSec = -320 * depth;
        } else if (session.lastClientY > rect.bottom - edgeZone) {
          const depth = Math.min(2, (session.lastClientY - (rect.bottom - edgeZone)) / Math.max(1, edgeZone));
          speedPxPerSec = 320 * depth;
        }

        if (speedPxPerSec !== 0) {
          const before = scroller.scrollTop;
          scroller.scrollTop += speedPxPerSec * dt;
          if (scroller.scrollTop !== before) {
            updateDragVisuals(session.lastClientY);
          }
        }
      }
      rafId = requestAnimationFrame(runAutoScroll);
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("keydown", handleEscapeKey);
      stopAutoScroll();
      if (session.active) {
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevUserSelect;
      }
      dragSessionRef.current = null;
      dragCleanupRef.current = null;
      setDragState(null);
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== session.pointerId) return;
      session.lastClientY = moveEvent.clientY;

      if (!session.active) {
        if (Math.abs(moveEvent.clientY - session.startY) < session.threshold) {
          return;
        }
        session.active = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        window.getSelection?.()?.removeAllRanges();
        rafId = requestAnimationFrame(runAutoScroll);
      }

      updateDragVisuals(moveEvent.clientY);
    };

    const finishDrag = (commit: boolean) => {
      const wasActive = session.active;
      const finalSlot = session.insertionSlot;
      const fromIndex = session.fromIndex;
      const draggedId = session.songId;

      cleanup();

      if (wasActive) {
        suppressNextClickRef.current = true;
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);

        if (commit) {
          const visible = filteredSongsRef.current;
          const targetIndex = slotToTargetIndex(finalSlot, fromIndex, visible.length);
          if (targetIndex !== fromIndex) {
            const reordered = reorderSongList(
              songsRef.current,
              draggedId,
              targetIndex,
              visible.map((s) => s.id)
            );
            onReorderSongsRef.current?.(reordered);
          }
        }
      }
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== session.pointerId) return;
      finishDrag(true);
    };

    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== session.pointerId) return;
      finishDrag(false);
    };

    const handleEscapeKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape" && session.active) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        finishDrag(false);
      }
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleEscapeKey, true);
  };

  const handleRowKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    song: Song,
    index: number
  ) => {
    if (
      e.altKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      (e.key === "ArrowUp" || e.key === "ArrowDown")
    ) {
      if (!onReorderSongs || filteredSongs.length <= 1) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.key === "ArrowUp" ? -1 : 1;
      const targetIndex = Math.max(0, Math.min(filteredSongs.length - 1, index + delta));
      if (targetIndex !== index) {
        const reordered = reorderSongList(
          songs,
          song.id,
          targetIndex,
          filteredSongs.map((s) => s.id)
        );
        onReorderSongs(reordered);
        requestAnimationFrame(() => {
          rowRefs.current.get(song.id)?.focus({ preventScroll: true });
        });
      }
      return;
    }

    if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      onSelectSong(song);
    }
  };

  const handlePickLocalFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Audio Files", extensions: ["mp3", "wav", "m4a", "flac", "ogg"] }],
      });
      if (selected && typeof selected === "string") {
        setShowAddModal(false);
        onAddFromFile(selected);
      }
    } catch (err) {
      console.error("Error picking file:", err);
    }
  };

  const handleYtSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytSearchQuery.trim()) return;
    setIsSearchingYt(true);
    try {
      const res = await onSearchYoutube(ytSearchQuery);
      setYtSearchResults(res);
    } finally {
      setIsSearchingYt(false);
    }
  };

  return (
    <div
      style={{ width: `${width}px` }}
      className="relative h-full bg-slate-950/80 backdrop-blur-md border-r border-slate-800 flex flex-col shrink-0"
    >
      {onResize && onResetWidth && (
        <ResizeHandle
          side="left"
          width={width}
          minWidth={LEFT_SIDEBAR_MIN_WIDTH}
          maxWidth={maxWidth}
          defaultWidth={LEFT_SIDEBAR_DEFAULT_WIDTH}
          label="Resize library sidebar"
          onResize={onResize}
          onReset={onResetWidth}
        />
      )}
      {/* Header & Add Button */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <img
            src="/logo.svg"
            alt="Pitch Maniac"
            className="w-8 h-8 rounded-lg shadow-md shadow-cyan-500/20 object-contain"
          />
          <div>
            <h1 className="text-sm font-bold text-white tracking-wide">Pitch Maniac</h1>
            <p className="text-[10px] text-slate-400">Karaoke Vocal Studio</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          disabled={isProcessing}
          className="p-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold transition-all shadow shadow-cyan-500/30 flex items-center space-x-1 text-xs disabled:opacity-50"
          title="Add Song"
        >
          <Plus className="w-4 h-4" />
          <span>Add</span>
        </button>
      </div>

      {/* Processing Status Banner */}
      {isProcessing && (
        <div className="p-3 bg-cyan-950/40 border-b border-cyan-800/50 flex flex-col space-y-1.5 animate-pulse">
          <div className="flex items-center space-x-2 text-cyan-400 text-xs font-medium">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="truncate">{processingMessage || "Processing track..."}</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-cyan-400 h-1.5 transition-all duration-300"
              style={{ width: `${Math.round(processingProgress * 100)}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Filter / Search Bar */}
      <div className="p-3 border-b border-slate-800">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search library..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 transition-colors"
          />
        </div>
      </div>

      {/* Cached Song Stack */}
      <div
        ref={listContainerRef}
        className="relative flex-1 overflow-y-auto p-2 space-y-1"
      >
        {dragState && dragState.indicatorTop !== null && (
          <div
            aria-hidden="true"
            className="absolute left-2 right-2 h-0.5 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.85)] pointer-events-none z-40"
            style={{ top: `${dragState.indicatorTop}px` }}
          >
            <span className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-cyan-300 border border-slate-950" />
          </div>
        )}

        {filteredSongs.length === 0 ? (
          <div className="text-center py-12 px-4 text-slate-500 text-xs">
            {songs.length === 0 ? "No songs in library yet. Click 'Add' to import one!" : "No songs match your search."}
          </div>
        ) : (
          filteredSongs.map((song, index) => {
            const isActive = song.id === activeSongId;
            const isDraggingThis = dragState?.songId === song.id;
            return (
              <div
                key={song.id}
                ref={(el) => {
                  if (el) {
                    rowRefs.current.set(song.id, el);
                  } else {
                    rowRefs.current.delete(song.id);
                  }
                }}
                tabIndex={0}
                onPointerDown={(e) => handleRowPointerDown(e, song, index)}
                onKeyDown={(e) => handleRowKeyDown(e, song, index)}
                onClick={() => {
                  if (suppressNextClickRef.current) {
                    suppressNextClickRef.current = false;
                    return;
                  }
                  onSelectSong(song);
                }}
                style={
                  isDraggingThis
                    ? {
                        transform: `translateY(${dragState.deltaY}px) scale(1.02)`,
                        zIndex: 30,
                        pointerEvents: "none",
                      }
                    : undefined
                }
                className={`group relative flex items-center justify-between p-2 rounded-xl cursor-pointer border focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/70 ${
                  isDraggingThis
                    ? "bg-slate-800 border-cyan-400/70 shadow-xl shadow-black/50 opacity-95 transition-none"
                    : isActive
                      ? "bg-slate-800/90 border-cyan-500/50 shadow-md shadow-cyan-950/30 transition-colors"
                      : "border-transparent hover:bg-slate-900/60 hover:border-slate-800 transition-colors"
                }`}
              >
                <div className="flex items-center space-x-2.5 overflow-hidden flex-1">
                  {/* Drag Handle */}
                  {onReorderSongs && filteredSongs.length > 1 && (
                    <div
                      data-drag-handle="true"
                      title="Drag to reorder (or Alt+↑ / Alt+↓)"
                      className="p-0.5 -ml-0.5 rounded text-slate-500/80 group-hover:text-slate-300 hover:bg-slate-700/60 cursor-grab active:cursor-grabbing touch-none select-none shrink-0 flex items-center justify-center"
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>
                  )}

                  {/* Thumbnail or Icon */}
                  <div className="w-11 h-11 rounded-lg bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden border border-slate-700/60">
                    {song.thumb_path && !failedThumbs[song.thumb_path] ? (
                      <img
                        src={convertFileSrc(song.thumb_path)}
                        alt=""
                        draggable={false}
                        className="w-full h-full object-cover pointer-events-none"
                        onError={() => {
                          setFailedThumbs((prev) => ({
                            ...prev,
                            [song.thumb_path!]: true,
                          }));
                        }}
                      />
                    ) : (
                      <Music className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  {/* Info */}
                  <div className="overflow-hidden flex-1 pr-1">
                    <p className={`text-xs font-semibold truncate ${isActive ? "text-cyan-300" : "text-slate-200"}`}>
                      {song.title}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {song.artist || "Unknown artist"} • {Math.round(song.duration)}s
                    </p>
                  </div>
                </div>

                {/* Delete Button */}
                <button
                  type="button"
                  data-delete-song="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${song.title}" from library?`)) {
                      onDeleteSong(song.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all shrink-0 ml-1"
                  title="Delete Song"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Add Song Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl flex flex-col space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <h2 className="text-base font-bold text-white">Add New Song</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded"
              >
                Close
              </button>
            </div>

            {/* Direct URL / ID */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center space-x-1.5">
                <Video className="w-4 h-4 text-red-500" />
                <span>YouTube URL or ID</span>
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={ytUrlInput}
                  onChange={(e) => setYtUrlInput(e.target.value)}
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                />
                <button
                  onClick={() => {
                    if (ytUrlInput.trim()) {
                      setShowAddModal(false);
                      onAddFromUrl(ytUrlInput.trim());
                      setYtUrlInput("");
                    }
                  }}
                  className="shrink-0 px-3 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold rounded-lg text-xs"
                >
                  Import
                </button>
              </div>
            </div>

            <div className="flex items-center space-x-2 my-1">
              <div className="flex-1 h-px bg-slate-800"></div>
              <span className="text-[11px] text-slate-500 uppercase font-bold">OR</span>
              <div className="flex-1 h-px bg-slate-800"></div>
            </div>

            {/* Local File */}
            <div>
              <button
                onClick={handlePickLocalFile}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 flex items-center justify-center space-x-2 transition-colors"
              >
                <FileAudio className="w-4 h-4 text-cyan-400" />
                <span>Choose Audio File from Computer (.mp3, .wav, .m4a)</span>
              </button>
            </div>

            <div className="flex items-center space-x-2 my-1">
              <div className="flex-1 h-px bg-slate-800"></div>
              <span className="text-[11px] text-slate-500 uppercase font-bold">OR Search</span>
              <div className="flex-1 h-px bg-slate-800"></div>
            </div>

            {/* Search YouTube */}
            <form onSubmit={handleYtSearch} className="space-y-2">
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="Search artist or title on YouTube..."
                  value={ytSearchQuery}
                  onChange={(e) => setYtSearchQuery(e.target.value)}
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  disabled={isSearchingYt}
                  className="shrink-0 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg text-xs flex items-center space-x-1"
                >
                  {isSearchingYt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>Search</span>
                </button>
              </div>

              {/* Results List */}
              <div className="max-h-48 overflow-y-auto space-y-1 pt-1">
                {ytSearchResults.map((res) => (
                  <div
                    key={res.id}
                    className="p-2 rounded-lg bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 flex items-center justify-between text-xs cursor-pointer group"
                    onClick={() => {
                      setShowAddModal(false);
                      onAddFromUrl(res.url);
                    }}
                  >
                    <div className="truncate pr-2">
                      <p className="font-medium text-slate-200 truncate">{res.title}</p>
                      <p className="text-[10px] text-slate-500">
                        {res.uploader} {res.duration ? `• ${Math.round(res.duration)}s` : ""}
                      </p>
                    </div>
                    <button className="px-2.5 py-1 bg-cyan-500/20 text-cyan-400 group-hover:bg-cyan-500 group-hover:text-slate-950 rounded text-[11px] font-semibold shrink-0 transition-colors">
                      Process
                    </button>
                  </div>
                ))}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
