import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ChevronDown,
  Heart,
  LogOut,
  Package,
  Settings,
  ShieldCheck,
  User,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useCartWishlist } from "../../contexts/CartWishlistContext";
import { useToast } from "../../contexts/ToastContext";
import { MangaIcon } from "../ui/MangaIcon";
import { PanelBadge } from "../ui/PanelBadge";

const DEFAULT_AVATAR_URL = "/content/icons/spots/avatar-default.svg";

export function Header() {
  const { pathname } = useLocation();
  const { user, loading, isStaffOrAdmin, logout } = useAuth();
  const { cartCount, wishlistCount } = useCartWishlist();
  const { showToast } = useToast();

  const [menuOpen, setMenuOpen] = useState(false);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const isHome = pathname === "/";
  const isStore =
    pathname.startsWith("/products") ||
    pathname.startsWith("/cart") ||
    pathname.startsWith("/checkout");
  const isReader = pathname.startsWith("/doc-truyen");
  const isAbout = pathname.startsWith("/about");
  const isContact = pathname.startsWith("/contact");

  const rawAvatar = user?.avatar_url?.trim() || DEFAULT_AVATAR_URL;
  const avatarSrc =
    failedAvatarUrl === rawAvatar ? DEFAULT_AVATAR_URL : rawAvatar;

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    showToast("Đã đăng xuất tài khoản.", "info");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0B0D14]/90 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-3.5">
        <div className="flex items-center justify-between gap-2">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 sm:gap-2.5 text-white transition-colors hover:text-rose-300"
          >
            <span className="ms-emblem-3d shrink-0 shadow-md">
              <img
                src="/content/icons/spots/brand-logo.svg"
                alt="MangaStore"
                className="h-9 w-9 rounded-xl sm:h-10 sm:w-10"
              />
            </span>
            <span className="font-display whitespace-nowrap text-lg font-bold tracking-tight text-white sm:text-xl">
              Manga<span className="text-[#E63946]">Store</span>
            </span>
          </Link>

          <nav
            aria-label="Điều hướng chính"
            className="hidden items-center gap-1.5 text-sm font-medium md:flex lg:gap-2.5"
          >
            <Link
              to="/"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 transition-all ${
                isHome
                  ? "bg-white/10 text-white"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <MangaIcon name="home" className="h-4 w-4" />
              <span>Trang chủ</span>
            </Link>

            <Link
              to="/products"
              className={`ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold text-white transition-all ${
                isStore ? "ring-2 ring-rose-300/60" : ""
              }`}
            >
              <PanelBadge asset="mode-store" className="h-4 w-4" />
              <span>Cửa hàng mua truyện</span>
            </Link>

            <Link
              to="/doc-truyen"
              className={`ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold text-white transition-all ${
                isReader ? "ring-2 ring-cyan-300/60" : ""
              }`}
            >
              <PanelBadge asset="mode-reader" className="h-4 w-4" />
              <span>Đọc truyện Online</span>
            </Link>

            <Link
              to="/about"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 transition-colors ${
                isAbout
                  ? "bg-white/10 text-white"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <MangaIcon name="info" className="h-4 w-4" />
              <span>Giới thiệu</span>
            </Link>

            <Link
              to="/contact"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 transition-colors ${
                isContact
                  ? "bg-white/10 text-white"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <MangaIcon name="target" className="h-4 w-4" />
              <span>Liên hệ</span>
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            <Link
              to="/profile/wishlist"
              aria-label="Danh sách yêu thích"
              title="Yêu thích"
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-[#E63946]/15 hover:text-rose-300"
            >
              <MangaIcon name="heart" className="h-5 w-5" />
              {wishlistCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E63946] px-1 text-[11px] font-semibold text-white">
                  {wishlistCount > 99 ? "99+" : wishlistCount}
                </span>
              ) : null}
            </Link>

            <Link
              to="/cart"
              aria-label="Giỏ hàng"
              title="Giỏ hàng"
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <MangaIcon name="shopping-cart" className="h-5 w-5" />
              {cartCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E63946] px-1 text-[11px] font-semibold text-white">
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              ) : null}
            </Link>

            {loading ? (
              <div
                className="h-10 w-24 animate-pulse rounded-full border border-white/10 bg-[#131722]"
                aria-hidden="true"
              />
            ) : user ? (
              <div className="flex items-center gap-1.5 sm:gap-2">
                {isStaffOrAdmin ? (
                  <Link
                    to="/admin"
                    aria-label="Trang quản trị"
                    title="Trang quản trị"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-rose-300 transition-colors hover:border-[#E63946]/50 hover:bg-[#E63946]/15 hover:text-rose-200"
                  >
                    <ShieldCheck className="h-5 w-5" />
                  </Link>
                ) : null}

                <div ref={menuContainerRef} className="relative">
                  <button
                    type="button"
                    data-username={user.username}
                    onClick={() => setMenuOpen((prev) => !prev)}
                    aria-expanded={menuOpen}
                    aria-haspopup="menu"
                    aria-label="Menu tài khoản"
                    className="flex items-center gap-1.5 rounded-full border border-white/15 bg-[#1B2130] p-0.5 pr-2 text-sm font-semibold text-white ring-1 ring-white/10 transition-all hover:border-rose-500/60 hover:ring-rose-500/40"
                  >
                    <img
                      src={avatarSrc}
                      alt={user.username}
                      onError={() => {
                        if (avatarSrc !== DEFAULT_AVATAR_URL) {
                          setFailedAvatarUrl(rawAvatar);
                        }
                      }}
                      className="h-9 w-9 rounded-full object-cover"
                    />
                    <ChevronDown
                      className={`h-3.5 w-3.5 text-slate-300 transition-transform ${
                        menuOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {menuOpen ? (
                    <div
                      role="menu"
                      className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-white/10 bg-[#131722]/95 shadow-2xl backdrop-blur-xl"
                    >
                      <div className="border-b border-white/10 px-4 py-3">
                        <p className="truncate font-semibold text-white">
                          {user.username}
                        </p>
                        <p className="truncate text-xs text-slate-400">
                          {user.email}
                        </p>
                      </div>

                      <div className="p-2">
                        <Link
                          to="/profile"
                          role="menuitem"
                          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-white/5 hover:text-white"
                        >
                          <User className="h-4 w-4 text-rose-400" />
                          <span>Hồ sơ</span>
                        </Link>
                        <Link
                          to="/profile/orders"
                          role="menuitem"
                          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-white/5 hover:text-white"
                        >
                          <Package className="h-4 w-4 text-rose-400" />
                          <span>Đơn hàng</span>
                        </Link>
                        <Link
                          to="/profile/wishlist"
                          role="menuitem"
                          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-white/5 hover:text-white"
                        >
                          <Heart className="h-4 w-4 text-rose-400" />
                          <span>Yêu thích</span>
                        </Link>
                        <Link
                          to="/profile/settings"
                          role="menuitem"
                          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-white/5 hover:text-white"
                        >
                          <Settings className="h-4 w-4 text-rose-400" />
                          <span>Cài đặt</span>
                        </Link>

                        {isStaffOrAdmin ? (
                          <Link
                            to="/admin"
                            role="menuitem"
                            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-amber-300 transition-colors hover:bg-amber-500/10 hover:text-amber-200"
                          >
                            <ShieldCheck className="h-4 w-4 text-amber-400" />
                            <span>Trang quản trị</span>
                          </Link>
                        ) : null}

                        <div className="my-2 border-t border-white/10" />

                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void handleLogout()}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-rose-400 transition-colors hover:bg-[#E63946]/15 hover:text-rose-300"
                        >
                          <LogOut className="h-4 w-4" />
                          <span>Đăng xuất</span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <Link
                to="/auth"
                className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold text-white sm:gap-2 sm:px-5 sm:text-sm"
              >
                <MangaIcon name="unlock" className="h-4 w-4" />
                <span>Đăng nhập</span>
              </Link>
            )}
          </div>
        </div>

        <nav
          aria-label="Điều hướng nhanh trên di động"
          className="ms-no-scrollbar mt-3 flex items-center gap-2 overflow-x-auto pb-1 text-xs font-medium md:hidden"
        >
          <Link
            to="/"
            className={`ms-pill-2d whitespace-nowrap rounded-full border px-3 py-1.5 ${
              isHome
                ? "ms-pill-2d-active-crimson font-semibold text-white"
                : "border-white/10 bg-white/5 text-slate-300"
            }`}
          >
            Trang chủ
          </Link>
          <Link
            to="/products"
            className={`ms-pill-2d whitespace-nowrap rounded-full border px-3 py-1.5 ${
              isStore
                ? "ms-pill-2d-active-crimson font-semibold text-white"
                : "border-white/10 bg-white/5 text-slate-300"
            }`}
          >
            Cửa hàng mua truyện
          </Link>
          <Link
            to="/doc-truyen"
            className={`ms-pill-2d whitespace-nowrap rounded-full border px-3 py-1.5 ${
              isReader
                ? "ms-pill-2d-active-cyan font-semibold text-white"
                : "border-white/10 bg-white/5 text-slate-300"
            }`}
          >
            Đọc truyện Online
          </Link>
          <Link
            to="/about"
            className={`ms-pill-2d whitespace-nowrap rounded-full border px-3 py-1.5 ${
              isAbout
                ? "ms-pill-2d-active-crimson font-semibold text-white"
                : "border-white/10 bg-white/5 text-slate-300"
            }`}
          >
            Giới thiệu
          </Link>
          <Link
            to="/contact"
            className={`ms-pill-2d whitespace-nowrap rounded-full border px-3 py-1.5 ${
              isContact
                ? "ms-pill-2d-active-crimson font-semibold text-white"
                : "border-white/10 bg-white/5 text-slate-300"
            }`}
          >
            Liên hệ
          </Link>
        </nav>
      </div>
    </header>
  );
}
