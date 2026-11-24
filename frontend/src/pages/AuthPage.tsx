import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { StoreLayout } from "../components/layout/StoreLayout";
import { MangaIcon } from "../components/ui/MangaIcon";
import { useAuth } from "../contexts/AuthContext";
import { useCartWishlist } from "../contexts/CartWishlistContext";
import { useToast } from "../contexts/ToastContext";
import { use3DTilt } from "../hooks/use3DTilt";
import { apiClient } from "../lib/api";
import type { AuthResponse } from "../types/api";

type AuthMode = "login" | "register";

interface AuthLocationState {
  from?: string | { pathname?: string; search?: string };
  mode?: AuthMode;
  successMessage?: string;
  errorMessage?: string;
}

function resolveRedirectTarget(state: AuthLocationState | null): string {
  if (!state?.from) return "/";
  if (typeof state.from === "string") {
    return state.from.startsWith("/") ? state.from : "/";
  }
  const pathname = state.from.pathname || "/";
  const search = state.from.search || "";
  return `${pathname}${search}`;
}

export function AuthPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading, loginWithResponse } = useAuth();
  const { refreshCounts } = useCartWishlist();
  const { showToast } = useToast();
  const artTilt = use3DTilt<HTMLDivElement>({ maxTilt: 7, liftY: -4 });

  const locationState = (location.state as AuthLocationState | null) ?? null;
  const redirectTarget = useMemo(
    () => resolveRedirectTarget(locationState),
    [locationState]
  );

  const initialMode: AuthMode =
    searchParams.get("mode")?.toLowerCase() === "register" ||
    locationState?.mode === "register"
      ? "register"
      : "login";

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    locationState?.errorMessage ?? null
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(
    locationState?.successMessage ?? null
  );

  // Login form state
  const [identifier, setIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  // Register form state
  const [regUsername, setRegUsername] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirm, setShowRegConfirm] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(true);
  const [regSubmitting, setRegSubmitting] = useState(false);

  // Handle Google OAuth callback when redirected with ?code=...&state=...
  const oauthCode = searchParams.get("code");
  const oauthState = searchParams.get("state");
  const oauthError = searchParams.get("error");

  useEffect(() => {
    if (oauthError) {
      setErrorMessage(
        oauthError === "access_denied"
          ? "Bạn đã hủy đăng nhập Google."
          : "Đăng nhập Google thất bại. Vui lòng thử lại."
      );
      return;
    }
    if (!oauthCode || !oauthState) return;

    let cancelled = false;
    setGoogleSubmitting(true);
    setErrorMessage(null);

    apiClient
      .post<AuthResponse>(
        "/api/auth/google-callback",
        {
          code: oauthCode,
          state: oauthState,
          redirect_uri: `${window.location.origin}${window.location.pathname}`,
        },
        true
      )
      .then((res) => {
        if (cancelled) return;
        loginWithResponse(res, true);
        void refreshCounts();
        showToast(`Chào mừng ${res.user.username}!`, "success");
        navigate(redirectTarget, { replace: true });
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Không thể hoàn tất đăng nhập Google. Vui lòng thử lại."
        );
      })
      .finally(() => {
        if (!cancelled) {
          setGoogleSubmitting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    oauthCode,
    oauthState,
    oauthError,
    loginWithResponse,
    refreshCounts,
    showToast,
    navigate,
    redirectTarget,
  ]);

  useEffect(() => {
    if (!authLoading && user && !oauthCode) {
      navigate(redirectTarget, { replace: true });
    }
  }, [authLoading, user, oauthCode, navigate, redirectTarget]);

  const handleSwitchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanedId = identifier.trim();
    if (!cleanedId || !loginPassword) {
      setErrorMessage("Vui lòng nhập đầy đủ tên đăng nhập/email và mật khẩu.");
      return;
    }

    setLoginSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await apiClient.post<AuthResponse>(
        "/api/auth/login",
        {
          identifier: cleanedId,
          password: loginPassword,
          remember_me: rememberMe,
        },
        true
      );
      loginWithResponse(res, rememberMe);
      await refreshCounts();
      showToast(`Đăng nhập thành công. Xin chào ${res.user.username}!`, "success");
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Tên đăng nhập, email hoặc mật khẩu không chính xác."
      );
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanedEmail = regEmail.trim().toLowerCase();
    const cleanedUsername = regUsername.trim();
    const cleanedPhone = regPhone.trim();

    if (!cleanedEmail) {
      setErrorMessage("Vui lòng nhập địa chỉ email.");
      return;
    }
    if (cleanedUsername && cleanedUsername.length < 3) {
      setErrorMessage("Tên đăng nhập phải có ít nhất 3 ký tự.");
      return;
    }
    if (regPassword.length < 6) {
      setErrorMessage("Mật khẩu phải có ít nhất 6 ký tự.");
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setErrorMessage("Mật khẩu xác nhận không khớp.");
      return;
    }
    if (!agreeTerms) {
      setErrorMessage("Vui lòng đồng ý với điều khoản sử dụng và chính sách bảo mật.");
      return;
    }

    setRegSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await apiClient.post<AuthResponse>(
        "/api/auth/register",
        {
          username: cleanedUsername || null,
          email: cleanedEmail,
          password: regPassword,
          phone: cleanedPhone || null,
        },
        true
      );
      loginWithResponse(res, false);
      await refreshCounts();
      showToast(`Đăng ký thành công! Chào mừng ${res.user.username}!`, "success");
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Không thể tạo tài khoản lúc này. Vui lòng thử lại."
      );
    } finally {
      setRegSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await apiClient.get<{ configured: boolean; url: string }>(
        "/api/auth/google-url"
      );
      if (!res.configured || !res.url) {
        const msg = "Đăng nhập bằng Google hiện chưa được cấu hình trên máy chủ.";
        setErrorMessage(msg);
        showToast(msg, "warning");
        setGoogleSubmitting(false);
        return;
      }
      window.location.href = res.url;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Không thể khởi tạo đăng nhập Google.";
      setErrorMessage(msg);
      showToast(msg, "error");
      setGoogleSubmitting(false);
    }
  };

  return (
    <StoreLayout>
      <section className="relative min-h-[calc(100vh-140px)] overflow-x-clip px-4 py-10 text-[#F5F6FA]">
        <div className="relative mx-auto max-w-5xl">
          <Link
            to="/"
            className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-300 transition-all hover:-translate-x-1 hover:text-white"
          >
            <MangaIcon name="arrow-left" className="h-4 w-4" />
            Quay lại trang chủ
          </Link>

          <div className="grid items-start gap-10 lg:grid-cols-2">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-[#131722]/90 px-5 py-2.5 text-[#F5F6FA] shadow-2xl backdrop-blur-xl">
                <span className="ms-emblem-3d shadow">
                  <img
                    src="/content/icons/spots/brand-logo.svg"
                    alt="MangaStore"
                    className="h-10 w-10 rounded-xl"
                  />
                </span>
                <span className="font-display text-2xl font-bold tracking-tight">MangaStore</span>
              </div>

              <div className="space-y-3">
                <h1 className="font-display text-4xl font-bold leading-tight text-[#F5F6FA] lg:text-5xl">
                  Chào mừng đến với
                  <span className="block text-[#E63946]">MangaStore</span>
                </h1>
                <p className="max-w-md text-base leading-relaxed text-slate-300">
                  Đăng nhập hoặc tạo tài khoản mới để mua truyện tranh, light novel, đồng bộ
                  tủ truyện và theo dõi đơn hàng của bạn.
                </p>
              </div>

              <div
                ref={artTilt.ref}
                onPointerEnter={artTilt.onPointerEnter}
                onPointerMove={artTilt.onPointerMove}
                onPointerLeave={artTilt.onPointerLeave}
                className="ms-card-3d ms-card-3d-crimson rounded-3xl border border-white/10 bg-[#131722]/90 p-2 shadow-2xl backdrop-blur-xl"
              >
                <div className="ms-3d-glare" aria-hidden="true" />
                <div className="relative overflow-hidden rounded-2xl">
                  <img
                    src="/content/manga/auth-manga-art.png"
                    alt="Minh họa MangaStore"
                    className="h-[320px] w-full object-cover"
                    onError={(e) => {
                      e.currentTarget.src = "/covers/default-manga.svg";
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0B0D14]/80 via-transparent to-transparent" />
                </div>
              </div>
            </div>

            <div className="lg:sticky lg:top-24">
              <div className="ms-panel-2d rounded-3xl border border-white/10 bg-[#131722]/90 p-7 shadow-2xl backdrop-blur-xl">
                <div className="mb-7 space-y-2 text-center">
                  <h2 className="font-display text-2xl font-bold text-[#F5F6FA]">
                    Tài khoản của bạn
                  </h2>
                </div>

                <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-[#1B2130] p-1">
                  <button
                    type="button"
                    onClick={() => handleSwitchMode("login")}
                    className={`rounded-lg px-4 py-2.5 text-xs font-semibold transition-all ${
                      mode === "login"
                        ? "bg-[#E63946] text-white shadow-md shadow-[#E63946]/25"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Đăng nhập
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchMode("register")}
                    className={`rounded-lg px-4 py-2.5 text-xs font-semibold transition-all ${
                      mode === "register"
                        ? "bg-[#E63946] text-white shadow-md shadow-[#E63946]/25"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Đăng ký
                  </button>
                </div>

                {successMessage ? (
                  <div className="mb-5 flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-semibold text-emerald-300 shadow-lg">
                    <MangaIcon name="check-circle" className="h-4 w-4 shrink-0" />
                    <span>{successMessage}</span>
                  </div>
                ) : null}

                {errorMessage ? (
                  <div
                    role="alert"
                    className="mb-5 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-300 shadow-lg"
                  >
                    <MangaIcon name="alert-triangle" className="h-4 w-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                ) : null}

                {mode === "login" ? (
                  <form onSubmit={(e) => void handleLoginSubmit(e)} className="space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="loginIdentifier" className="text-xs font-semibold text-slate-300">
                        Tên đăng nhập hoặc Email
                      </label>
                      <div className="relative">
                        <MangaIcon
                          name="mail"
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        />
                        <input
                          id="loginIdentifier"
                          type="text"
                          value={identifier}
                          onChange={(e) => setIdentifier(e.target.value)}
                          placeholder="email@example.com hoặc username"
                          required
                          disabled={loginSubmitting || googleSubmitting}
                          className="h-10 w-full rounded-xl border border-white/15 bg-[#1B2130] pl-10 pr-3 text-xs text-[#F5F6FA] placeholder:text-slate-400 transition-all focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/25 disabled:opacity-60"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="loginPassword" className="text-xs font-semibold text-slate-300">
                        Mật khẩu
                      </label>
                      <div className="relative">
                        <MangaIcon
                          name="lock"
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        />
                        <input
                          id="loginPassword"
                          type={showLoginPassword ? "text" : "password"}
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          placeholder="Nhập mật khẩu của bạn"
                          required
                          disabled={loginSubmitting || googleSubmitting}
                          className="h-10 w-full rounded-xl border border-white/15 bg-[#1B2130] pl-10 pr-10 text-xs text-[#F5F6FA] placeholder:text-slate-400 transition-all focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/25 disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={() => setShowLoginPassword((prev) => !prev)}
                          aria-label={showLoginPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-white"
                        >
                          {showLoginPassword ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <label className="inline-flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-[#1B2130] text-[#E63946] focus:ring-[#E63946]"
                        />
                        <span>Ghi nhớ đăng nhập</span>
                      </label>
                      <Link
                        to="/forgot-password"
                        className="font-semibold text-[#FF6B77] hover:text-[#FF4D5A]"
                      >
                        Quên mật khẩu?
                      </Link>
                    </div>

                    <button
                      type="submit"
                      disabled={loginSubmitting || googleSubmitting}
                      className="ms-btn-2d ms-btn-2d-crimson inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loginSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MangaIcon name="log-in" className="h-4 w-4" />
                      )}
                      <span>{loginSubmitting ? "Đang đăng nhập..." : "Đăng nhập"}</span>
                    </button>

                    <div className="relative py-2 text-center text-[11px] text-slate-400">
                      <span className="bg-[#131722] px-2">Hoặc</span>
                      <div className="absolute inset-x-0 top-1/2 -z-10 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleGoogleLogin()}
                      disabled={loginSubmitting || googleSubmitting}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#1B2130] px-4 py-2.5 text-xs font-semibold text-slate-100 shadow-sm transition-all hover:border-white/30 hover:bg-[#232A3D] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {googleSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <img
                          src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                          alt="Google"
                          className="h-4 w-4"
                        />
                      )}
                      <span>
                        {googleSubmitting ? "Đang kết nối Google..." : "Đăng nhập bằng Google"}
                      </span>
                    </button>
                  </form>
                ) : (
                  <form onSubmit={(e) => void handleRegisterSubmit(e)} className="space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="regUsername" className="text-xs font-semibold text-slate-300">
                        Tên hiển thị (tối thiểu 3 ký tự)
                      </label>
                      <input
                        id="regUsername"
                        type="text"
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value)}
                        placeholder="manga_reader"
                        disabled={regSubmitting}
                        className="h-10 w-full rounded-xl border border-white/15 bg-[#1B2130] px-3 text-xs text-[#F5F6FA] placeholder:text-slate-400 transition-all focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/25 disabled:opacity-60"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="regPhone" className="text-xs font-semibold text-slate-300">
                        Số điện thoại
                      </label>
                      <input
                        id="regPhone"
                        type="tel"
                        value={regPhone}
                        onChange={(e) => setRegPhone(e.target.value)}
                        placeholder="0123 456 789"
                        disabled={regSubmitting}
                        className="h-10 w-full rounded-xl border border-white/15 bg-[#1B2130] px-3 text-xs text-[#F5F6FA] placeholder:text-slate-400 transition-all focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/25 disabled:opacity-60"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="regEmail" className="text-xs font-semibold text-slate-300">
                        Email <span className="text-[#E63946]">*</span>
                      </label>
                      <input
                        id="regEmail"
                        type="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="email@example.com"
                        required
                        disabled={regSubmitting}
                        className="h-10 w-full rounded-xl border border-white/15 bg-[#1B2130] px-3 text-xs text-[#F5F6FA] placeholder:text-slate-400 transition-all focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/25 disabled:opacity-60"
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label htmlFor="regPassword" className="text-xs font-semibold text-slate-300">
                          Mật khẩu <span className="text-[#E63946]">*</span>
                        </label>
                        <div className="relative">
                          <MangaIcon
                            name="lock"
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                          />
                          <input
                            id="regPassword"
                            type={showRegPassword ? "text" : "password"}
                            value={regPassword}
                            onChange={(e) => setRegPassword(e.target.value)}
                            placeholder="Ít nhất 6 ký tự"
                            required
                            minLength={6}
                            disabled={regSubmitting}
                            className="h-10 w-full rounded-xl border border-white/15 bg-[#1B2130] pl-9 pr-9 text-xs text-[#F5F6FA] placeholder:text-slate-400 transition-all focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/25 disabled:opacity-60"
                          />
                          <button
                            type="button"
                            onClick={() => setShowRegPassword((prev) => !prev)}
                            aria-label={showRegPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-white"
                          >
                            {showRegPassword ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label
                          htmlFor="regConfirmPassword"
                          className="text-xs font-semibold text-slate-300"
                        >
                          Xác nhận mật khẩu <span className="text-[#E63946]">*</span>
                        </label>
                        <div className="relative">
                          <MangaIcon
                            name="lock"
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                          />
                          <input
                            id="regConfirmPassword"
                            type={showRegConfirm ? "text" : "password"}
                            value={regConfirmPassword}
                            onChange={(e) => setRegConfirmPassword(e.target.value)}
                            placeholder="Nhập lại mật khẩu"
                            required
                            minLength={6}
                            disabled={regSubmitting}
                            className="h-10 w-full rounded-xl border border-white/15 bg-[#1B2130] pl-9 pr-9 text-xs text-[#F5F6FA] placeholder:text-slate-400 transition-all focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/25 disabled:opacity-60"
                          />
                          <button
                            type="button"
                            onClick={() => setShowRegConfirm((prev) => !prev)}
                            aria-label={
                              showRegConfirm ? "Ẩn mật khẩu xác nhận" : "Hiện mật khẩu xác nhận"
                            }
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-white"
                          >
                            {showRegConfirm ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    <label className="flex cursor-pointer items-start gap-2 text-[11px] text-slate-400">
                      <input
                        type="checkbox"
                        checked={agreeTerms}
                        onChange={(e) => setAgreeTerms(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-white/20 bg-[#1B2130] text-[#E63946] focus:ring-[#E63946]"
                      />
                      <span>
                        Tôi đồng ý với Điều khoản sử dụng và Chính sách bảo mật của MangaStore.
                      </span>
                    </label>

                    <button
                      type="submit"
                      disabled={regSubmitting}
                      className="ms-btn-2d ms-btn-2d-crimson inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {regSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MangaIcon name="user-plus" className="h-4 w-4" />
                      )}
                      <span>{regSubmitting ? "Đang tạo tài khoản..." : "Tạo tài khoản"}</span>
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </StoreLayout>
  );
}

export default AuthPage;
