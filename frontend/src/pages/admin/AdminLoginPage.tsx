import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { ToastContainer } from "../../components/ui/ToastContainer";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { apiClient } from "../../lib/api";
import type { AuthResponse } from "../../types/api";
import { getErrorMessage } from "./adminShared";

export function AdminLoginPage() {
  const { user, loading, isStaffOrAdmin, loginWithResponse } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user && isStaffOrAdmin) {
    return <Navigate to="/admin" replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier || !password) {
      setError("Vui lòng nhập tên đăng nhập hoặc email và mật khẩu.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient.post<AuthResponse>(
        "/api/admin/login",
        {
          identifier: trimmedIdentifier,
          password,
          remember_me: true,
        },
        true
      );

      if (res.user.role_id !== 1 && res.user.role_id !== 2) {
        setError("Tài khoản này không có quyền truy cập khu vực quản trị.");
        return;
      }

      loginWithResponse(res, true);
      showToast(`Chào mừng ${res.user.username} quay lại hệ thống quản trị.`, "success");
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Tên đăng nhập hoặc mật khẩu không đúng."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-transparent px-4 py-12 text-[#F5F6FA]">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#131722]/90 shadow-2xl backdrop-blur-xl">
        <div className="relative h-28 w-full overflow-hidden border-b border-white/10">
          <img
            src="/content/manga/auth-manga-art.png"
            alt="MangaStore Admin"
            className="h-full w-full object-cover opacity-55"
          />
          <div className="ms-manga-banner-overlay absolute inset-0" />
          <div className="absolute inset-0 flex items-center justify-center gap-3 px-6">
            <img
              src="/content/icons/spots/brand-logo.svg"
              alt="MangaStore"
              className="h-12 w-12 rounded-xl shadow-lg"
            />
            <div className="text-left">
              <h1 className="font-display text-xl font-bold text-[#F5F6FA]">
                MangaStore Admin
              </h1>
              <p className="text-xs font-medium text-[#A3AEC2]">
                Cổng quản trị cửa hàng &amp; vận hành
              </p>
            </div>
          </div>
        </div>

        <div className="p-8">
          {error ? (
            <div
              role="alert"
              className="mb-6 flex items-start gap-2.5 rounded-2xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-300"
            >
              <MangaIcon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label
                htmlFor="admin-identifier"
                className="block text-sm font-semibold text-slate-300"
              >
                Tên đăng nhập hoặc Email
              </label>
              <div className="relative">
                <MangaIcon
                  name="user"
                  className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                />
                <input
                  id="admin-identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Nhập tên đăng nhập hoặc email"
                  className="h-12 w-full rounded-xl border border-white/15 bg-[#1B2130] pl-12 pr-4 text-sm text-[#F5F6FA] placeholder:text-slate-400 transition-all focus:border-[#E63946] focus:outline-none focus:ring-4 focus:ring-[#E63946]/20"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="admin-password"
                className="block text-sm font-semibold text-slate-300"
              >
                Mật khẩu
              </label>
              <div className="relative">
                <MangaIcon
                  name="lock"
                  className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                />
                <input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu"
                  className="h-12 w-full rounded-xl border border-white/15 bg-[#1B2130] pl-12 pr-11 text-sm text-[#F5F6FA] placeholder:text-slate-400 transition-all focus:border-[#E63946] focus:outline-none focus:ring-4 focus:ring-[#E63946]/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <MangaIcon name={showPassword ? "eye-off" : "eye"} className="h-4 w-4" />
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
                <MangaIcon name="log-in" className="h-4 w-4" />
              )}
              <span>{submitting ? "Đang đăng nhập..." : "Đăng nhập"}</span>
            </button>
          </form>

          <Link
            to="/"
            className="mt-6 inline-flex w-full items-center justify-center gap-2 text-sm font-semibold text-slate-400 transition-colors hover:text-white"
          >
            <MangaIcon name="arrow-left" className="h-4 w-4" />
            <span>Quay lại trang chủ</span>
          </Link>
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}

export default AdminLoginPage;
