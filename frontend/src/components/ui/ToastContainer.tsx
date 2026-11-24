import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useToast } from "../../contexts/ToastContext";
import type { ToastType } from "../../contexts/ToastContext";

const TOAST_STYLE_MAP: Record<
  ToastType,
  { containerClass: string; icon: ReactNode }
> = {
  success: {
    containerClass:
      "border-emerald-400/45 bg-gradient-to-r from-emerald-600/95 to-teal-700/95 text-white",
    icon: <CheckCircle2 className="h-5 w-5 shrink-0 text-white" />,
  },
  error: {
    containerClass:
      "border-[#E63946]/60 bg-gradient-to-r from-[#E63946]/95 to-rose-700/95 text-white",
    icon: <XCircle className="h-5 w-5 shrink-0 text-white" />,
  },
  warning: {
    containerClass:
      "border-amber-400/50 bg-gradient-to-r from-amber-500/95 to-orange-600/95 text-white",
    icon: <AlertTriangle className="h-5 w-5 shrink-0 text-white" />,
  },
  info: {
    containerClass:
      "border-cyan-400/35 bg-gradient-to-r from-[#1B2130]/95 to-[#131722]/95 text-[#F5F6FA]",
    icon: <Info className="h-5 w-5 shrink-0 text-cyan-300" />,
  },
};

export function ToastContainer() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-20 z-[1000] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2.5"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => {
        const meta = TOAST_STYLE_MAP[toast.type];
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-center gap-3 rounded-2xl border px-4 py-3.5 shadow-2xl backdrop-blur-xl transition-all ${meta.containerClass}`}
          >
            {meta.icon}
            <span className="flex-1 text-sm font-medium leading-snug">
              {toast.message}
            </span>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Đóng thông báo"
              className="rounded-lg p-1 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
