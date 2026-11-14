import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Song, PitchFrame, PitchData, SearchResultItem, ProgressEventPayload, FetchLyricsResult } from "./types";
import { Sidebar } from "./components/Sidebar";
import { PitchVisualizer } from "./components/PitchVisualizer";
import { PlayerControls } from "./components/PlayerControls";
import { LyricsSidebar } from "./components/LyricsSidebar";
import { DualTrackPlayer } from "./player";
import { useMicrophonePitch } from "./useMicrophonePitch";
import { Mic, MicOff, AlertCircle } from "lucide-react";
import "./App.css";

export const App: React.FC = () => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [activeSong, setActiveSong] = useState<Song | null>(null);
  const [pitchFrames, setPitchFrames] = useState<PitchFrame[]>([]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [vocalPresence, setVocalPresence] = useState<number>(0.8); // 80% default
  const [transpose, setTranspose] = useState<number>(0); // -12 to +12 semitones
  const [speed, setSpeed] = useState<number>(1.0); // 0.50x to 1.50x
  const [lyricsOpen, setLyricsOpen] = useState<boolean>(false);

  // Processing state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingProgress, setProcessingProgress] = useState<number>(0);
  const [processingMessage, setProcessingMessage] = useState<string>("");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Microphone state
  const [micActive, setMicActive] = useState<boolean>(true);
  const { pitch: micPitch } = useMicrophonePitch(micActive);

  // Player ref
  const playerRef = useRef<DualTrackPlayer | null>(null);

  if (!playerRef.current) {
    playerRef.current = new DualTrackPlayer();
  }

  // Load song list on startup
  const fetchSongs = async () => {
    try {
      const list = await invoke<Song[]>("list_songs");
      setSongs(list);
      if (list.length > 0 && !activeSong) {
        selectSong(list[0]);
      }
    } catch (err) {
      console.error("Failed to load song library:", err);
    }
  };

  useEffect(() => {
    fetchSongs();

    // Listen to worker processing progress events
    let unlisten: (() => void) | undefined;
    listen<ProgressEventPayload>("process-progress", (event) => {
      setProcessingProgress(event.payload.percent);
      setProcessingMessage(event.payload.message);
    }).then((unsub) => {
      unlisten = unsub;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Set up player callbacks
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    player.setOnTimeUpdate((time, dur) => {
      setCurrentTime(time);
      setDuration(dur);
    });

    player.setOnEnded(() => {
      setIsPlaying(false);
      setCurrentTime(0);
    });
  }, []);

  const selectSong = async (song: Song) => {
    setActiveSong(song);
    setIsPlaying(false);
    setCurrentTime(0);
    setTranspose(0);
    setSpeed(1.0);

    const player = playerRef.current;
    if (!player) return;

    try {
      // 1. Load audio tracks
      player.setTranspose(0);
      player.setSpeed(1.0);
      const dur = await player.loadTracks(song.vocals_path, song.no_vocals_path);
      setDuration(dur);
      player.setVocalPresence(vocalPresence);

      // 2. Load pitch JSON
      const jsonStr = await invoke<string>("read_text_file", { path: song.pitch_path });
      const parsed: PitchData = JSON.parse(jsonStr);
      setPitchFrames(parsed.frames || []);
    } catch (err) {
      console.error("Error loading selected song:", err);
      setErrorBanner(`Failed to load song assets: ${String(err)}`);
    }
  };

  const handlePlayPause = async () => {
    const player = playerRef.current;
    if (!player) return;

    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
      setCurrentTime(player.getCurrentTime());
    } else {
      await player.play();
      setIsPlaying(player.getIsPlaying());
    }
  };

  const handleSeek = (seconds: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.seek(seconds);
    setCurrentTime(seconds);
  };

  const handleJump = (delta: number) => {
    const player = playerRef.current;
    if (!player) return;
    const cur = player.getCurrentTime();
    const target = Math.max(0, Math.min(duration, cur + delta));
    player.seek(target);
    setCurrentTime(target);
  };

  const handleVocalPresenceChange = (val: number) => {
    setVocalPresence(val);
    const player = playerRef.current;
    if (player) {
      player.setVocalPresence(val);
    }
  };

  const handleTransposeChange = (semitones: number) => {
    setTranspose(semitones);
    playerRef.current?.setTranspose(semitones);
  };

  const handleSpeedChange = (val: number) => {
    setSpeed(val);
    playerRef.current?.setSpeed(val);
  };

  const handleDeleteSong = async (id: string) => {
    try {
      await invoke("delete_song", { songId: id });
      const updated = songs.filter((s) => s.id !== id);
      setSongs(updated);
      if (activeSong?.id === id) {
        if (updated.length > 0) {
          selectSong(updated[0]);
        } else {
          setActiveSong(null);
          setPitchFrames([]);
          playerRef.current?.stop();
        }
      }
    } catch (err) {
      console.error("Error deleting song:", err);
    }
  };

  const handleProcessSource = async (source: string) => {
    setIsProcessing(true);
    setProcessingProgress(0.05);
    setProcessingMessage("Initiating track separation...");
    setErrorBanner(null);

    try {
      const newSong = await invoke<Song>("process_track", {
        source,
        useRoformer: false,
      });
      setSongs((prev) => [newSong, ...prev.filter((s) => s.id !== newSong.id)]);
      selectSong(newSong);
    } catch (err) {
      console.error("Process error:", err);
      setErrorBanner(`Failed to process audio: ${String(err)}`);
    } finally {
      setIsProcessing(false);
      setProcessingProgress(0);
      setProcessingMessage("");
    }
  };

  const handleSearchYoutube = async (query: string): Promise<SearchResultItem[]> => {
    return await invoke<SearchResultItem[]>("search_youtube", { query });
  };

  const handleSaveLyrics = async (lyrics: string): Promise<boolean> => {
    if (!activeSong) return false;
    try {
      await invoke("save_lyrics", { songId: activeSong.id, lyrics });
      setActiveSong({ ...activeSong, lyrics });
      setSongs((prev) =>
        prev.map((s) => (s.id === activeSong.id ? { ...s, lyrics } : s))
      );
      return true;
    } catch (err) {
      console.error("Error saving lyrics:", err);
      return false;
    }
  };

  const handleFetchLyrics = async (): Promise<{ found: boolean; error?: string }> => {
    if (!activeSong) return { found: false, error: "No song selected." };
    try {
      const res = await invoke<FetchLyricsResult>("fetch_lyrics", {
        songId: activeSong.id,
      });
      if (res.found) {
        const updatedSong: Song = {
          ...activeSong,
          lyrics: res.lyrics,
          synced_lyrics: res.synced_lyrics ?? activeSong.synced_lyrics ?? null,
        };
        setActiveSong(updatedSong);
        setSongs((prev) =>
          prev.map((s) => (s.id === activeSong.id ? updatedSong : s))
        );
      }
      return { found: res.found };
    } catch (err) {
      console.error("Error fetching lyrics:", err);
      return { found: false, error: String(err) };
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#090d16] text-slate-100 antialiased font-sans">
      {/* Left Sidebar: Song stack & search */}
      <Sidebar
        songs={songs}
        activeSongId={activeSong?.id || null}
        onSelectSong={selectSong}
        onDeleteSong={handleDeleteSong}
        onAddFromUrl={handleProcessSource}
        onAddFromFile={handleProcessSource}
        onSearchYoutube={handleSearchYoutube}
        isProcessing={isProcessing}
        processingProgress={processingProgress}
        processingMessage={processingMessage}
      />

      {/* Main Center Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden p-4 space-y-4">
        {/* Top Header bar with song title and mic toggle */}
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center space-x-3 overflow-hidden">
            <div>
              <h1 className="text-base font-bold text-white tracking-tight truncate">
                {activeSong ? activeSong.title : "No song loaded"}
              </h1>
              <p className="text-xs text-slate-400 truncate">
                {activeSong ? activeSong.artist : "Select or add a song from the left sidebar"}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Mic Toggle Button */}
            <button
              onClick={() => setMicActive(!micActive)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center space-x-2 transition-all ${
                micActive
                  ? "bg-rose-500/15 border-rose-500/40 text-rose-300 shadow-sm shadow-rose-950"
                  : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
              title={micActive ? "Mute Microphone" : "Enable Microphone"}
            >
              {micActive ? <Mic className="w-4 h-4 text-rose-400 animate-pulse" /> : <MicOff className="w-4 h-4" />}
              <span>{micActive ? "Mic Active" : "Mic Off"}</span>
            </button>
          </div>
        </div>

        {/* Error notification banner if any */}
        {errorBanner && (
          <div className="p-3 bg-red-950/60 border border-red-800 rounded-xl flex items-center justify-between text-xs text-red-200">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorBanner}</span>
            </div>
            <button
              onClick={() => setErrorBanner(null)}
              className="text-red-400 hover:text-red-200 font-bold ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Pitch Visualizer Area */}
        <div className="flex-1 min-h-0 w-full">
          <PitchVisualizer
            frames={pitchFrames}
            currentTime={currentTime}
            getCurrentTime={() => playerRef.current?.getCurrentTime() ?? 0}
            micMidi={micPitch.voiced ? micPitch.midi : null}
            micVoiced={micPitch.voiced}
            transpose={transpose}
            speed={speed}
            timeWindowSeconds={4.5}
          />
        </div>

        {/* Bottom Player Controls */}
        <div className="shrink-0 w-full">
          <PlayerControls
            isPlaying={isPlaying}
            currentTime={currentTime}
            getCurrentTime={() => playerRef.current?.getCurrentTime() ?? 0}
            duration={duration}
            vocalPresence={vocalPresence}
            transpose={transpose}
            speed={speed}
            lyricsOpen={lyricsOpen}
            onPlayPause={handlePlayPause}
            onSeek={handleSeek}
            onJumpBack={(sec) => handleJump(-sec)}
            onJumpForward={(sec) => handleJump(sec)}
            onVocalPresenceChange={handleVocalPresenceChange}
            onTransposeChange={handleTransposeChange}
            onSpeedChange={handleSpeedChange}
            onToggleLyrics={() => setLyricsOpen(!lyricsOpen)}
          />
        </div>
      </div>

      {/* Right Sidebar: Lyrics */}
      <LyricsSidebar
        isOpen={lyricsOpen}
        songId={activeSong?.id || null}
        songTitle={activeSong?.title || ""}
        initialLyrics={activeSong?.lyrics || ""}
        initialSyncedLyrics={activeSong?.synced_lyrics || ""}
        currentTime={currentTime}
        onSeek={handleSeek}
        onSaveLyrics={handleSaveLyrics}
        onFetchLyrics={handleFetchLyrics}
        onClose={() => setLyricsOpen(false)}
      />
    </div>
  );
};

export default App;
