import { describe, it, expect } from "bun:test";
import {
  CENTER_MIN_WIDTH,
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  resolveSidebarWidths,
} from "./sidebarResize";

describe("sidebarResize - clampSidebarWidth", () => {
  it("clamps below minWidth and above maxWidth", () => {
    expect(
      clampSidebarWidth({
        desiredWidth: 100,
        minWidth: LEFT_SIDEBAR_MIN_WIDTH,
        maxWidth: LEFT_SIDEBAR_MAX_WIDTH,
        viewportWidth: 1440,
        otherSidebarWidth: 320,
      })
    ).toBe(LEFT_SIDEBAR_MIN_WIDTH);

    expect(
      clampSidebarWidth({
        desiredWidth: 900,
        minWidth: LEFT_SIDEBAR_MIN_WIDTH,
        maxWidth: LEFT_SIDEBAR_MAX_WIDTH,
        viewportWidth: 1600,
        otherSidebarWidth: 320,
      })
    ).toBe(LEFT_SIDEBAR_MAX_WIDTH);
  });

  it("caps growth so the center workspace keeps at least CENTER_MIN_WIDTH", () => {
    const viewportWidth = 1280;
    const otherSidebarWidth = 320;
    const expectedMax = viewportWidth - otherSidebarWidth - CENTER_MIN_WIDTH; // 440

    expect(
      clampSidebarWidth({
        desiredWidth: 480,
        minWidth: LEFT_SIDEBAR_MIN_WIDTH,
        maxWidth: LEFT_SIDEBAR_MAX_WIDTH,
        viewportWidth,
        otherSidebarWidth,
      })
    ).toBe(expectedMax);
  });

  it("allows full maxWidth when the opposite sidebar is closed", () => {
    expect(
      clampSidebarWidth({
        desiredWidth: 500,
        minWidth: LEFT_SIDEBAR_MIN_WIDTH,
        maxWidth: LEFT_SIDEBAR_MAX_WIDTH,
        viewportWidth: 1280,
        otherSidebarWidth: 0,
      })
    ).toBe(LEFT_SIDEBAR_MAX_WIDTH);
  });
});

describe("sidebarResize - resolveSidebarWidths", () => {
  it("keeps default widths at 1280px with both sidebars open", () => {
    expect(
      resolveSidebarWidths({
        leftWidth: LEFT_SIDEBAR_DEFAULT_WIDTH,
        rightWidth: RIGHT_SIDEBAR_DEFAULT_WIDTH,
        rightOpen: true,
        viewportWidth: 1280,
      })
    ).toEqual({
      leftWidth: 320,
      rightWidth: 320,
    });
  });

  it("shrinks sidebars gracefully when viewport narrows so center stays usable", () => {
    const resolved = resolveSidebarWidths({
      leftWidth: 480,
      rightWidth: 500,
      rightOpen: true,
      viewportWidth: 1080,
    });

    expect(resolved.leftWidth).toBeGreaterThanOrEqual(LEFT_SIDEBAR_MIN_WIDTH);
    expect(resolved.rightWidth).toBeGreaterThanOrEqual(RIGHT_SIDEBAR_MIN_WIDTH);
    expect(1080 - resolved.leftWidth - resolved.rightWidth).toBeGreaterThanOrEqual(
      CENTER_MIN_WIDTH
    );
  });

  it("preserves right sidebar preference when lyrics panel is closed", () => {
    expect(
      resolveSidebarWidths({
        leftWidth: 480,
        rightWidth: 420,
        rightOpen: false,
        viewportWidth: 1280,
      })
    ).toEqual({
      leftWidth: 480,
      rightWidth: 420,
    });
  });
});
