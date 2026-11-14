import { clampSpeed, clampTranspose } from "./audioDsp";
import { Song } from "./types";

export const SONG_SETTINGS_STORAGE_KEY = "pitch-maniac:song-settings";
export const SONG_ORDER_STORAGE_KEY = "pitch-maniac:song-order";

export const DEFAULT_VOCAL_PRESENCE = 0.8;
export const DEFAULT_TRANSPOSE = 0;
export const DEFAULT_SPEED = 1.0;
export const DEFAULT_PROGRESS = 0;

export interface SliderSettings {
  vocalPresence: number;
  transpose: number;
  speed: number;
}

export interface SongSettings extends SliderSettings {
  progress: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }
  return null;
}

export function clampVocalPresence(val: number): number {
  if (!Number.isFinite(val)) return DEFAULT_VOCAL_PRESENCE;
  return Math.round(Math.max(0, Math.min(1, val)) * 100) / 100;
}

export function clampProgress(seconds: number, duration?: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_PROGRESS;
  if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
    if (seconds >= Math.max(0, duration - 0.5)) {
      return DEFAULT_PROGRESS;
    }
    return Math.round(Math.min(duration, seconds) * 100) / 100;
  }
  return Math.round(seconds * 100) / 100;
}

export function getDefaultSongSettings(): SongSettings {
  return {
    vocalPresence: DEFAULT_VOCAL_PRESENCE,
    transpose: DEFAULT_TRANSPOSE,
    speed: DEFAULT_SPEED,
    progress: DEFAULT_PROGRESS,
  };
}

function saveSetting(
  storage: StorageLike | null,
  key: string,
  value: string
): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage write errors (e.g. quota exceeded or private mode)
  }
}

type SongSettingsMap = Record<string, Partial<SongSettings>>;

function readSongSettingsMap(storage: StorageLike | null): SongSettingsMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(SONG_SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as SongSettingsMap;
  } catch {
    return {};
  }
}

function normalizeSongSettings(raw?: Partial<SongSettings> | null): SongSettings {
  if (!raw || typeof raw !== "object") {
    return getDefaultSongSettings();
  }

  return {
    vocalPresence:
      typeof raw.vocalPresence === "number" && Number.isFinite(raw.vocalPresence)
        ? clampVocalPresence(raw.vocalPresence)
        : DEFAULT_VOCAL_PRESENCE,
    transpose:
      typeof raw.transpose === "number" && Number.isFinite(raw.transpose)
        ? clampTranspose(raw.transpose)
        : DEFAULT_TRANSPOSE,
    speed:
      typeof raw.speed === "number" && Number.isFinite(raw.speed)
        ? clampSpeed(raw.speed)
        : DEFAULT_SPEED,
    progress:
      typeof raw.progress === "number" && Number.isFinite(raw.progress)
        ? clampProgress(raw.progress)
        : DEFAULT_PROGRESS,
  };
}

export function loadSongSettings(
  songId: string | null | undefined,
  storage: StorageLike | null = getDefaultStorage()
): SongSettings {
  if (!songId) return getDefaultSongSettings();
  const map = readSongSettingsMap(storage);
  return normalizeSongSettings(map[songId]);
}

export function saveSongSettings(
  songId: string,
  patch: Partial<SongSettings>,
  storage: StorageLike | null = getDefaultStorage()
): SongSettings {
  const map = readSongSettingsMap(storage);
  const current = normalizeSongSettings(map[songId]);
  const next = normalizeSongSettings({
    vocalPresence:
      patch.vocalPresence !== undefined ? patch.vocalPresence : current.vocalPresence,
    transpose: patch.transpose !== undefined ? patch.transpose : current.transpose,
    speed: patch.speed !== undefined ? patch.speed : current.speed,
    progress: patch.progress !== undefined ? patch.progress : current.progress,
  });

  map[songId] = next;
  saveSetting(storage, SONG_SETTINGS_STORAGE_KEY, JSON.stringify(map));
  return next;
}

export function saveSongProgress(
  songId: string,
  seconds: number,
  duration?: number,
  storage: StorageLike | null = getDefaultStorage()
): SongSettings {
  return saveSongSettings(
    songId,
    { progress: clampProgress(seconds, duration) },
    storage
  );
}

export function deleteSongSettings(
  songId: string,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!songId) return;
  const map = readSongSettingsMap(storage);
  if (!(songId in map)) return;
  delete map[songId];
  saveSetting(storage, SONG_SETTINGS_STORAGE_KEY, JSON.stringify(map));
}

interface EventTargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  role?: string | null;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
}

const NON_TEXT_INPUT_TYPES = new Set([
  "range",
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "file",
  "color",
  "image",
  "hidden",
]);

export function isEditableKeyboardTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as EventTargetLike;

  if (el.isContentEditable === true) return true;
  const contentEditableAttr = el.getAttribute?.("contenteditable");
  if (
    contentEditableAttr === "" ||
    contentEditableAttr === "true" ||
    contentEditableAttr === "plaintext-only"
  ) {
    return true;
  }

  const tag = (el.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const inputType = (el.type || el.getAttribute?.("type") || "text").toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(inputType);
  }

  return false;
}

export function isSliderOrSeparatorTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as EventTargetLike;

  const tag = (el.tagName || "").toUpperCase();
  if (tag === "INPUT") {
    const inputType = (el.type || el.getAttribute?.("type") || "").toLowerCase();
    if (inputType === "range") return true;
  }

  const role = el.getAttribute?.("role") ?? el.role ?? null;
  if (role === "slider" || role === "separator") return true;

  if (typeof el.closest === "function") {
    if (el.closest('[role="slider"], [role="separator"], input[type="range"]')) {
      return true;
    }
  }

  return false;
}

export interface KeyboardEventLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  target?: unknown;
}

export type PlayerKeyboardCommand =
  | { type: "toggle-play" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "prev-track" }
  | { type: "next-track" }
  | { type: "jump"; deltaSeconds: number };

export function isSpaceKey(event: Pick<KeyboardEventLike, "key" | "code">): boolean {
  return event.code === "Space" || event.key === " " || event.key === "Spacebar";
}

export function resolvePlayerKeyboardCommand(
  event: KeyboardEventLike,
  context?: {
    isEditableTarget?: boolean;
    isSliderOrSeparatorTarget?: boolean;
    modalOpen?: boolean;
  }
): PlayerKeyboardCommand | null {
  if (event.isComposing) return null;

  // Dedicated hardware media keys work across macOS and Windows regardless of focus
  if (event.key === "MediaPlayPause") {
    return event.repeat ? null : { type: "toggle-play" };
  }
  if (event.key === "MediaPlay") {
    return event.repeat ? null : { type: "play" };
  }
  if (event.key === "MediaPause") {
    return event.repeat ? null : { type: "pause" };
  }
  if (event.key === "MediaTrackPrevious") {
    return event.repeat ? null : { type: "prev-track" };
  }
  if (event.key === "MediaTrackNext") {
    return event.repeat ? null : { type: "next-track" };
  }

  const modalOpen = Boolean(context?.modalOpen);
  const isEditable =
    context?.isEditableTarget ?? isEditableKeyboardTarget(event.target);

  if (modalOpen || isEditable) {
    return null;
  }

  const meta = Boolean(event.metaKey);
  const ctrl = Boolean(event.ctrlKey);
  const alt = Boolean(event.altKey);
  const shift = Boolean(event.shiftKey);
  const isSliderOrSep =
    context?.isSliderOrSeparatorTarget ??
    isSliderOrSeparatorTarget(event.target);

  // Spacebar -> Play / Pause (without modifiers)
  if (isSpaceKey(event) && !meta && !ctrl && !alt) {
    return event.repeat ? null : { type: "toggle-play" };
  }

  // K -> Play / Pause (media convention)
  if (
    (event.key === "k" || event.key === "K") &&
    !meta &&
    !ctrl &&
    !alt &&
    !shift
  ) {
    return event.repeat ? null : { type: "toggle-play" };
  }

  // Previous / Next track across macOS (Cmd + Left/Right) and Windows (Ctrl + Left/Right),
  // plus Alt/Shift + Left/Right, PageUp/PageDown, [/], and ArrowUp/ArrowDown outside sliders
  const hasPrevNextModifier =
    (meta && !ctrl && !alt) ||
    (ctrl && !meta && !alt) ||
    (alt && !meta && !ctrl) ||
    (shift && !meta && !ctrl && !alt);

  if (event.key === "ArrowLeft" && hasPrevNextModifier) {
    return event.repeat ? null : { type: "prev-track" };
  }
  if (event.key === "ArrowRight" && hasPrevNextModifier) {
    return event.repeat ? null : { type: "next-track" };
  }

  if (!meta && !ctrl && !alt && !shift) {
    if (event.key === "PageUp" || event.key === "[") {
      return event.repeat ? null : { type: "prev-track" };
    }
    if (event.key === "PageDown" || event.key === "]") {
      return event.repeat ? null : { type: "next-track" };
    }

    if (!isSliderOrSep) {
      if (event.key === "ArrowUp") {
        return event.repeat ? null : { type: "prev-track" };
      }
      if (event.key === "ArrowDown") {
        return event.repeat ? null : { type: "next-track" };
      }
      if (event.key === "ArrowLeft") {
        return { type: "jump", deltaSeconds: -5 };
      }
      if (event.key === "ArrowRight") {
        return { type: "jump", deltaSeconds: 5 };
      }
    }
  }

  return null;
}

export function getAdjacentSong(
  songs: Song[],
  activeSongId: string | null,
  direction: "prev" | "next"
): Song | null {
  if (songs.length === 0) return null;

  const currentIndex = activeSongId
    ? songs.findIndex((s) => s.id === activeSongId)
    : -1;

  if (currentIndex === -1) {
    return direction === "next" ? songs[0] : songs[songs.length - 1];
  }

  if (songs.length === 1) {
    return null;
  }

  const offset = direction === "next" ? 1 : -1;
  const nextIndex = (currentIndex + offset + songs.length) % songs.length;
  return songs[nextIndex];
}

export function computeInsertionSlot(
  pointerClientY: number,
  itemRects: Array<{ top: number; height: number }>
): number {
  for (let i = 0; i < itemRects.length; i++) {
    const midpoint = itemRects[i].top + itemRects[i].height / 2;
    if (pointerClientY < midpoint) {
      return i;
    }
  }
  return itemRects.length;
}

export function slotToTargetIndex(
  slotIndex: number,
  fromIndex: number,
  itemCount: number
): number {
  if (itemCount <= 0 || fromIndex < 0 || fromIndex >= itemCount) {
    return 0;
  }
  const clampedSlot = Math.max(0, Math.min(itemCount, Math.round(slotIndex)));
  const rawTarget = clampedSlot > fromIndex ? clampedSlot - 1 : clampedSlot;
  return Math.max(0, Math.min(itemCount - 1, rawTarget));
}

export function reorderSongList(
  songs: Song[],
  draggedSongId: string,
  targetIndex: number,
  visibleSongIds?: string[]
): Song[] {
  if (songs.length <= 1) return songs;

  if (!visibleSongIds || visibleSongIds.length === songs.length) {
    const fromIndex = songs.findIndex((s) => s.id === draggedSongId);
    if (fromIndex === -1) return songs;
    const clampedTarget = Math.max(
      0,
      Math.min(songs.length - 1, Math.round(targetIndex))
    );
    if (clampedTarget === fromIndex) return songs;

    const next = [...songs];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(clampedTarget, 0, moved);
    return next;
  }

  const songMap = new Map(songs.map((s) => [s.id, s]));
  const visibleSongs: Song[] = [];
  const visibleSet = new Set<string>();
  for (const id of visibleSongIds) {
    if (visibleSet.has(id)) continue;
    const match = songMap.get(id);
    if (match) {
      visibleSet.add(id);
      visibleSongs.push(match);
    }
  }

  const fromVisIdx = visibleSongs.findIndex((s) => s.id === draggedSongId);
  if (fromVisIdx === -1) return songs;

  const clampedTarget = Math.max(
    0,
    Math.min(visibleSongs.length - 1, Math.round(targetIndex))
  );
  if (clampedTarget === fromVisIdx) return songs;

  const reorderedVisible = [...visibleSongs];
  const [moved] = reorderedVisible.splice(fromVisIdx, 1);
  reorderedVisible.splice(clampedTarget, 0, moved);

  let visCursor = 0;
  return songs.map((song) => {
    if (visibleSet.has(song.id)) {
      return reorderedVisible[visCursor++];
    }
    return song;
  });
}

export function loadSavedSongOrder(
  storage: StorageLike | null = getDefaultStorage()
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SONG_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function saveSongOrder(
  songIds: string[],
  storage: StorageLike | null = getDefaultStorage()
): void {
  saveSetting(storage, SONG_ORDER_STORAGE_KEY, JSON.stringify(songIds));
}

export function applySavedSongOrder(songs: Song[], savedIds: string[]): Song[] {
  if (songs.length <= 1 || savedIds.length === 0) return songs;

  const rank = new Map<string, number>();
  savedIds.forEach((id, idx) => {
    if (!rank.has(id)) {
      rank.set(id, idx);
    }
  });

  const unknown: Song[] = [];
  const known: Song[] = [];
  for (const song of songs) {
    if (rank.has(song.id)) {
      known.push(song);
    } else {
      unknown.push(song);
    }
  }

  known.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...unknown, ...known];
}
