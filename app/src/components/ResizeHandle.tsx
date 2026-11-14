import React, { useEffect, useRef, useState } from "react";

interface ResizeHandleProps {
  side: "left" | "right";
  width: number;
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  label: string;
  onResize: (desiredWidth: number) => void;
  onReset: () => void;
}

const KEYBOARD_STEP = 16;
const KEYBOARD_LARGE_STEP = 32;

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  side,
  width,
  minWidth,
  maxWidth,
  defaultWidth,
  label,
  onResize,
  onReset,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const startX = e.clientX;
    const startWidth = width;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setIsDragging(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta =
        side === "left"
          ? moveEvent.clientX - startX
          : startX - moveEvent.clientX;
      onResize(startWidth + delta);
    };

    const stopDragging = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      cleanupRef.current = null;
      setIsDragging(false);
    };

    cleanupRef.current = stopDragging;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onResize(side === "left" ? width - step : width + step);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onResize(side === "left" ? width + step : width - step);
    } else if (e.key === "Home") {
      e.preventDefault();
      onReset();
    }
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title={`Drag to resize • Double-click to reset (${defaultWidth}px)`}
      onPointerDown={handlePointerDown}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      className={`absolute top-0 bottom-0 w-3 z-20 cursor-col-resize group flex items-center justify-center focus:outline-none touch-none ${
        side === "left" ? "-right-1.5" : "-left-1.5"
      }`}
    >
      <div
        className={`w-[2px] h-full transition-colors duration-150 ${
          isDragging
            ? "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]"
            : "bg-transparent group-hover:bg-cyan-400/60 group-focus-visible:bg-cyan-400"
        }`}
      />
      <div
        className={`absolute w-1 h-8 rounded-full transition-opacity duration-150 pointer-events-none ${
          isDragging
            ? "opacity-100 bg-cyan-300"
            : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 bg-cyan-400/80"
        }`}
      />
    </div>
  );
};
