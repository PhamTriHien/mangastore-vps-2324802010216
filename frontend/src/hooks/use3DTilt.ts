import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

const TILT_MEDIA_QUERY =
  "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

export interface Use3DTiltOptions {
  maxTilt?: number;
  liftY?: number;
  restRx?: number;
  restRy?: number;
}

export interface Use3DTiltReturn<T extends HTMLElement> {
  ref: RefObject<T | null>;
  onPointerEnter: (event: ReactPointerEvent<T>) => void;
  onPointerMove: (event: ReactPointerEvent<T>) => void;
  onPointerLeave: () => void;
}

export interface Use3DParallaxReturn<T extends HTMLElement> {
  ref: RefObject<T | null>;
  onPointerMove: (event: ReactPointerEvent<T>) => void;
  onPointerLeave: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isBlockedByDrag(el: HTMLElement): boolean {
  return Boolean(el.closest('[data-drag-scroll][data-dragging="true"]'));
}

function applyTiltReset(
  el: HTMLElement,
  enabled: boolean,
  restRx: number,
  restRy: number
): void {
  el.classList.remove("ms-tilting");
  if (enabled && (restRx !== 0 || restRy !== 0)) {
    el.style.setProperty("--ms-rx", `${restRx}deg`);
    el.style.setProperty("--ms-ry", `${restRy}deg`);
  } else {
    el.style.removeProperty("--ms-rx");
    el.style.removeProperty("--ms-ry");
  }
  el.style.removeProperty("--ms-ty");
  el.style.removeProperty("--ms-gx");
  el.style.removeProperty("--ms-gy");
}

export function use3DTilt<T extends HTMLElement = HTMLDivElement>(
  options: Use3DTiltOptions = {}
): Use3DTiltReturn<T> {
  const { maxTilt = 6, liftY = -4, restRx = 0, restRy = 0 } = options;

  const ref = useRef<T | null>(null);
  const enabledRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  const cancelPendingFrame = useCallback(() => {
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(TILT_MEDIA_QUERY);
    const syncPreference = () => {
      enabledRef.current = mediaQuery.matches;
      if (ref.current) {
        cancelPendingFrame();
        applyTiltReset(ref.current, mediaQuery.matches, restRx, restRy);
      }
    };

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);

    return () => {
      mediaQuery.removeEventListener("change", syncPreference);
      cancelPendingFrame();
    };
  }, [cancelPendingFrame, restRx, restRy]);

  const onPointerEnter = useCallback(
    (event: ReactPointerEvent<T>) => {
      const el = ref.current;
      if (!enabledRef.current || !el || event.pointerType === "touch") return;
      if (isBlockedByDrag(el)) {
        applyTiltReset(el, enabledRef.current, restRx, restRy);
        return;
      }
      el.classList.add("ms-tilting");
      el.style.setProperty("--ms-ty", `${liftY}px`);
    },
    [liftY, restRx, restRy]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<T>) => {
      const el = ref.current;
      if (!enabledRef.current || !el || event.pointerType === "touch") return;
      if (isBlockedByDrag(el)) {
        cancelPendingFrame();
        applyTiltReset(el, enabledRef.current, restRx, restRy);
        return;
      }

      const clientX = event.clientX;
      const clientY = event.clientY;

      cancelPendingFrame();
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const target = ref.current;
        if (!target || !enabledRef.current || isBlockedByDrag(target)) {
          if (target) {
            applyTiltReset(target, enabledRef.current, restRx, restRy);
          }
          return;
        }

        const rect = target.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
        const ny = clamp((clientY - rect.top) / rect.height, 0, 1);

        const rx = restRx + (0.5 - ny) * (maxTilt * 2);
        const ry = restRy + (nx - 0.5) * (maxTilt * 2);

        target.classList.add("ms-tilting");
        target.style.setProperty("--ms-rx", `${rx.toFixed(2)}deg`);
        target.style.setProperty("--ms-ry", `${ry.toFixed(2)}deg`);
        target.style.setProperty("--ms-ty", `${liftY}px`);
        target.style.setProperty("--ms-gx", `${(nx * 100).toFixed(1)}%`);
        target.style.setProperty("--ms-gy", `${(ny * 100).toFixed(1)}%`);
      });
    },
    [cancelPendingFrame, liftY, maxTilt, restRx, restRy]
  );

  const onPointerLeave = useCallback(() => {
    cancelPendingFrame();
    const el = ref.current;
    if (!el) return;
    applyTiltReset(el, enabledRef.current, restRx, restRy);
  }, [cancelPendingFrame, restRx, restRy]);

  return {
    ref,
    onPointerEnter,
    onPointerMove,
    onPointerLeave,
  };
}

export function use3DParallax<T extends HTMLElement = HTMLDivElement>(
  strength = 18
): Use3DParallaxReturn<T> {
  const ref = useRef<T | null>(null);
  const enabledRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  const cancelPendingFrame = useCallback(() => {
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const clearParallax = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    el.style.removeProperty("--ms-px");
    el.style.removeProperty("--ms-py");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(TILT_MEDIA_QUERY);
    const syncPreference = () => {
      enabledRef.current = mediaQuery.matches;
      if (!mediaQuery.matches) {
        cancelPendingFrame();
        clearParallax(ref.current);
      }
    };

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);

    return () => {
      mediaQuery.removeEventListener("change", syncPreference);
      cancelPendingFrame();
    };
  }, [cancelPendingFrame, clearParallax]);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<T>) => {
      const el = ref.current;
      if (!enabledRef.current || !el || event.pointerType === "touch") return;

      const clientX = event.clientX;
      const clientY = event.clientY;

      cancelPendingFrame();
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const target = ref.current;
        if (!target || !enabledRef.current) return;

        const rect = target.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const nx = clamp((clientX - rect.left) / rect.width, 0, 1) - 0.5;
        const ny = clamp((clientY - rect.top) / rect.height, 0, 1) - 0.5;

        target.style.setProperty("--ms-px", `${(nx * strength * 2).toFixed(2)}px`);
        target.style.setProperty("--ms-py", `${(ny * strength * 1.4).toFixed(2)}px`);
      });
    },
    [cancelPendingFrame, strength]
  );

  const onPointerLeave = useCallback(() => {
    cancelPendingFrame();
    clearParallax(ref.current);
  }, [cancelPendingFrame, clearParallax]);

  return {
    ref,
    onPointerMove,
    onPointerLeave,
  };
}
