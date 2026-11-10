import React, { useState, useEffect } from "react";
import { X, Save, Check } from "lucide-react";

interface LyricsSidebarProps {
  isOpen: boolean;
  songTitle: string;
  initialLyrics: string;
  onSaveLyrics: (lyrics: string) => Promise<boolean>;
  onClose: () => void;
}

export const LyricsSidebar: React.FC<LyricsSidebarProps> = ({
  isOpen,
  songTitle,
  initialLyrics,
  onSaveLyrics,
  onClose,
}) => {
  const [lyricsText, setLyricsText] = useState(initialLyrics || "");
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    setLyricsText(initialLyrics || "");
  }, [initialLyrics]);

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

  return (
    <div className="w-80 h-full bg-slate-950/80 backdrop-blur-md border-l border-slate-800 flex flex-col shrink-0 animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="overflow-hidden">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">Lyrics</h2>
          <p className="text-[10px] text-slate-400 truncate mt-0.5">{songTitle || "No track active"}</p>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`p-1.5 rounded-lg text-xs font-medium flex items-center space-x-1 transition-all ${
              savedSuccess
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                : "bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30"
            }`}
            title="Save Lyrics"
          >
            {savedSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span className="text-[11px]">{savedSuccess ? "Saved" : "Save"}</span>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title="Close lyrics"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Text Area */}
      <div className="flex-1 p-3 flex flex-col">
        <textarea
          value={lyricsText}
          onChange={(e) => setLyricsText(e.target.value)}
          placeholder="Paste or write lyrics here for singing along..."
          className="w-full flex-1 bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs leading-relaxed text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-cyan-500/60 font-mono transition-colors"
        />
      </div>
    </div>
  );
};
