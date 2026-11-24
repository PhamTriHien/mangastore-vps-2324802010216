import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { StoreLayout } from "../components/layout/StoreLayout";
import { MangaIcon } from "../components/ui/MangaIcon";
import { useToast } from "../contexts/ToastContext";
import { apiClient } from "../lib/api";

const RESET_STORAGE_KEY = "ms_password_reset_state";

interface ForgotPasswordResponse {
  ok: boolean;
  message: string;
  reset_token_id: string;
}

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanedEmail = email.trim().toLowerCase();
    if (!cleanedEmail) {
      setErrorMessage("Vui lòng nhập địa chỉ email đã đăng ký.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await apiClient.post<ForgotPasswordResponse>(
        "/api/auth/forgot-password",
        { email: cleanedEmail },
        true
      );
      const nextState = {
        email: cleanedEmail,
        reset_token_id: res.reset_token_id,
      };
      sessionStorage.setItem(RESET_STORAGE_KEY, JSON.stringify(nextState));
      showToast(res.message || "Mã xác nhận 6 chữ số đã được gửi tới email của bạn.", "success");
      navigate("/verify-code", { state: nextState });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Không thể gửi mã xác thực qua email lúc này. Vui lòng thử lại sau.";
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
            to="/auth"
            className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-300 transition-all hover:-translate-x-1 hover:text-white"
          >
            <MangaIcon name="arrow-left" className="h-4 w-4" />
            Quay lại đăng nhập
          </Link>

          <div className="ms-panel-2d rounded-3xl border border-white/10 bg-[#131722]/90 p-8 shadow-2xl backdrop-blur-xl">
            <div className="mb-8 flex items-center justify-center gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E63946] text-sm font-bold text-white shadow-lg shadow-[#E63946]/30">
                  1
                </div>
                <span className="text-sm font-medium text-white">Email</span>
              </div>
              <div className="h-0.5 w-8 bg-white/15" />
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#1B2130] text-sm font-bold text-slate-400">
                  2
                </div>
                <span className="text-sm font-medium text-slate-400">Xác thực</span>
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
                <MangaIcon name="mail" className="h-8 w-8 text-white" />
              </div>
              <h1 className="font-display text-2xl font-bold text-[#F5F6FA]">Quên mật khẩu?</h1>
              <p className="mt-2 text-sm text-slate-400">
                Nhập email của bạn, chúng tôi sẽ gửi mã xác thực 6 số.
              </p>
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
                <label htmlFor="forgotEmail" className="text-sm font-semibold text-slate-300">
                  Địa chỉ Email
                </label>
                <div className="relative">
                  <MangaIcon
                    name="mail"
                    className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    id="forgotEmail"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Nhập email đã đăng ký"
                    required
                    disabled={submitting}
                    className="h-12 w-full rounded-xl border border-white/15 bg-[#1B2130] pl-12 pr-4 text-sm text-[#F5F6FA] transition-all placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-4 focus:ring-[#E63946]/20 disabled:opacity-60"
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
                  <MangaIcon name="send" className="h-4 w-4" />
                )}
                <span>{submitting ? "Đang gửi mã..." : "Gửi mã xác thực"}</span>
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-slate-400">
                Nhớ mật khẩu rồi?{" "}
                <Link to="/auth" className="font-semibold text-[#FF6B77] hover:text-[#FF4D5A]">
                  Đăng nhập
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>
    </StoreLayout>
  );
}

export default ForgotPasswordPage;
