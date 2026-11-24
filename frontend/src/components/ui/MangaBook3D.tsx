import { useState } from "react";
import { use3DTilt } from "../../hooks/use3DTilt";

const DEFAULT_COVER_URL = "/covers/default-manga.svg";

export interface MangaBook3DProps {
  coverUrl: string;
  title: string;
  variant?: "crimson" | "cyan";
  size?: "sm" | "lg";
}

export function MangaBook3D({
  coverUrl,
  title,
  variant = "crimson",
  size = "lg",
}: MangaBook3DProps) {
  const { ref, onPointerEnter, onPointerMove, onPointerLeave } =
    use3DTilt<HTMLDivElement>({
      maxTilt: 10,
      liftY: -4,
      restRx: 1.5,
      restRy: -8,
    });

  const normalizedSrc = coverUrl?.trim() ? coverUrl.trim() : DEFAULT_COVER_URL;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const displaySrc =
    failedSrc === normalizedSrc ? DEFAULT_COVER_URL : normalizedSrc;

  return (
    <div className="ms-3d-stage">
      <div
        ref={ref}
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        className={`ms-book-3d ms-book-3d-${size} ms-book-3d-${variant}`}
      >
        <div className="ms-book-3d-face relative aspect-[3/4] w-full">
          <img
            src={displaySrc}
            alt={title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => {
              if (displaySrc !== DEFAULT_COVER_URL) {
                setFailedSrc(normalizedSrc);
              }
            }}
            className="h-full w-full object-cover"
          />
          <div className="ms-3d-glare" aria-hidden="true" />
        </div>
      </div>
      <div className="ms-book-3d-shadow" aria-hidden="true" />
    </div>
  );
}
