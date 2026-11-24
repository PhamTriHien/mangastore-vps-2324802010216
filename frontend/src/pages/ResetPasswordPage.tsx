import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { StoreLayout } from "../components/layout/StoreLayout";
import { MangaIcon } from "../components/ui/MangaIcon";
import { useToast } from "../contexts/ToastContext";
import { apiClient } from "../lib/api";

const RESET_STORAGE_KEY = "ms_password_reset_state";

interface ResetWizardState {
  email?: string;
  reset_token_id?: string;
  verification_token?: string;
}

function readStoredResetState(): ResetWizardState | null {
  try {
    const raw = sessionStorage.getItem(RESET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResetWizardState;
    if (parsed && parsed.email && parsed.reset_token_id && parsed.verification_token) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const wizardState = useMemo(() => {
    const routeState = (location.state as ResetWizardState | null) ?? null;
    if (routeState?.email && routeState?.reset_token_id && routeState?.verification_token) {
      return {
        email: routeState.email,
        reset_token_id: routeState.reset_token_id,
        verification_token: routeState.verification_token,
      };
    }
    return readStoredResetState();
  }, [location.state]);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (
    !wizardState?.email ||
    !wizardState?.reset_token_id ||
    !wizardState?.verification_token
  ) {
    return <Navigate to="/forgot-password" replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 6) {
      setErrorMessage("Mật khẩu mới phải có ít nhất 6 ký tự.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage("Mật khẩu xác nhận không khớp.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      await apiClient.post<{ ok: boolean }>(
        "/api/auth/reset-password",
        {
          email: wizardState.email,
          reset_token_id: wizardState.reset_token_id,
          new_password: newPassword,
          confirm_password: confirmPassword,
          verification_token: wizardState.verification_token,
        },
        true
      );
      sessionStorage.removeItem(RESET_STORAGE_KEY);
      const msg = "Mật khẩu đã được đặt lại thành công! Vui lòng đăng nhập.";
      showToast(msg, "success");
      navigate("/auth", {
        replace: true,
        state: { mode: "login", successMessage: msg },
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Phiên đặt lại mật khẩu đã hết hạn hoặc không hợp lệ.";
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StoreLayout>
      <section className="relative min-h-[calc(100vh-140px)] overflow-hidden px-4 py-10 text-[#F5F6FA]">
        <div className="relative mx-auto max-w-md">
          <div className="ms-panel-2d rounded-3xl border border-white/10 bg-[#131722]/90 p-8 shadow-2xl backdrop-blur-xl">
            <div className="mb-8 flex items-center justify-center gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                  <MangaIcon name="check" className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-emerald-400">Email</span>
              </div>
              <div className="h-0.5 w-8 bg-emerald-600" />
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                  <MangaIcon name="check" className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-emerald-400">Xác thực</span>
              </div>
              <div className="h-0.5 w-8 bg-[#E63946]" />
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E63946] text-sm font-bold text-white shadow-lg shadow-[#E63946]/30">
                  3
                </div>
                <span className="text-sm font-medium text-white">Mật khẩu</span>
              </div>
            </div>

            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#E63946] shadow-lg shadow-[#E63946]/25">
                <MangaIcon name="lock" className="h-8 w-8 text-white" />
              </div>
              <h1 className="font-display text-2xl font-bold text-[#F5F6FA]">Tạo mật khẩu mới</h1>
              <p className="mt-2 text-sm text-slate-400">Nhập mật khẩu mới cho tài khoản</p>
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
                <label htmlFor="resetNewPass" className="text-sm font-semibold text-slate-300">
                  Mật khẩu mới
                </label>
                <div className="relative">
                  <MangaIcon
                    name="lock"
                    className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    id="resetNewPass"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Nhập mật khẩu mới (ít nhất 6 ký tự)"
                    required
                    minLength={6}
                    disabled={submitting}
                    className="h-12 w-full rounded-xl border border-white/15 bg-[#1B2130] pl-12 pr-11 text-sm text-[#F5F6FA] transition-all placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-4 focus:ring-[#E63946]/20 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    aria-label={showNewPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-white"
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="resetConfirmPass" className="text-sm font-semibold text-slate-300">
                  Xác nhận mật khẩu
                </label>
                <div className="relative">
                  <MangaIcon
                    name="lock"
                    className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    id="resetConfirmPass"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Nhập lại mật khẩu mới"
                    required
                    minLength={6}
                    disabled={submitting}
                    className="h-12 w-full rounded-xl border border-white/15 bg-[#1B2130] pl-12 pr-11 text-sm text-[#F5F6FA] transition-all placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-4 focus:ring-[#E63946]/20 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label={showConfirmPassword ? "Ẩn mật khẩu xác nhận" : "Hiện mật khẩu xác nhận"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-white"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
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
                <span>{submitting ? "Đang cập nhật..." : "Đặt lại mật khẩu"}</span>
              </button>
            </form>
          </div>
        </div>
      </section>
    </StoreLayout>
  );
}

export default ResetPasswordPage;
