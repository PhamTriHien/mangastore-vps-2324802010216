import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

const DRAG_THRESHOLD_PX = 5;
const INTERACTIVE_SELECTOR = "button, input, textarea, select, option, label";

export interface UseDragScrollReturn<T extends HTMLElement> {
  ref: RefObject<T | null>;
  onMouseDown: (event: ReactMouseEvent<T>) => void;
  onMouseMove: (event: ReactMouseEvent<T>) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
}

export function useDragScroll<
  T extends HTMLElement = HTMLDivElement,
>(): UseDragScrollReturn<T> {
  const ref = useRef<T | null>(null);
  const isDownRef = useRef(false);
  const isDraggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const startXRef = useRef(0);
  const scrollStartRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!el.hasAttribute("data-drag-scroll")) {
      el.setAttribute("data-drag-scroll", "true");
    }

    const handleClickCapture = (event: MouseEvent) => {
      if (!suppressClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
      clearResetTimer();
    };

    const handleDragStart = (event: DragEvent) => {
      if (isDownRef.current || isDraggingRef.current) {
        event.preventDefault();
      }
    };

    el.addEventListener("click", handleClickCapture, true);
    el.addEventListener("dragstart", handleDragStart);

    return () => {
      clearResetTimer();
      el.removeEventListener("click", handleClickCapture, true);
      el.removeEventListener("dragstart", handleDragStart);
      el.removeAttribute("data-dragging");
    };
  }, [clearResetTimer]);

  const stopDrag = useCallback(() => {
    const el = ref.current;
    const wasDragging = isDraggingRef.current;

    isDownRef.current = false;
    isDraggingRef.current = false;
    el?.removeAttribute("data-dragging");

    if (wasDragging) {
      clearResetTimer();
      resetTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false;
        resetTimerRef.current = null;
      }, 0);
    }
  }, [clearResetTimer]);

  const onMouseDown = useCallback(
    (event: ReactMouseEvent<T>) => {
      if (event.button !== 0) return;
      const el = ref.current;
      if (!el) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest(INTERACTIVE_SELECTOR)) {
        isDownRef.current = false;
        isDraggingRef.current = false;
        return;
      }

      clearResetTimer();
      isDownRef.current = true;
      isDraggingRef.current = false;
      suppressClickRef.current = false;
      startXRef.current = event.clientX;
      scrollStartRef.current = el.scrollLeft;
    },
    [clearResetTimer]
  );

  const onMouseMove = useCallback((event: ReactMouseEvent<T>) => {
    if (!isDownRef.current) return;
    const el = ref.current;
    if (!el) return;

    const dx = event.clientX - startXRef.current;
    if (!isDraggingRef.current && Math.abs(dx) > DRAG_THRESHOLD_PX) {
      isDraggingRef.current = true;
      suppressClickRef.current = true;
      el.setAttribute("data-dragging", "true");
    }

    if (isDraggingRef.current) {
      event.preventDefault();
      el.scrollLeft = scrollStartRef.current - dx;
    }
  }, []);

  const onMouseUp = useCallback(() => {
    stopDrag();
  }, [stopDrag]);

  const onMouseLeave = useCallback(() => {
    stopDrag();
  }, [stopDrag]);

  return {
    ref,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
  };
}
