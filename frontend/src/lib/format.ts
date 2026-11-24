import { DEFAULT_COVER_URL } from "../lib/api";

const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat("vi-VN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const INTEGER_FORMATTER = new Intl.NumberFormat("vi-VN");

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value < 1000) return INTEGER_FORMATTER.format(value);
  return COMPACT_NUMBER_FORMATTER.format(value);
}

export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return INTEGER_FORMATTER.format(value);
}

export function resolveCoverUrl(coverUrl: string | null | undefined): string {
  const trimmed = coverUrl?.trim();
  return trimmed ? trimmed : DEFAULT_COVER_URL;
}

export function formatChapterNumber(chapterNumber: number): string {
  if (!Number.isFinite(chapterNumber)) return "0";
  return Number.isInteger(chapterNumber) ? String(chapterNumber) : String(chapterNumber);
}

const CHAPTER_PREFIX_REGEX = /^chương\s+\d+(?:\.\d+)?\s*[:—–-]\s*/i;

export function stripChapterPrefix(title: string): string {
  const cleaned = title.trim().replace(CHAPTER_PREFIX_REGEX, "");
  return cleaned || title.trim();
}

export interface StatusMeta {
  label: string;
  badgeClass: string;
}

export function getStatusMeta(status: string): StatusMeta {
  const normalized = status.trim().toLowerCase();

  if (normalized === "hoàn thành" || normalized === "completed") {
    return {
      label: "Hoàn thành",
      badgeClass:
        "border-[#06B6D4]/40 bg-[#0A0B10]/85 text-[#22D3EE] shadow-[0_2px_10px_rgba(6,182,212,0.2)]",
    };
  }

  if (normalized === "tạm ngưng" || normalized === "hiatus" || normalized === "paused") {
    return {
      label: "Tạm ngưng",
      badgeClass:
        "border-amber-400/40 bg-[#0A0B10]/85 text-amber-300 shadow-[0_2px_10px_rgba(245,158,11,0.18)]",
    };
  }

  return {
    label: status.trim() || "Đang tiến hành",
    badgeClass:
      "border-[#E63946]/45 bg-[#0A0B10]/85 text-[#FF6B78] shadow-[0_2px_10px_rgba(230,57,70,0.22)]",
  };
}

export const MANGA_STATUS_OPTIONS = [
  "Đang tiến hành",
  "Hoàn thành",
  "Tạm ngưng",
] as const;
