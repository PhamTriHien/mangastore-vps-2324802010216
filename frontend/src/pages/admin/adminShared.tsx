import type { SyntheticEvent } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { MangaIcon } from "../../components/ui/MangaIcon";

export const DEFAULT_COVER_URL = "/covers/default-manga.svg";

export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return fallback;
}

export function handleCoverError(event: SyntheticEvent<HTMLImageElement>): void {
  const img = event.currentTarget;
  if (img.dataset.fallbackApplied === "1") return;
  img.dataset.fallbackApplied = "1";
  img.src = DEFAULT_COVER_URL;
}

export function resolveImageUrl(url: string | null | undefined): string {
  const cleaned = (url ?? "").trim();
  return cleaned || DEFAULT_COVER_URL;
}

export function getRoleLabel(roleId: number, roleName?: string | null): string {
  if (roleName && roleName.trim()) return roleName;
  if (roleId === 1) return "Quản trị viên";
  if (roleId === 2) return "Nhân viên";
  return "Khách hàng";
}

export function getRoleBadgeClass(roleId: number): string {
  if (roleId === 1) {
    return "border-[#E63946]/40 bg-[#E63946]/15 text-[#FF6B77]";
  }
  if (roleId === 2) {
    return "border-cyan-500/35 bg-cyan-500/15 text-[#22D3EE]";
  }
  return "border-slate-500/35 bg-slate-500/15 text-slate-300";
}

export function AdminLoadingState({ label = "Đang tải dữ liệu..." }: { label?: string }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#131722]/85 p-10 text-slate-300">
      <Loader2 className="h-8 w-8 animate-spin text-[#E63946]" />
      <p className="text-sm font-medium text-slate-400">{label}</p>
    </div>
  );
}

export function AdminErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-[#E63946]/35 bg-[#131722]/90 px-6 py-12 text-center shadow-xl">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#E63946]/40 bg-[#E63946]/15 text-[#FF6B77]">
        <MangaIcon name="alert-triangle" className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-lg font-bold text-[#F5F6FA]">Không thể tải dữ liệu</h2>
      <p className="mt-1.5 max-w-md text-sm text-[#A3AEC2]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="ms-btn-2d ms-btn-2d-crimson mt-5 inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold text-white"
      >
        <MangaIcon name="refresh-cw" className="h-4 w-4" />
        <span>Thử lại</span>
      </button>
    </div>
  );
}

export function AdminForbiddenCard({
  message = "Chỉ Quản trị viên cấp cao mới có quyền truy cập khu vực này.",
}: {
  message?: string;
}) {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-3xl border border-[#E63946]/35 bg-[#131722]/90 p-8 text-center shadow-2xl backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#E63946]/40 bg-[#E63946]/15 text-[#FF6B77]">
        <MangaIcon name="shield" className="h-7 w-7" />
      </div>
      <p className="mt-4 text-xs font-bold uppercase tracking-widest text-[#FF6B77]">
        403 · Không đủ quyền truy cập
      </p>
      <h1 className="mt-2 text-2xl font-bold text-[#F5F6FA]">Quyền truy cập bị từ chối</h1>
      <p className="mt-2 text-sm leading-relaxed text-[#A3AEC2]">{message}</p>
      <Link
        to="/admin"
        className="ms-btn-2d ms-btn-2d-crimson mt-6 inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold text-white"
      >
        <MangaIcon name="arrow-left" className="h-4 w-4" />
        <span>Quay lại Dashboard</span>
      </Link>
    </div>
  );
}
