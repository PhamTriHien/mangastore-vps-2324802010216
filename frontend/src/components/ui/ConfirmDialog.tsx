import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Xác nhận",
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[998] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ms-confirm-dialog-title"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="ms-panel-2d w-full max-w-md rounded-2xl border border-white/15 bg-[#131722] p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                danger
                  ? "border-[#E63946]/40 bg-[#E63946]/15 text-[#FF6B77]"
                  : "border-cyan-400/40 bg-cyan-500/15 text-cyan-300"
              }`}
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="ms-confirm-dialog-title"
                className="font-display text-base font-bold text-[#F5F6FA]"
              >
                {title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#A3AEC2]">
                {message}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Đóng hộp thoại"
            className="rounded-lg p-1.5 text-[#A3AEC2] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="ms-btn-2d ms-btn-2d-dark rounded-xl border px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`ms-btn-2d rounded-xl border px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
              danger ? "ms-btn-2d-crimson" : "ms-btn-2d-cyan"
            }`}
          >
            {busy ? "Đang xử lý..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
