import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertCircle, Eye, EyeOff, Loader2, LogIn, UserPlus, X } from "lucide-react";
import { ApiError, api, setStoredToken } from "../lib/api";
import type { AuthResponse } from "../types/manga";

type AuthTab = "login" | "register";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (auth: AuthResponse) => void;
}

export function AuthModal({ open, onClose, onSuccess }: AuthModalProps) {
  const [tab, setTab] = useState<AuthTab>("login");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const switchTab = (nextTab: AuthTab) => {
    if (submitting) return;
    setTab(nextTab);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (tab === "login") {
      if (!identifier.trim() || !password) {
        setError("Vui lòng nhập đầy đủ tên đăng nhập hoặc email và mật khẩu.");
        return;
      }
    } else {
      if (!username.trim() || !email.trim() || !password) {
        setError("Vui lòng điền đầy đủ tên đăng nhập, email và mật khẩu.");
        return;
      }
      if (username.trim().length < 3) {
        setError("Tên đăng nhập cần có ít nhất 3 ký tự.");
        return;
      }
      if (password.length < 6) {
        setError("Mật khẩu cần có ít nhất 6 ký tự.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const response =
        tab === "login"
          ? await api.login({ identifier: identifier.trim(), password })
          : await api.register({
              username: username.trim(),
              email: email.trim(),
              password,
            });
      setStoredToken(response.access_token);
      setPassword("");
      onSuccess(response);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Không thể thực hiện xác thực. Vui lòng thử lại.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#232838] bg-[#131620] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#232838] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <img src="/brand-logo.svg" alt="" className="h-7 w-7 rounded-lg" />
            <h2 id="auth-modal-title" className="text-base font-bold text-[#F5F6FA]">
              {tab === "login" ? "Đăng nhập tài khoản" : "Tạo tài khoản mới"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Đóng cửa sổ"
            className="rounded-lg p-1.5 text-[#94A3B8] transition-colors hover:bg-[#1E2436] hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pt-5">
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-[#232838] bg-[#0A0B10] p-1">
            <button
              type="button"
              onClick={() => switchTab("login")}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                tab === "login"
                  ? "bg-[#E63946] text-white shadow-sm"
                  : "text-[#94A3B8] hover:text-white"
              }`}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              onClick={() => switchTab("register")}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                tab === "register"
                  ? "bg-[#E63946] text-white shadow-sm"
                  : "text-[#94A3B8] hover:text-white"
              }`}
            >
              Đăng ký
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-[#E63946]/45 bg-[#E63946]/12 px-3.5 py-2.5 text-sm text-[#FF9BA3]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#E63946]" />
              <span>{error}</span>
            </div>
          ) : null}

          {tab === "login" ? (
            <div>
              <label
                htmlFor="auth-identifier"
                className="mb-1.5 block text-xs font-semibold text-[#CBD5E1]"
              >
                Tên đăng nhập hoặc Email
              </label>
              <input
                id="auth-identifier"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Nhập tên đăng nhập hoặc email"
                className="w-full rounded-xl border border-[#232838] bg-[#0A0B10] px-3.5 py-2.5 text-sm text-[#F5F6FA] placeholder-[#64748B] focus:border-[#06B6D4] focus:outline-none"
              />
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="auth-username"
                  className="mb-1.5 block text-xs font-semibold text-[#CBD5E1]"
                >
                  Tên đăng nhập
                </label>
                <input
                  id="auth-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Ví dụ: dokja_reader"
                  className="w-full rounded-xl border border-[#232838] bg-[#0A0B10] px-3.5 py-2.5 text-sm text-[#F5F6FA] placeholder-[#64748B] focus:border-[#06B6D4] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="auth-email"
                  className="mb-1.5 block text-xs font-semibold text-[#CBD5E1]"
                >
                  Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="ban@example.com"
                  className="w-full rounded-xl border border-[#232838] bg-[#0A0B10] px-3.5 py-2.5 text-sm text-[#F5F6FA] placeholder-[#64748B] focus:border-[#06B6D4] focus:outline-none"
                />
              </div>
            </>
          )}

          <div>
            <label
              htmlFor="auth-password"
              className="mb-1.5 block text-xs font-semibold text-[#CBD5E1]"
            >
              Mật khẩu
            </label>
            <div className="relative">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                autoComplete={tab === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Nhập mật khẩu"
                className="w-full rounded-xl border border-[#232838] bg-[#0A0B10] py-2.5 pl-3.5 pr-10 text-sm text-[#F5F6FA] placeholder-[#64748B] focus:border-[#06B6D4] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#94A3B8] hover:text-white"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="ms-btn-3d flex w-full items-center justify-center gap-2 rounded-xl bg-[#E63946] py-2.5 text-sm font-semibold text-white hover:bg-[#EE4653] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : tab === "login" ? (
              <LogIn className="h-4 w-4" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            <span>
              {submitting
                ? "Đang xử lý..."
                : tab === "login"
                  ? "Đăng nhập"
                  : "Đăng ký tài khoản"}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}
