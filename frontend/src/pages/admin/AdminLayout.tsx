import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { ToastContainer } from "../../components/ui/ToastContainer";
import { useAuth } from "../../contexts/AuthContext";
import { getRoleBadgeClass, getRoleLabel } from "./adminShared";

interface AdminNavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  fullAdminOnly?: boolean;
}

const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { to: "/admin", label: "Dashboard", icon: "layout-dashboard", end: true },
  { to: "/admin/products", label: "Sản phẩm", icon: "package" },
  { to: "/admin/orders", label: "Đơn hàng", icon: "shopping-cart" },
  { to: "/admin/reviews", label: "Đánh giá", icon: "message-circle" },
  { to: "/admin/customers", label: "Khách hàng", icon: "users", fullAdminOnly: true },
  { to: "/admin/import", label: "Nhập hàng Excel/ZIP", icon: "file-spreadsheet" },
];

export function AdminLayout({ children }: { children?: ReactNode }) {
  const { user, loading, isStaffOrAdmin, isFullAdmin, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0B0D14] text-[#F5F6FA]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#E63946]" />
          <p className="text-sm text-[#A3AEC2]">Đang xác thực phiên quản trị...</p>
        </div>
      </div>
    );
  }

  if (!user || !isStaffOrAdmin) {
    return <Navigate to="/admin/login" replace />;
  }

  const roleLabel = getRoleLabel(user.role_id);
  const roleBadgeClass = getRoleBadgeClass(user.role_id);
  const visibleNavItems = ADMIN_NAV_ITEMS.filter(
    (item) => !item.fullAdminOnly || isFullAdmin
  );

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      navigate("/admin/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-transparent text-[#F5F6FA]">
      <button
        id="mobileMenuToggle"
        type="button"
        onClick={() => setMobileOpen((prev) => !prev)}
        aria-label="Mở menu quản trị"
        aria-expanded={mobileOpen}
        className="fixed left-4 top-4 z-40 flex items-center justify-center rounded-xl border border-white/15 bg-[#131722]/95 p-2.5 text-slate-100 shadow-lg backdrop-blur-xl transition-colors hover:bg-white/10 lg:hidden"
      >
        <MangaIcon name="menu" className="h-6 w-6 text-slate-100" />
      </button>

      {mobileOpen ? (
        <div
          id="mobileMenuOverlay"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm lg:hidden"
        />
      ) : null}

      <aside
        id="sidebar"
        className={`fixed left-0 top-0 z-50 flex h-full w-64 shrink-0 flex-col border-r border-white/10 bg-[#131722]/95 p-5 text-slate-200 shadow-xl backdrop-blur-xl transition-transform duration-300 lg:sticky lg:top-0 lg:z-20 lg:h-screen lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Đóng menu quản trị"
          className="absolute right-4 top-4 flex items-center justify-center rounded-xl bg-[#1B2130] p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
        >
          <MangaIcon name="x" className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 border-b border-white/10 pb-5 pr-8 lg:pr-0">
          <img
            src="/content/icons/spots/brand-logo.svg"
            alt="MangaStore"
            className="h-10 w-10 shrink-0 rounded-xl shadow"
          />
          <div className="min-w-0">
            <p className="truncate font-display text-base font-bold text-[#F5F6FA]">
              MangaStore
            </p>
            <p className="truncate text-xs text-[#A3AEC2]">{user.username}</p>
            <span
              className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${roleBadgeClass}`}
            >
              {roleLabel}
            </span>
          </div>
        </div>

        <nav className="mt-5 flex-1 space-y-1.5 overflow-y-auto text-sm font-semibold">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-4 py-2.5 transition-all ${
                  isActive
                    ? "bg-[#E63946] text-white shadow-lg shadow-[#E63946]/25"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <MangaIcon name={item.icon} className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
          <Link
            to="/"
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#1B2130]/75 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-cyan-400/40 hover:text-white"
          >
            <MangaIcon name="home" className="h-4 w-4 text-[#22D3EE]" />
            <span>Về cửa hàng</span>
          </Link>

          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="flex w-full items-center gap-3 rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-semibold text-red-400 transition-all hover:bg-red-500/15 hover:text-red-300 disabled:opacity-60"
          >
            <MangaIcon name="log-out" className="h-4 w-4" />
            <span>{loggingOut ? "Đang đăng xuất..." : "Đăng xuất"}</span>
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 pt-16 sm:px-6 lg:px-10 lg:py-8 lg:pt-8">
        {children ?? <Outlet />}
      </main>

      <ToastContainer />
    </div>
  );
}

export default AdminLayout;
