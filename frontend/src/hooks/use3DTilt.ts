import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

const TILT_MEDIA_QUERY =
  "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

export interface Use3DTiltOptions {
  maxTilt?: number;
  liftZ?: number;
  restRx?: number;
  restRy?: number;
}

export interface Use3DTiltReturn<T extends HTMLElement> {
  ref: RefObject<T | null>;
  onPointerEnter: (event: ReactPointerEvent<T>) => void;
  onPointerMove: (event: ReactPointerEvent<T>) => void;
  onPointerLeave: () => void;
}

function resetTiltVariables(
  el: HTMLElement,
  restRx: number,
  restRy: number
): void {
  el.removeAttribute("data-tilting");
  el.style.setProperty("--rx", `${restRx}deg`);
  el.style.setProperty("--ry", `${restRy}deg`);
  el.style.setProperty("--glare-x", "50%");
  el.style.setProperty("--glare-y", "50%");
  el.style.setProperty("--tz", "0px");
}

export function use3DTilt<T extends HTMLElement = HTMLDivElement>(
  options: Use3DTiltOptions = {}
): Use3DTiltReturn<T> {
  const { maxTilt = 9, liftZ = 14, restRx = 0, restRy = 0 } = options;

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
      if (!mediaQuery.matches && ref.current) {
        cancelPendingFrame();
        resetTiltVariables(ref.current, 0, 0);
      } else if (mediaQuery.matches && ref.current) {
        resetTiltVariables(ref.current, restRx, restRy);
      }
    };

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);

    return () => {
      mediaQuery.removeEventListener("change", syncPreference);
      cancelPendingFrame();
    };
  }, [cancelPendingFrame, restRx, restRy]);

  const onPointerEnter = useCallback(() => {
    const el = ref.current;
    if (!enabledRef.current || !el) return;
    el.setAttribute("data-tilting", "true");
    el.style.setProperty("--tz", `${liftZ}px`);
  }, [liftZ]);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<T>) => {
      const el = ref.current;
      if (!enabledRef.current || !el) return;

      const clientX = event.clientX;
      const clientY = event.clientY;

      cancelPendingFrame();
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const target = ref.current;
        if (!target || !enabledRef.current) return;

        const rect = target.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const px = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const py = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));

        const rx = (0.5 - py) * 2 * maxTilt;
        const ry = (px - 0.5) * 2 * maxTilt;

        target.setAttribute("data-tilting", "true");
        target.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
        target.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
        target.style.setProperty("--glare-x", `${(px * 100).toFixed(1)}%`);
        target.style.setProperty("--glare-y", `${(py * 100).toFixed(1)}%`);
        target.style.setProperty("--tz", `${liftZ}px`);
      });
    },
    [cancelPendingFrame, liftZ, maxTilt]
  );

  const onPointerLeave = useCallback(() => {
    cancelPendingFrame();
    const el = ref.current;
    if (!el) return;

    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      const target = ref.current;
      if (!target) return;
      if (enabledRef.current) {
        resetTiltVariables(target, restRx, restRy);
      } else {
        resetTiltVariables(target, 0, 0);
      }
    });
  }, [cancelPendingFrame, restRx, restRy]);

  return {
    ref,
    onPointerEnter,
    onPointerMove,
    onPointerLeave,
  };
}
