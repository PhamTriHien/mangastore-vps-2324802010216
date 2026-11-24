import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { StoreLayout } from "../components/layout/StoreLayout";
import { MangaIcon } from "../components/ui/MangaIcon";
import { useToast } from "../contexts/ToastContext";
import { apiClient } from "../lib/api";

const RESET_STORAGE_KEY = "ms_password_reset_state";

interface ResetWizardState {
  email?: string;
  reset_token_id?: string;
}

interface VerifyCodeResponse {
  ok: boolean;
  verification_token: string;
}

function readStoredResetState(): ResetWizardState | null {
  try {
    const raw = sessionStorage.getItem(RESET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResetWizardState;
    if (parsed && parsed.email && parsed.reset_token_id) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function VerifyCodePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const wizardState = useMemo(() => {
    const routeState = (location.state as ResetWizardState | null) ?? null;
    if (routeState?.email && routeState?.reset_token_id) {
      return { email: routeState.email, reset_token_id: routeState.reset_token_id };
    }
    return readStoredResetState();
  }, [location.state]);

  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!wizardState?.email || !wizardState?.reset_token_id) {
    return <Navigate to="/forgot-password" replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanedCode = code.trim();
    if (!/^\d{6}$/.test(cleanedCode)) {
      setErrorMessage("Vui lòng nhập đầy đủ mã xác thực gồm 6 chữ số.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await apiClient.post<VerifyCodeResponse>(
        "/api/auth/verify-code",
        {
          email: wizardState.email,
          reset_token_id: wizardState.reset_token_id,
          code: cleanedCode,
        },
        true
      );
      const nextState = {
        email: wizardState.email,
        reset_token_id: wizardState.reset_token_id,
        verification_token: res.verification_token,
      };
      sessionStorage.setItem(RESET_STORAGE_KEY, JSON.stringify(nextState));
      showToast("Xác thực mã OTP thành công.", "success");
      navigate("/reset-password", { state: nextState });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Mã xác thực không hợp lệ. Vui lòng thử lại.";
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StoreLayout>
      <section className="relative min-h-[calc(100vh-140px)] overflow-hidden px-4 py-10 text-[#F5F6FA]">
        <div className="relative mx-auto max-w-md">
          <Link
            to="/forgot-password"
            className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-300 transition-all hover:-translate-x-1 hover:text-white"
          >
            <MangaIcon name="arrow-left" className="h-4 w-4" />
            Quay lại
          </Link>

          <div className="ms-panel-2d rounded-3xl border border-white/10 bg-[#131722]/90 p-8 shadow-2xl backdrop-blur-xl">
            <div className="mb-8 flex items-center justify-center gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                  <MangaIcon name="check" className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-emerald-400">Email</span>
              </div>
              <div className="h-0.5 w-8 bg-[#E63946]" />
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E63946] text-sm font-bold text-white shadow-lg shadow-[#E63946]/30">
                  2
                </div>
                <span className="text-sm font-medium text-white">Xác thực</span>
              </div>
              <div className="h-0.5 w-8 bg-white/15" />
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#1B2130] text-sm font-bold text-slate-400">
                  3
                </div>
                <span className="text-sm font-medium text-slate-400">Mật khẩu</span>
              </div>
            </div>

            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#E63946] shadow-lg shadow-[#E63946]/25">
                <MangaIcon name="shield-check" className="h-8 w-8 text-white" />
              </div>
              <h1 className="font-display text-2xl font-bold text-[#F5F6FA]">Nhập mã xác thực</h1>
              <p className="mt-2 text-sm text-slate-400">Chúng tôi đã gửi mã 6 số đến email</p>
              <p className="mt-1 text-sm font-semibold text-[#F59E0B]">{wizardState.email}</p>
            </div>

            {errorMessage ? (
              <div
                role="alert"
                className="mb-6 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300"
              >
                <MangaIcon name="alert-triangle" className="h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            ) : null}

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="otpCode" className="text-sm font-semibold text-slate-300">
                  Mã xác thực 6 số
                </label>
                <div className="relative">
                  <MangaIcon
                    name="hash"
                    className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    id="otpCode"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="Nhập mã 6 số"
                    required
                    autoComplete="one-time-code"
                    disabled={submitting}
                    className="h-14 w-full rounded-xl border border-white/15 bg-[#1B2130] pl-12 pr-4 text-center text-2xl font-bold tracking-[0.5em] text-[#F5F6FA] transition-all placeholder:text-base placeholder:tracking-normal placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-4 focus:ring-[#E63946]/20 disabled:opacity-60"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="ms-btn-2d ms-btn-2d-crimson inline-flex w-full items-center justify-center gap-2 rounded-xl border px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MangaIcon name="check-circle" className="h-4 w-4" />
                )}
                <span>{submitting ? "Đang kiểm tra..." : "Xác nhận"}</span>
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-slate-400">
                Không nhận được mã?{" "}
                <Link
                  to="/forgot-password"
                  className="font-semibold text-[#FF6B77] hover:text-[#FF4D5A]"
                >
                  Gửi lại
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>
    </StoreLayout>
  );
}

export default VerifyCodePage;
