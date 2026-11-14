import React, { useState } from "react";
import { Song, SearchResultItem } from "../types";
import { Search, Trash2, Music, Plus, Video, FileAudio, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ResizeHandle } from "./ResizeHandle";
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
} from "../sidebarResize";

interface SidebarProps {
  songs: Song[];
  activeSongId: string | null;
  onSelectSong: (song: Song) => void;
  onDeleteSong: (id: string) => void;
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

export const Sidebar: React.FC<SidebarProps> = ({
  songs,
  activeSongId,
  onSelectSong,
  onDeleteSong,
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

  const filteredSongs = songs.filter(
    (s) =>
      s.title.toLowerCase().includes(filterQuery.toLowerCase()) ||
      s.artist.toLowerCase().includes(filterQuery.toLowerCase())
  );

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
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredSongs.length === 0 ? (
          <div className="text-center py-12 px-4 text-slate-500 text-xs">
            {songs.length === 0 ? "No songs in library yet. Click 'Add' to import one!" : "No songs match your search."}
          </div>
        ) : (
          filteredSongs.map((song) => {
            const isActive = song.id === activeSongId;
            return (
              <div
                key={song.id}
                onClick={() => onSelectSong(song)}
                className={`group flex items-center justify-between p-2 rounded-xl cursor-pointer transition-all border ${
                  isActive
                    ? "bg-slate-800/90 border-cyan-500/50 shadow-md shadow-cyan-950/30"
                    : "border-transparent hover:bg-slate-900/60 hover:border-slate-800"
                }`}
              >
                <div className="flex items-center space-x-3 overflow-hidden flex-1">
                  {/* Thumbnail or Icon */}
                  <div className="w-11 h-11 rounded-lg bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden border border-slate-700/60">
                    {song.thumb_path && !failedThumbs[song.thumb_path] ? (
                      <img
                        src={convertFileSrc(song.thumb_path)}
                        alt=""
                        className="w-full h-full object-cover"
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
