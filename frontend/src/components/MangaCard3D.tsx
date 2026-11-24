import { useState } from "react";
import { BookOpen, Eye, Pencil, Star, Trash2 } from "lucide-react";
import type { MangaOut } from "../types/manga";
import { use3DTilt } from "../hooks/use3DTilt";
import { DEFAULT_COVER_URL } from "../lib/api";
import { formatCompactNumber, getStatusMeta, resolveCoverUrl } from "../lib/format";

interface MangaCard3DProps {
  manga: MangaOut;
  isAuthenticated: boolean;
  onOpenDetail: (manga: MangaOut) => void;
  onEdit: (manga: MangaOut) => void;
  onDelete: (manga: MangaOut) => void;
}

export function MangaCard3D({
  manga,
  isAuthenticated,
  onOpenDetail,
  onEdit,
  onDelete,
}: MangaCard3DProps) {
  const { ref, onPointerEnter, onPointerMove, onPointerLeave } =
    use3DTilt<HTMLElement>({ maxTilt: 9, liftZ: 14 });

  const resolvedUrl = resolveCoverUrl(manga.cover_url);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const displaySrc = failedSrc === resolvedUrl ? DEFAULT_COVER_URL : resolvedUrl;
  const statusMeta = getStatusMeta(manga.status);

  return (
    <div className="ms-card-stage h-full">
      <article
        ref={ref}
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        className="ms-card-3d group flex h-full flex-col overflow-hidden rounded-2xl border border-[#232838] bg-[#131620] hover:border-[#343C54]"
      >
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#0D0F16]">
          <button
            type="button"
            onClick={() => onOpenDetail(manga)}
            aria-label={`Xem chi tiết và đọc ${manga.title}`}
            className="block h-full w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#06B6D4]"
          >
            <img
              src={displaySrc}
              alt={manga.title}
              loading="lazy"
              decoding="async"
              onError={() => {
                if (displaySrc !== DEFAULT_COVER_URL) {
                  setFailedSrc(resolvedUrl);
                }
              }}
              className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
            />
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#0A0B10] via-[#0A0B10]/55 to-transparent"
              aria-hidden="true"
            />
          </button>

          <span
            className={`pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-semibold backdrop-blur-sm ${statusMeta.badgeClass}`}
          >
            {statusMeta.label}
          </span>

          {isAuthenticated ? (
            <div className="absolute right-2.5 top-2.5 z-30 flex items-center gap-1.5">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(manga);
                }}
                aria-label={`Chỉnh sửa ${manga.title}`}
                title="Chỉnh sửa truyện"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-[#0A0B10]/80 text-[#E2E8F0] backdrop-blur-sm transition-colors hover:border-[#06B6D4]/60 hover:bg-[#06B6D4]/20 hover:text-white"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(manga);
                }}
                aria-label={`Xóa ${manga.title}`}
                title="Xóa truyện"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-[#0A0B10]/80 text-[#E2E8F0] backdrop-blur-sm transition-colors hover:border-[#E63946]/70 hover:bg-[#E63946]/25 hover:text-[#FF8A93]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          <div className="pointer-events-none absolute inset-x-2.5 bottom-2.5 flex items-center justify-between gap-2 text-xs font-medium text-[#F5F6FA]">
            <span className="inline-flex items-center gap-1 rounded-md bg-[#0A0B10]/75 px-2 py-0.5 backdrop-blur-sm">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              <span>{manga.rating.toFixed(1)}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-[#0A0B10]/75 px-2 py-0.5 text-[#CBD5E1] backdrop-blur-sm">
              <Eye className="h-3.5 w-3.5 text-[#06B6D4]" />
              <span>{formatCompactNumber(manga.views)}</span>
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onOpenDetail(manga)}
          className="flex flex-1 flex-col justify-between gap-3 p-3.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#06B6D4]"
        >
          <div>
            <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-[#F5F6FA] transition-colors group-hover:text-white">
              {manga.title}
            </h3>
            <p className="mt-1 truncate text-xs font-medium text-[#94A3B8]">
              {manga.author}
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="max-w-[58%] truncate rounded-lg border border-[#232838] bg-[#191D2A] px-2.5 py-0.5 text-[11px] font-medium text-[#CBD5E1]">
              {manga.genre}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#94A3B8]">
              <BookOpen className="h-3.5 w-3.5 text-[#E63946]" />
              <span>{manga.chapter_count} chương</span>
            </span>
          </div>
        </button>
      </article>
    </div>
  );
}
