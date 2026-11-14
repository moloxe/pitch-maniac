export const LEFT_SIDEBAR_DEFAULT_WIDTH = 320;
export const LEFT_SIDEBAR_MIN_WIDTH = 240;
export const LEFT_SIDEBAR_MAX_WIDTH = 480;

export const RIGHT_SIDEBAR_DEFAULT_WIDTH = 320;
export const RIGHT_SIDEBAR_MIN_WIDTH = 280;
export const RIGHT_SIDEBAR_MAX_WIDTH = 560;

export const CENTER_MIN_WIDTH = 520;

export const LEFT_SIDEBAR_STORAGE_KEY = "pitch-maniac:left-sidebar-width";
export const RIGHT_SIDEBAR_STORAGE_KEY = "pitch-maniac:right-sidebar-width";

export interface ClampSidebarWidthOptions {
  desiredWidth: number;
  minWidth: number;
  maxWidth: number;
  viewportWidth: number;
  otherSidebarWidth: number;
  minCenterWidth?: number;
}

/**
 * Clamps a sidebar width to its UX bounds while reserving enough horizontal
 * space for the center pitch visualizer and player controls.
 */
export function clampSidebarWidth({
  desiredWidth,
  minWidth,
  maxWidth,
  viewportWidth,
  otherSidebarWidth,
  minCenterWidth = CENTER_MIN_WIDTH,
}: ClampSidebarWidthOptions): number {
  const finiteDesired = Number.isFinite(desiredWidth) ? desiredWidth : minWidth;
  const effectiveMax =
    viewportWidth > 0
      ? Math.min(maxWidth, Math.max(minWidth, viewportWidth - otherSidebarWidth - minCenterWidth))
      : maxWidth;

  return Math.round(Math.min(effectiveMax, Math.max(minWidth, finiteDesired)));
}

export interface ResolveSidebarWidthsOptions {
  leftWidth: number;
  rightWidth: number;
  rightOpen: boolean;
  viewportWidth: number;
}

/**
 * Resolves effective left and right sidebar widths for the current viewport,
 * shrinking gracefully if the window becomes narrower.
 */
export function resolveSidebarWidths({
  leftWidth,
  rightWidth,
  rightOpen,
  viewportWidth,
}: ResolveSidebarWidthsOptions): { leftWidth: number; rightWidth: number } {
  const clampedRight = rightOpen
    ? clampSidebarWidth({
        desiredWidth: rightWidth,
        minWidth: RIGHT_SIDEBAR_MIN_WIDTH,
        maxWidth: RIGHT_SIDEBAR_MAX_WIDTH,
        viewportWidth,
        otherSidebarWidth: LEFT_SIDEBAR_MIN_WIDTH,
      })
    : 0;

  const clampedLeft = clampSidebarWidth({
    desiredWidth: leftWidth,
    minWidth: LEFT_SIDEBAR_MIN_WIDTH,
    maxWidth: LEFT_SIDEBAR_MAX_WIDTH,
    viewportWidth,
    otherSidebarWidth: clampedRight,
  });

  if (!rightOpen) {
    return {
      leftWidth: clampedLeft,
      rightWidth: clampSidebarWidth({
        desiredWidth: rightWidth,
        minWidth: RIGHT_SIDEBAR_MIN_WIDTH,
        maxWidth: RIGHT_SIDEBAR_MAX_WIDTH,
        viewportWidth: 0,
        otherSidebarWidth: 0,
      }),
    };
  }

  // Re-clamp right against the resolved left width so both never exceed budget.
  const finalRight = clampSidebarWidth({
    desiredWidth: clampedRight,
    minWidth: RIGHT_SIDEBAR_MIN_WIDTH,
    maxWidth: RIGHT_SIDEBAR_MAX_WIDTH,
    viewportWidth,
    otherSidebarWidth: clampedLeft,
  });

  return { leftWidth: clampedLeft, rightWidth: finalRight };
}

export function loadSavedSidebarWidth(
  storageKey: string,
  fallback: number,
  minWidth: number,
  maxWidth: number
): number {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.round(Math.min(maxWidth, Math.max(minWidth, parsed)));
  } catch {
    return fallback;
  }
}

export function saveSidebarWidth(storageKey: string, width: number): void {
  try {
    window.localStorage.setItem(storageKey, String(Math.round(width)));
  } catch {
    // Ignore storage errors (e.g. private mode or restricted environments)
  }
}
