import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Song, PitchFrame, PitchData, SearchResultItem, ProgressEventPayload, FetchLyricsResult } from "./types";
import { Sidebar } from "./components/Sidebar";
import { PitchVisualizer } from "./components/PitchVisualizer";
import { PlayerControls } from "./components/PlayerControls";
import { LyricsSidebar } from "./components/LyricsSidebar";
import { DualTrackPlayer } from "./player";
import { clampSpeed, clampTranspose } from "./audioDsp";
import {
  DEFAULT_SPEED,
  DEFAULT_TRANSPOSE,
  DEFAULT_VOCAL_PRESENCE,
  applySavedSongOrder,
  clampProgress,
  clampVocalPresence,
  deleteSongSettings,
  getAdjacentSong,
  isEditableKeyboardTarget,
  isSpaceKey,
  loadSavedSongOrder,
  loadSongSettings,
  resolvePlayerKeyboardCommand,
  saveSongOrder,
  saveSongProgress,
  saveSongSettings,
} from "./playerSettings";
import { useMicrophonePitch } from "./useMicrophonePitch";
import { Mic, MicOff, AlertCircle } from "lucide-react";
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  LEFT_SIDEBAR_STORAGE_KEY,
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
  RIGHT_SIDEBAR_STORAGE_KEY,
  clampSidebarWidth,
  loadSavedSidebarWidth,
  resolveSidebarWidths,
  saveSidebarWidth,
} from "./sidebarResize";
import "./App.css";

export const App: React.FC = () => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [activeSong, setActiveSong] = useState<Song | null>(null);
  const [pitchFrames, setPitchFrames] = useState<PitchFrame[]>([]);

  // Playback state (defaults to no preset until a song with saved settings is loaded)
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [vocalPresence, setVocalPresence] = useState<number>(DEFAULT_VOCAL_PRESENCE);
  const [transpose, setTranspose] = useState<number>(DEFAULT_TRANSPOSE);
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED);
  const [lyricsOpen, setLyricsOpen] = useState<boolean>(false);
  const [addModalOpen, setAddModalOpen] = useState<boolean>(false);

  const sliderSettingsRef = useRef({
    vocalPresence: DEFAULT_VOCAL_PRESENCE,
    transpose: DEFAULT_TRANSPOSE,
    speed: DEFAULT_SPEED,
  });
  const activeSongIdRef = useRef<string | null>(null);
  const isSongReadyRef = useRef<boolean>(false);
  const lastProgressSaveMsRef = useRef<number>(0);
  const loadRequestIdRef = useRef<number>(0);

  // Resizable sidebar widths
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280
  );
  const [leftWidth, setLeftWidth] = useState<number>(() =>
    loadSavedSidebarWidth(
      LEFT_SIDEBAR_STORAGE_KEY,
      LEFT_SIDEBAR_DEFAULT_WIDTH,
      LEFT_SIDEBAR_MIN_WIDTH,
      LEFT_SIDEBAR_MAX_WIDTH
    )
  );
  const [rightWidth, setRightWidth] = useState<number>(() =>
    loadSavedSidebarWidth(
      RIGHT_SIDEBAR_STORAGE_KEY,
      RIGHT_SIDEBAR_DEFAULT_WIDTH,
      RIGHT_SIDEBAR_MIN_WIDTH,
      RIGHT_SIDEBAR_MAX_WIDTH
    )
  );

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
    const p = new DualTrackPlayer();
    p.setVocalPresence(DEFAULT_VOCAL_PRESENCE);
    p.setTranspose(DEFAULT_TRANSPOSE);
    p.setSpeed(DEFAULT_SPEED);
    playerRef.current = p;
  }

  const flushCurrentSongProgress = () => {
    const songId = activeSongIdRef.current;
    const player = playerRef.current;
    if (!songId || !isSongReadyRef.current || !player) return;
    saveSongProgress(songId, player.getCurrentTime(), player.getDuration());
    lastProgressSaveMsRef.current = Date.now();
  };

  // Load song list on startup
  const fetchSongs = async () => {
    try {
      const list = await invoke<Song[]>("list_songs");
      const ordered = applySavedSongOrder(list, loadSavedSongOrder());
      setSongs(ordered);
      if (ordered.length > 0 && !activeSong) {
        selectSong(ordered[0]);
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

  useEffect(() => {
    const handleWindowResize = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  // Set up player callbacks & persist progress on unload
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    player.setOnTimeUpdate((time, dur) => {
      setCurrentTime(time);
      setDuration(dur);
      if (isSongReadyRef.current && activeSongIdRef.current) {
        const now = Date.now();
        if (now - lastProgressSaveMsRef.current >= 500) {
          lastProgressSaveMsRef.current = now;
          saveSongProgress(activeSongIdRef.current, time, dur);
        }
      }
    });

    player.setOnEnded(() => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (activeSongIdRef.current) {
        lastProgressSaveMsRef.current = Date.now();
        saveSongProgress(activeSongIdRef.current, 0, player.getDuration());
      }
    });
  }, []);

  useEffect(() => {
    const handleFlush = () => flushCurrentSongProgress();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushCurrentSongProgress();
      }
    };
    window.addEventListener("beforeunload", handleFlush);
    window.addEventListener("pagehide", handleFlush);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      handleFlush();
      window.removeEventListener("beforeunload", handleFlush);
      window.removeEventListener("pagehide", handleFlush);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const selectSong = async (song: Song, options?: { autoPlay?: boolean }) => {
    const requestId = ++loadRequestIdRef.current;
    const player = playerRef.current;

    // Persist outgoing song progress before loadTracks() stops playback
    if (activeSongIdRef.current && isSongReadyRef.current && player) {
      saveSongProgress(
        activeSongIdRef.current,
        player.getCurrentTime(),
        player.getDuration()
      );
    }

    isSongReadyRef.current = false;
    activeSongIdRef.current = song.id;

    const saved = loadSongSettings(song.id);
    sliderSettingsRef.current = {
      vocalPresence: saved.vocalPresence,
      transpose: saved.transpose,
      speed: saved.speed,
    };

    setActiveSong(song);
    setIsPlaying(false);
    setVocalPresence(saved.vocalPresence);
    setTranspose(saved.transpose);
    setSpeed(saved.speed);
    setCurrentTime(saved.progress);

    if (!player) return;

    try {
      // 1. Load audio tracks with this song's saved presets (or defaults if none)
      player.setVocalPresence(saved.vocalPresence);
      player.setTranspose(saved.transpose);
      player.setSpeed(saved.speed);
      const dur = await player.loadTracks(song.vocals_path, song.no_vocals_path);
      if (loadRequestIdRef.current !== requestId) return;

      setDuration(dur);
      player.setVocalPresence(sliderSettingsRef.current.vocalPresence);
      player.setTranspose(sliderSettingsRef.current.transpose);
      player.setSpeed(sliderSettingsRef.current.speed);

      const restoredProgress = clampProgress(saved.progress, dur);
      if (restoredProgress > 0) {
        player.seek(restoredProgress);
      }
      setCurrentTime(restoredProgress);

      // 2. Load pitch JSON
      const jsonStr = await invoke<string>("read_text_file", { path: song.pitch_path });
      if (loadRequestIdRef.current !== requestId) return;

      const parsed: PitchData = JSON.parse(jsonStr);
      setPitchFrames(parsed.frames || []);

      isSongReadyRef.current = true;
      lastProgressSaveMsRef.current = Date.now();

      if (options?.autoPlay) {
        await player.play(restoredProgress);
        if (loadRequestIdRef.current === requestId) {
          setIsPlaying(player.getIsPlaying());
        }
      }
    } catch (err) {
      if (loadRequestIdRef.current !== requestId) return;
      console.error("Error loading selected song:", err);
      setErrorBanner(`Failed to load song assets: ${String(err)}`);
    }
  };

  const handlePlay = async () => {
    const player = playerRef.current;
    if (!player || player.getIsPlaying()) return;
    await player.play();
    setIsPlaying(player.getIsPlaying());
  };

  const handlePause = () => {
    const player = playerRef.current;
    if (!player || !player.getIsPlaying()) return;
    player.pause();
    const t = player.getCurrentTime();
    setIsPlaying(false);
    setCurrentTime(t);
    if (isSongReadyRef.current && activeSongIdRef.current) {
      lastProgressSaveMsRef.current = Date.now();
      saveSongProgress(activeSongIdRef.current, t, player.getDuration());
    }
  };

  const handlePlayPause = async () => {
    const player = playerRef.current;
    if (!player) return;

    if (player.getIsPlaying() || isPlaying) {
      player.pause();
      const t = player.getCurrentTime();
      setIsPlaying(false);
      setCurrentTime(t);
      if (isSongReadyRef.current && activeSongIdRef.current) {
        lastProgressSaveMsRef.current = Date.now();
        saveSongProgress(activeSongIdRef.current, t, player.getDuration());
      }
    } else {
      await player.play();
      setIsPlaying(player.getIsPlaying());
    }
  };

  const handlePrevSong = async () => {
    const prev = getAdjacentSong(songs, activeSong?.id || null, "prev");
    if (prev) {
      await selectSong(prev, { autoPlay: true });
    }
  };

  const handleNextSong = async () => {
    const next = getAdjacentSong(songs, activeSong?.id || null, "next");
    if (next) {
      await selectSong(next, { autoPlay: true });
    }
  };

  const handleSeek = (seconds: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.seek(seconds);
    setCurrentTime(seconds);
    if (isSongReadyRef.current && activeSongIdRef.current) {
      lastProgressSaveMsRef.current = Date.now();
      saveSongProgress(activeSongIdRef.current, seconds, player.getDuration());
    }
  };

  const handleJump = (delta: number) => {
    const player = playerRef.current;
    if (!player) return;
    const cur = player.getCurrentTime();
    const target = Math.max(0, Math.min(duration, cur + delta));
    player.seek(target);
    setCurrentTime(target);
    if (isSongReadyRef.current && activeSongIdRef.current) {
      lastProgressSaveMsRef.current = Date.now();
      saveSongProgress(activeSongIdRef.current, target, player.getDuration());
    }
  };

  const handleVocalPresenceChange = (val: number) => {
    const clamped = clampVocalPresence(val);
    sliderSettingsRef.current.vocalPresence = clamped;
    setVocalPresence(clamped);
    if (activeSongIdRef.current) {
      saveSongSettings(activeSongIdRef.current, { vocalPresence: clamped });
    }
    playerRef.current?.setVocalPresence(clamped);
  };

  const handleTransposeChange = (semitones: number) => {
    const clamped = clampTranspose(semitones);
    sliderSettingsRef.current.transpose = clamped;
    setTranspose(clamped);
    if (activeSongIdRef.current) {
      saveSongSettings(activeSongIdRef.current, { transpose: clamped });
    }
    playerRef.current?.setTranspose(clamped);
  };

  const handleSpeedChange = (val: number) => {
    const clamped = clampSpeed(val);
    sliderSettingsRef.current.speed = clamped;
    setSpeed(clamped);
    if (activeSongIdRef.current) {
      saveSongSettings(activeSongIdRef.current, { speed: clamped });
    }
    playerRef.current?.setSpeed(clamped);
  };

  const handleReorderSongs = async (reordered: Song[]) => {
    setSongs(reordered);
    const orderedIds = reordered.map((s) => s.id);
    saveSongOrder(orderedIds);
    try {
      await invoke("reorder_songs", { songIds: orderedIds });
    } catch (err) {
      console.error("Failed to persist song order:", err);
    }
  };

  const handleDeleteSong = async (id: string) => {
    try {
      await invoke("delete_song", { songId: id });
      deleteSongSettings(id);
      const updated = songs.filter((s) => s.id !== id);
      setSongs(updated);
      saveSongOrder(updated.map((s) => s.id));
      if (activeSong?.id === id) {
        isSongReadyRef.current = false;
        if (updated.length > 0) {
          selectSong(updated[0]);
        } else {
          activeSongIdRef.current = null;
          setActiveSong(null);
          setPitchFrames([]);
          setIsPlaying(false);
          setCurrentTime(0);
          setDuration(0);
          sliderSettingsRef.current = {
            vocalPresence: DEFAULT_VOCAL_PRESENCE,
            transpose: DEFAULT_TRANSPOSE,
            speed: DEFAULT_SPEED,
          };
          setVocalPresence(DEFAULT_VOCAL_PRESENCE);
          setTranspose(DEFAULT_TRANSPOSE);
          setSpeed(DEFAULT_SPEED);
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
      setSongs((prev) => {
        const next = [newSong, ...prev.filter((s) => s.id !== newSong.id)];
        saveSongOrder(next.map((s) => s.id));
        return next;
      });
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

  const actionHandlersRef = useRef({
    togglePlay: handlePlayPause,
    play: handlePlay,
    pause: handlePause,
    prevTrack: handlePrevSong,
    nextTrack: handleNextSong,
    jump: handleJump,
    modalOpen: addModalOpen,
  });
  actionHandlersRef.current = {
    togglePlay: handlePlayPause,
    play: handlePlay,
    pause: handlePause,
    prevTrack: handlePrevSong,
    nextTrack: handleNextSong,
    jump: handleJump,
    modalOpen: addModalOpen,
  };

  // Global keyboard shortcuts (Spacebar play/pause, media keys, Mac Cmd+Arrows & Windows Ctrl+Arrows)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modalOpen = actionHandlersRef.current.modalOpen;
      const isEditable = isEditableKeyboardTarget(e.target);

      if (
        isSpaceKey(e) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isEditable &&
        !modalOpen
      ) {
        e.preventDefault();
      }

      const command = resolvePlayerKeyboardCommand(e, {
        isEditableTarget: isEditable,
        modalOpen,
      });
      if (!command) return;

      e.preventDefault();

      switch (command.type) {
        case "toggle-play":
          void actionHandlersRef.current.togglePlay();
          break;
        case "play":
          void actionHandlersRef.current.play();
          break;
        case "pause":
          actionHandlersRef.current.pause();
          break;
        case "prev-track":
          void actionHandlersRef.current.prevTrack();
          break;
        case "next-track":
          void actionHandlersRef.current.nextTrack();
          break;
        case "jump":
          actionHandlersRef.current.jump(command.deltaSeconds);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Native OS Media Session integration (macOS Media Keys / Control Center & Windows SMTC)
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    const mediaSession = navigator.mediaSession;
    const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ["play", () => void actionHandlersRef.current.play()],
      ["pause", () => actionHandlersRef.current.pause()],
      ["previoustrack", () => void actionHandlersRef.current.prevTrack()],
      ["nexttrack", () => void actionHandlersRef.current.nextTrack()],
      [
        "seekbackward",
        (details) => actionHandlersRef.current.jump(-(details?.seekOffset ?? 5)),
      ],
      [
        "seekforward",
        (details) => actionHandlersRef.current.jump(details?.seekOffset ?? 5),
      ],
    ];

    for (const [action, handler] of actions) {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // Ignore unsupported media session actions on older WebViews
      }
    }

    return () => {
      for (const [action] of actions) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore
        }
      }
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    const mediaSession = navigator.mediaSession;
    mediaSession.playbackState = isPlaying
      ? "playing"
      : activeSong
        ? "paused"
        : "none";

    if (activeSong && typeof MediaMetadata !== "undefined") {
      try {
        mediaSession.metadata = new MediaMetadata({
          title: activeSong.title,
          artist: activeSong.artist || "Unknown artist",
          album: "Pitch Maniac",
        });
      } catch {
        // Ignore metadata errors
      }
    }
  }, [activeSong, isPlaying]);

  const resolvedWidths = resolveSidebarWidths({
    leftWidth,
    rightWidth,
    rightOpen: lyricsOpen,
    viewportWidth,
  });

  const leftMaxWidth = clampSidebarWidth({
    desiredWidth: LEFT_SIDEBAR_MAX_WIDTH,
    minWidth: LEFT_SIDEBAR_MIN_WIDTH,
    maxWidth: LEFT_SIDEBAR_MAX_WIDTH,
    viewportWidth,
    otherSidebarWidth: lyricsOpen ? resolvedWidths.rightWidth : 0,
  });

  const rightMaxWidth = clampSidebarWidth({
    desiredWidth: RIGHT_SIDEBAR_MAX_WIDTH,
    minWidth: RIGHT_SIDEBAR_MIN_WIDTH,
    maxWidth: RIGHT_SIDEBAR_MAX_WIDTH,
    viewportWidth,
    otherSidebarWidth: resolvedWidths.leftWidth,
  });

  const handleLeftSidebarResize = (desiredWidth: number) => {
    const next = clampSidebarWidth({
      desiredWidth,
      minWidth: LEFT_SIDEBAR_MIN_WIDTH,
      maxWidth: LEFT_SIDEBAR_MAX_WIDTH,
      viewportWidth,
      otherSidebarWidth: lyricsOpen ? resolvedWidths.rightWidth : 0,
    });
    setLeftWidth(next);
    saveSidebarWidth(LEFT_SIDEBAR_STORAGE_KEY, next);
  };

  const handleRightSidebarResize = (desiredWidth: number) => {
    const next = clampSidebarWidth({
      desiredWidth,
      minWidth: RIGHT_SIDEBAR_MIN_WIDTH,
      maxWidth: RIGHT_SIDEBAR_MAX_WIDTH,
      viewportWidth,
      otherSidebarWidth: resolvedWidths.leftWidth,
    });
    setRightWidth(next);
    saveSidebarWidth(RIGHT_SIDEBAR_STORAGE_KEY, next);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#090d16] text-slate-100 antialiased font-sans">
      {/* Left Sidebar: Song stack & search */}
      <Sidebar
        songs={songs}
        activeSongId={activeSong?.id || null}
        onSelectSong={(song) => void selectSong(song)}
        onDeleteSong={handleDeleteSong}
        onReorderSongs={handleReorderSongs}
        onModalOpenChange={setAddModalOpen}
        onAddFromUrl={handleProcessSource}
        onAddFromFile={handleProcessSource}
        onSearchYoutube={handleSearchYoutube}
        isProcessing={isProcessing}
        processingProgress={processingProgress}
        processingMessage={processingMessage}
        width={resolvedWidths.leftWidth}
        maxWidth={leftMaxWidth}
        onResize={handleLeftSidebarResize}
        onResetWidth={() => handleLeftSidebarResize(LEFT_SIDEBAR_DEFAULT_WIDTH)}
      />

      {/* Main Center Area */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden p-4 space-y-4">
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
            canNavigateSongs={songs.length > 1}
            onPlayPause={handlePlayPause}
            onPrevSong={handlePrevSong}
            onNextSong={handleNextSong}
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
        width={resolvedWidths.rightWidth}
        maxWidth={rightMaxWidth}
        onResize={handleRightSidebarResize}
        onResetWidth={() => handleRightSidebarResize(RIGHT_SIDEBAR_DEFAULT_WIDTH)}
      />
    </div>
  );
};

export default App;
