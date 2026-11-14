import { describe, it, expect } from "bun:test";
import {
  DEFAULT_PROGRESS,
  DEFAULT_SPEED,
  DEFAULT_TRANSPOSE,
  DEFAULT_VOCAL_PRESENCE,
  SONG_ORDER_STORAGE_KEY,
  SONG_SETTINGS_STORAGE_KEY,
  StorageLike,
  applySavedSongOrder,
  clampProgress,
  clampVocalPresence,
  computeInsertionSlot,
  deleteSongSettings,
  getAdjacentSong,
  getDefaultSongSettings,
  isEditableKeyboardTarget,
  isSliderOrSeparatorTarget,
  loadSavedSongOrder,
  loadSongSettings,
  reorderSongList,
  resolvePlayerKeyboardCommand,
  saveSongOrder,
  saveSongProgress,
  saveSongSettings,
  slotToTargetIndex,
} from "./playerSettings";
import { Song } from "./types";

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

function makeSong(id: string, title = `Song ${id}`): Song {
  return {
    id,
    title,
    artist: "Artist",
    duration: 180,
    vocals_path: `/tmp/${id}/vocals.wav`,
    no_vocals_path: `/tmp/${id}/no_vocals.wav`,
    pitch_path: `/tmp/${id}/pitch.json`,
  };
}

describe("playerSettings - per-song slider presets & playback progress", () => {
  it("returns default settings without preset when song has no saved state or storage is malformed", () => {
    const empty = createMemoryStorage();
    expect(loadSongSettings("song-a", empty)).toEqual({
      vocalPresence: DEFAULT_VOCAL_PRESENCE,
      transpose: DEFAULT_TRANSPOSE,
      speed: DEFAULT_SPEED,
      progress: DEFAULT_PROGRESS,
    });
    expect(loadSongSettings(null, empty)).toEqual(getDefaultSongSettings());

    const malformed = createMemoryStorage({
      [SONG_SETTINGS_STORAGE_KEY]: "{not valid json",
    });
    expect(loadSongSettings("song-a", malformed)).toEqual(getDefaultSongSettings());
  });

  it("isolates presets and progress per song without sharing across songs", () => {
    const storage = createMemoryStorage();

    saveSongSettings(
      "song-a",
      { vocalPresence: 0, transpose: -4, speed: 1.25 },
      storage
    );
    saveSongProgress("song-a", 73.45, 200, storage);

    // Song A remembers its own presets and progress
    expect(loadSongSettings("song-a", storage)).toEqual({
      vocalPresence: 0,
      transpose: -4,
      speed: 1.25,
      progress: 73.45,
    });

    // Song B stays at default (sin preset) and is not affected by Song A
    expect(loadSongSettings("song-b", storage)).toEqual({
      vocalPresence: DEFAULT_VOCAL_PRESENCE,
      transpose: DEFAULT_TRANSPOSE,
      speed: DEFAULT_SPEED,
      progress: DEFAULT_PROGRESS,
    });

    // Updating Song B does not alter Song A
    saveSongSettings("song-b", { transpose: 3, progress: 15.2 }, storage);
    expect(loadSongSettings("song-a", storage)).toEqual({
      vocalPresence: 0,
      transpose: -4,
      speed: 1.25,
      progress: 73.45,
    });
    expect(loadSongSettings("song-b", storage)).toEqual({
      vocalPresence: DEFAULT_VOCAL_PRESENCE,
      transpose: 3,
      speed: DEFAULT_SPEED,
      progress: 15.2,
    });
  });

  it("clamps presets and resets progress to 0 when near or past the end of a track", () => {
    const storage = createMemoryStorage();

    expect(clampVocalPresence(-0.4)).toBe(0);
    expect(clampVocalPresence(1.9)).toBe(1);
    expect(clampProgress(-5, 180)).toBe(0);
    expect(clampProgress(42.345, 180)).toBe(42.35);
    expect(clampProgress(179.6, 180)).toBe(0);
    expect(clampProgress(180, 180)).toBe(0);

    saveSongSettings(
      "song-a",
      { vocalPresence: 1.5, transpose: 42, speed: 0.1, progress: 99 },
      storage
    );
    expect(loadSongSettings("song-a", storage)).toEqual({
      vocalPresence: 1,
      transpose: 12,
      speed: 0.5,
      progress: 99,
    });

    // Delete removes only the deleted song's saved settings
    saveSongSettings("song-b", { transpose: -2 }, storage);
    deleteSongSettings("song-a", storage);
    expect(loadSongSettings("song-a", storage)).toEqual(getDefaultSongSettings());
    expect(loadSongSettings("song-b", storage).transpose).toBe(-2);
  });
});

describe("playerSettings - keyboard shortcuts (macOS & Windows)", () => {
  const buttonTarget = { tagName: "BUTTON" };
  const textInputTarget = { tagName: "INPUT", type: "text" };
  const searchInputTarget = { tagName: "INPUT", type: "search" };
  const textareaTarget = { tagName: "TEXTAREA" };
  const rangeInputTarget = { tagName: "INPUT", type: "range" };
  const seekSliderTarget = {
    tagName: "DIV",
    getAttribute: (name: string) => (name === "role" ? "slider" : null),
  };
  const separatorTarget = {
    tagName: "DIV",
    getAttribute: (name: string) => (name === "role" ? "separator" : null),
  };

  it("identifies editable targets and slider/separator targets accurately", () => {
    expect(isEditableKeyboardTarget(textInputTarget)).toBe(true);
    expect(isEditableKeyboardTarget(searchInputTarget)).toBe(true);
    expect(isEditableKeyboardTarget(textareaTarget)).toBe(true);
    expect(isEditableKeyboardTarget({ isContentEditable: true })).toBe(true);
    expect(isEditableKeyboardTarget(rangeInputTarget)).toBe(false);
    expect(isEditableKeyboardTarget(buttonTarget)).toBe(false);

    expect(isSliderOrSeparatorTarget(rangeInputTarget)).toBe(true);
    expect(isSliderOrSeparatorTarget(seekSliderTarget)).toBe(true);
    expect(isSliderOrSeparatorTarget(separatorTarget)).toBe(true);
    expect(isSliderOrSeparatorTarget(buttonTarget)).toBe(false);
  });

  it("handles Spacebar and K for play/pause outside text inputs and modals", () => {
    expect(
      resolvePlayerKeyboardCommand({ key: " ", code: "Space", target: buttonTarget })
    ).toEqual({ type: "toggle-play" });

    expect(
      resolvePlayerKeyboardCommand({
        key: " ",
        code: "Space",
        target: rangeInputTarget,
      })
    ).toEqual({ type: "toggle-play" });

    expect(
      resolvePlayerKeyboardCommand({
        key: " ",
        code: "Space",
        repeat: true,
        target: buttonTarget,
      })
    ).toBeNull();

    expect(
      resolvePlayerKeyboardCommand({ key: "k", target: buttonTarget })
    ).toEqual({ type: "toggle-play" });

    expect(
      resolvePlayerKeyboardCommand({
        key: " ",
        code: "Space",
        target: textInputTarget,
      })
    ).toBeNull();

    expect(
      resolvePlayerKeyboardCommand(
        { key: " ", code: "Space", target: buttonTarget },
        { modalOpen: true }
      )
    ).toBeNull();
  });

  it("resolves hardware media keys for play/pause and prev/next regardless of input focus", () => {
    expect(
      resolvePlayerKeyboardCommand({ key: "MediaPlayPause", target: textInputTarget })
    ).toEqual({ type: "toggle-play" });
    expect(
      resolvePlayerKeyboardCommand({ key: "MediaPlay", target: textInputTarget })
    ).toEqual({ type: "play" });
    expect(
      resolvePlayerKeyboardCommand({ key: "MediaPause", target: textInputTarget })
    ).toEqual({ type: "pause" });
    expect(
      resolvePlayerKeyboardCommand(
        { key: "MediaTrackPrevious", target: textInputTarget },
        { modalOpen: true }
      )
    ).toEqual({ type: "prev-track" });
    expect(
      resolvePlayerKeyboardCommand(
        { key: "MediaTrackNext", target: textInputTarget },
        { modalOpen: true }
      )
    ).toEqual({ type: "next-track" });
  });

  it("resolves Mac (Cmd+Arrows) and Windows (Ctrl+Arrows) prev/next shortcuts and arrow navigation", () => {
    // macOS Cmd + ArrowLeft / ArrowRight
    expect(
      resolvePlayerKeyboardCommand({
        key: "ArrowLeft",
        metaKey: true,
        target: rangeInputTarget,
      })
    ).toEqual({ type: "prev-track" });
    expect(
      resolvePlayerKeyboardCommand({
        key: "ArrowRight",
        metaKey: true,
        target: buttonTarget,
      })
    ).toEqual({ type: "next-track" });

    // Windows Ctrl + ArrowLeft / ArrowRight
    expect(
      resolvePlayerKeyboardCommand({
        key: "ArrowLeft",
        ctrlKey: true,
        target: buttonTarget,
      })
    ).toEqual({ type: "prev-track" });
    expect(
      resolvePlayerKeyboardCommand({
        key: "ArrowRight",
        ctrlKey: true,
        target: rangeInputTarget,
      })
    ).toEqual({ type: "next-track" });

    // Additional cross-platform prev/next shortcuts
    expect(
      resolvePlayerKeyboardCommand({ key: "PageUp", target: buttonTarget })
    ).toEqual({ type: "prev-track" });
    expect(
      resolvePlayerKeyboardCommand({ key: "PageDown", target: buttonTarget })
    ).toEqual({ type: "next-track" });
    expect(
      resolvePlayerKeyboardCommand({ key: "[", target: buttonTarget })
    ).toEqual({ type: "prev-track" });
    expect(
      resolvePlayerKeyboardCommand({ key: "]", target: buttonTarget })
    ).toEqual({ type: "next-track" });

    // Up/Down arrows trigger prev/next outside sliders, but defer to native controls inside sliders
    expect(
      resolvePlayerKeyboardCommand({ key: "ArrowUp", target: buttonTarget })
    ).toEqual({ type: "prev-track" });
    expect(
      resolvePlayerKeyboardCommand({ key: "ArrowDown", target: buttonTarget })
    ).toEqual({ type: "next-track" });
    expect(
      resolvePlayerKeyboardCommand({ key: "ArrowUp", target: rangeInputTarget })
    ).toBeNull();

    // Bare Left/Right arrows jump 5s outside sliders, but defer inside sliders/separators
    expect(
      resolvePlayerKeyboardCommand({ key: "ArrowLeft", target: buttonTarget })
    ).toEqual({ type: "jump", deltaSeconds: -5 });
    expect(
      resolvePlayerKeyboardCommand({ key: "ArrowRight", target: buttonTarget })
    ).toEqual({ type: "jump", deltaSeconds: 5 });
    expect(
      resolvePlayerKeyboardCommand({ key: "ArrowLeft", target: seekSliderTarget })
    ).toBeNull();
    expect(
      resolvePlayerKeyboardCommand({ key: "ArrowRight", target: separatorTarget })
    ).toBeNull();
  });
});

describe("playerSettings - circular song navigation and drag-and-drop reordering", () => {
  const s1 = makeSong("s1");
  const s2 = makeSong("s2");
  const s3 = makeSong("s3");
  const s4 = makeSong("s4");

  it("navigates to adjacent prev/next songs with circular wraparound", () => {
    const list = [s1, s2, s3];
    expect(getAdjacentSong([], null, "next")).toBeNull();
    expect(getAdjacentSong([s1], "s1", "next")).toBeNull();
    expect(getAdjacentSong([s1], null, "next")?.id).toBe("s1");

    expect(getAdjacentSong(list, "s1", "next")?.id).toBe("s2");
    expect(getAdjacentSong(list, "s3", "next")?.id).toBe("s1");
    expect(getAdjacentSong(list, "s1", "prev")?.id).toBe("s3");
    expect(getAdjacentSong(list, "s2", "prev")?.id).toBe("s1");
    expect(getAdjacentSong(list, null, "next")?.id).toBe("s1");
    expect(getAdjacentSong(list, null, "prev")?.id).toBe("s3");
  });

  it("computes drop insertion slot and target index accurately", () => {
    const rects = [
      { top: 100, height: 60 }, // midpoint 130
      { top: 164, height: 60 }, // midpoint 194
      { top: 228, height: 60 }, // midpoint 258
    ];

    expect(computeInsertionSlot(90, rects)).toBe(0);
    expect(computeInsertionSlot(129, rects)).toBe(0);
    expect(computeInsertionSlot(131, rects)).toBe(1);
    expect(computeInsertionSlot(195, rects)).toBe(2);
    expect(computeInsertionSlot(260, rects)).toBe(3);

    // Moving item 0 down
    expect(slotToTargetIndex(0, 0, 3)).toBe(0);
    expect(slotToTargetIndex(1, 0, 3)).toBe(0); // no-op right below itself
    expect(slotToTargetIndex(2, 0, 3)).toBe(1);
    expect(slotToTargetIndex(3, 0, 3)).toBe(2);

    // Moving item 2 up
    expect(slotToTargetIndex(0, 2, 3)).toBe(0);
    expect(slotToTargetIndex(1, 2, 3)).toBe(1);
    expect(slotToTargetIndex(2, 2, 3)).toBe(2); // no-op
    expect(slotToTargetIndex(3, 2, 3)).toBe(2); // no-op
  });

  it("reorders full and filtered song lists while preserving hidden items", () => {
    const list = [s1, s2, s3, s4];

    expect(reorderSongList(list, "s1", 2).map((s) => s.id)).toEqual([
      "s2",
      "s3",
      "s1",
      "s4",
    ]);

    expect(reorderSongList(list, "s4", 0).map((s) => s.id)).toEqual([
      "s4",
      "s1",
      "s2",
      "s3",
    ]);

    // Filtered list hides s2: visible is [s1, s3, s4], drag s1 to end (index 2)
    expect(
      reorderSongList(list, "s1", 2, ["s1", "s3", "s4"]).map((s) => s.id)
    ).toEqual(["s3", "s2", "s4", "s1"]);
  });

  it("persists and applies saved song order without losing new songs", () => {
    const storage = createMemoryStorage();
    saveSongOrder(["s3", "s1", "s2"], storage);
    expect(storage.getItem(SONG_ORDER_STORAGE_KEY)).toBe('["s3","s1","s2"]');
    expect(loadSavedSongOrder(storage)).toEqual(["s3", "s1", "s2"]);

    // s4 is newly added and placed ahead of the previously ordered songs
    const ordered = applySavedSongOrder([s1, s2, s3, s4], loadSavedSongOrder(storage));
    expect(ordered.map((s) => s.id)).toEqual(["s4", "s3", "s1", "s2"]);
  });
});
