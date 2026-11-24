import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StoreLayout } from "../components/layout/StoreLayout";
import { MangaCard3D } from "../components/ui/MangaCard3D";
import { MangaIcon } from "../components/ui/MangaIcon";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { ApiError, apiClient } from "../lib/api";
import {
  formatCurrency,
  formatDate,
  getOrderStatusMeta,
} from "../lib/format";
import type { ProductCardDto, UserDto } from "../types/api";

interface RawFavoriteProduct {
  id: number;
  title: string;
  author?: string | null;
  category?: string | null;
  genres?: string[];
  tags?: string[];
  price?: number;
  original_price?: number | null;
  average_rating?: number;
  ratings_count?: number;
  rating_avg?: number;
  review_count?: number;
  view_count?: number;
  units_sold?: number;
  stock_quantity?: number;
  status?: string;
  is_new?: boolean;
  is_featured?: boolean;
  in_stock?: boolean;
  is_available?: boolean;
  cover_url?: string | null;
  description?: string | null;
}

interface RecentOrderSummary {
  id: number;
  order_code: string;
  created_at: string;
  status: string;
  payment_status?: string;
  payment_method?: string;
  total_items: number;
  grand_total: number;
}

interface ProfileApiResponse {
  user: UserDto;
  favorites: RawFavoriteProduct[];
  recent_orders: RecentOrderSummary[];
}

function resolveAvatarSrc(url?: string | null): string {
  if (!url || url.includes("unsplash.com")) {
    return "/content/icons/spots/avatar-default.svg";
  }
  return url;
}

function toProductCardDto(raw: RawFavoriteProduct): ProductCardDto {
  const stock = Number(raw.stock_quantity ?? 1);
  return {
    id: raw.id,
    title: raw.title,
    author: raw.author ?? "",
    category: raw.category ?? "",
    genres: raw.genres ?? [],
    tags: raw.tags ?? [],
    price: Number(raw.price ?? 0),
    original_price: raw.original_price ?? null,
    average_rating: Number(raw.average_rating ?? raw.rating_avg ?? 0),
    ratings_count: Number(raw.ratings_count ?? raw.review_count ?? 0),
    view_count: Number(raw.view_count ?? 0),
    units_sold: Number(raw.units_sold ?? 0),
    stock_quantity: stock,
    status: raw.status ?? (stock > 0 ? "con_hang" : "het_hang"),
    in_stock: raw.in_stock ?? stock > 0,
    is_available: raw.is_available ?? stock > 0,
    is_featured: Boolean(raw.is_featured),
    is_new: Boolean(raw.is_new),
    is_in_wishlist: true,
    cover_url: raw.cover_url || "/covers/default-manga.svg",
    description: raw.description ?? "",
  };
}

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, setUserDirect, logout } = useAuth();
  const { showToast } = useToast();

  const [profileUser, setProfileUser] = useState<UserDto | null>(null);
  const [favorites, setFavorites] = useState<ProductCardDto[]>([]);
  const [recentOrders, setRecentOrders] = useState<RecentOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<ProfileApiResponse>("/api/profile");
      setProfileUser(res.user);
      setEditUsername(res.user.username || "");
      setEditPhone(res.user.phone || "");
      setFavorites((res.favorites ?? []).map(toProductCardDto));
      setRecentOrders(res.recent_orders ?? []);
      setUserDirect(res.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/auth", { replace: true, state: { from: "/profile" } });
        return;
      }
      showToast(
        err instanceof Error ? err.message : "Không thể tải hồ sơ cá nhân.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [navigate, setUserDirect, showToast]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth", { replace: true, state: { from: "/profile" } });
      return;
    }
    void loadProfile();
  }, [authLoading, user, navigate, loadProfile]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const allowedExt = /\.(jpg|jpeg|png|gif|webp)$/i;
    if (!allowedExt.test(file.name)) {
      showToast(
        "Chỉ chấp nhận ảnh định dạng JPG, PNG, GIF hoặc WEBP.",
        "warning",
      );
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast("Dung lượng ảnh đại diện tối đa 2MB.", "warning");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    setUploadingAvatar(true);
    try {
      const res = await apiClient.post<{
        ok: boolean;
        avatar_url: string;
        user: UserDto;
      }>("/api/profile/avatar", formData);
      if (res.user) {
        setProfileUser(res.user);
        setUserDirect(res.user);
      }
      showToast("Cập nhật ảnh đại diện thành công!", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Tải ảnh đại diện thất bại.",
        "error",
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = editUsername.trim();
    if (!trimmedName) {
      showToast("Tên hiển thị không được để trống.", "warning");
      return;
    }
    setSavingProfile(true);
    try {
      const res = await apiClient.put<{ ok: boolean; user: UserDto }>(
        "/api/profile",
        {
          username: trimmedName,
          phone: editPhone.trim() || null,
        },
      );
      if (res.user) {
        setProfileUser(res.user);
        setUserDirect(res.user);
      }
      setEditing(false);
      showToast("Đã lưu thay đổi thông tin tài khoản.", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Cập nhật thông tin thất bại.",
        "error",
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  const displayUser = profileUser ?? user;
  const isVip = Boolean(
    displayUser &&
      (displayUser.role_id === 1 ||
        displayUser.role_id === 2 ||
        displayUser.role === "vip"),
  );
  const isVerified = displayUser?.status === "hoat_dong";

  return (
    <StoreLayout>
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Profile Header Navigation */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            <Link
              to="/profile"
              className="ms-btn-2d ms-btn-2d-crimson px-4 py-2 text-xs"
            >
              <MangaIcon name="user" className="h-3.5 w-3.5" />
              Tổng quan
            </Link>
            <Link
              to="/profile/orders"
              className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs"
            >
              <MangaIcon name="package" className="h-3.5 w-3.5" />
              Đơn hàng
            </Link>
            <Link
              to="/profile/wishlist"
              className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs"
            >
              <MangaIcon name="heart" className="h-3.5 w-3.5" />
              Yêu thích
            </Link>
            <Link
              to="/profile/settings"
              className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs"
            >
              <MangaIcon name="settings" className="h-3.5 w-3.5" />
              Cài đặt & Địa chỉ
            </Link>
          </div>

          <button
            type="button"
            onClick={() => void handleLogout()}
            className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs text-rose-300"
          >
            <MangaIcon name="log-out" className="h-3.5 w-3.5" />
            Đăng xuất
          </button>
        </div>

        {loading || authLoading || !displayUser ? (
          <div className="space-y-6">
            <div className="ms-panel-2d h-52 animate-pulse bg-slate-900/70" />
            <div className="ms-panel-2d h-72 animate-pulse bg-slate-900/70" />
          </div>
        ) : (
          <div className="space-y-8">
            {/* Banner + Avatar + Basic Info */}
            <div className="ms-panel-2d overflow-hidden">
              <div className="from-crimson-600/35 via-slate-900 to-cyan-600/25 h-28 bg-gradient-to-r" />
              <div className="px-6 pb-6">
                <div className="-mt-12 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                    <div className="relative h-24 w-24 shrink-0">
                      <img
                        src={resolveAvatarSrc(displayUser.avatar_url)}
                        alt={displayUser.username}
                        onError={(e) => {
                          e.currentTarget.src =
                            "/content/icons/spots/avatar-default.svg";
                        }}
                        className="h-24 w-24 rounded-2xl border-4 border-slate-900 bg-slate-950 object-cover shadow-xl"
                      />
                      <button
                        type="button"
                        disabled={uploadingAvatar}
                        onClick={() => fileInputRef.current?.click()}
                        title="Đổi ảnh đại diện"
                        className="bg-crimson-500 hover:bg-crimson-400 absolute -right-1.5 -bottom-1.5 flex h-8 w-8 items-center justify-center rounded-full border-2 border-slate-900 text-white shadow transition-colors disabled:opacity-50"
                      >
                        <MangaIcon name="camera" className="h-3.5 w-3.5" />
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".jpg,.jpeg,.png,.gif,.webp"
                        onChange={(e) => void handleAvatarChange(e)}
                        className="hidden"
                      />
                    </div>

                    <div className="pb-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h1 className="font-display text-2xl font-extrabold text-white">
                          {displayUser.username}
                        </h1>
                        {isVip && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-300">
                            <MangaIcon name="crown" className="h-3.5 w-3.5" />
                            VIP
                          </span>
                        )}
                        {isVerified && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                            <MangaIcon
                              name="shield-check"
                              className="h-3.5 w-3.5"
                            />
                            Đã xác thực
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <MangaIcon name="mail" className="h-3.5 w-3.5" />
                          {displayUser.email}
                        </span>
                        {displayUser.phone && (
                          <span className="flex items-center gap-1.5">
                            <MangaIcon name="phone" className="h-3.5 w-3.5" />
                            {displayUser.phone}
                          </span>
                        )}
                        {displayUser.created_at && (
                          <span className="flex items-center gap-1.5">
                            <MangaIcon name="calendar" className="h-3.5 w-3.5" />
                            Tham gia {formatDate(displayUser.created_at)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setEditUsername(displayUser.username || "");
                      setEditPhone(displayUser.phone || "");
                      setEditing((prev) => !prev);
                    }}
                    className="ms-btn-2d ms-btn-2d-cyan px-4 py-2 text-xs"
                  >
                    <MangaIcon name="edit-3" className="h-3.5 w-3.5" />
                    {editing ? "Đóng chỉnh sửa" : "Chỉnh sửa hồ sơ"}
                  </button>
                </div>

                {editing && (
                  <form
                    onSubmit={(e) => void handleSaveProfile(e)}
                    className="mt-6 grid gap-4 rounded-xl border border-slate-700/80 bg-slate-950/70 p-4 sm:grid-cols-3 sm:items-end"
                  >
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                        Tên hiển thị
                      </label>
                      <input
                        type="text"
                        required
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value)}
                        className="focus:border-cyan-400 w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-sm text-white outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                        Số điện thoại
                      </label>
                      <input
                        type="tel"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        placeholder="09xxxxxxxx"
                        className="focus:border-cyan-400 w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-sm text-white outline-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={savingProfile}
                        className="ms-btn-2d ms-btn-2d-crimson flex-1 py-2 text-xs disabled:opacity-50"
                      >
                        <MangaIcon name="save" className="h-3.5 w-3.5" />
                        {savingProfile ? "Đang lưu..." : "Lưu thay đổi"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>

            {/* Recent orders */}
            <div className="ms-panel-2d p-6">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
                  <MangaIcon name="package" className="text-crimson-400 h-5 w-5" />
                  Đơn hàng gần đây
                </h2>
                <Link
                  to="/profile/orders"
                  className="text-xs font-semibold text-cyan-400 hover:underline"
                >
                  Xem tất cả →
                </Link>
              </div>

              {recentOrders.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-center text-sm text-slate-400">
                  Bạn chưa có đơn hàng nào.{" "}
                  <Link to="/products" className="text-cyan-400 hover:underline">
                    Mua sắm ngay
                  </Link>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs text-slate-400">
                        <th className="py-2.5 pr-4">Mã đơn</th>
                        <th className="py-2.5 pr-4">Ngày đặt</th>
                        <th className="py-2.5 pr-4">Số lượng</th>
                        <th className="py-2.5 pr-4">Tổng tiền</th>
                        <th className="py-2.5 pr-4">Trạng thái</th>
                        <th className="py-2.5 text-right">Chi tiết</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {recentOrders.map((order) => {
                        const meta = getOrderStatusMeta(order.status);
                        return (
                          <tr key={order.id} className="hover:bg-slate-900/40">
                            <td className="py-3 pr-4 font-mono font-bold text-cyan-300">
                              #{order.order_code}
                            </td>
                            <td className="py-3 pr-4 text-xs text-slate-300">
                              {formatDate(order.created_at)}
                            </td>
                            <td className="py-3 pr-4 text-slate-300">
                              {order.total_items} cuốn
                            </td>
                            <td className="text-crimson-400 py-3 pr-4 font-mono font-bold">
                              {formatCurrency(order.grand_total)}
                            </td>
                            <td className="py-3 pr-4">
                              <span
                                className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.badgeClass}`}
                              >
                                {meta.label}
                              </span>
                            </td>
                            <td className="py-3 text-right">
                              <Link
                                to={`/order-success?orderCode=${encodeURIComponent(order.order_code)}`}
                                className="text-xs font-semibold text-cyan-400 hover:underline"
                              >
                                Xem đơn
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Favorites preview */}
            <div className="ms-panel-2d p-6">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
                  <MangaIcon name="heart" className="text-crimson-400 h-5 w-5" />
                  Truyện yêu thích ({favorites.length})
                </h2>
                <Link
                  to="/profile/wishlist"
                  className="text-xs font-semibold text-cyan-400 hover:underline"
                >
                  Xem tủ sách →
                </Link>
              </div>

              {favorites.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-center text-sm text-slate-400">
                  Danh sách yêu thích đang trống.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {favorites.slice(0, 5).map((item) => (
                    <MangaCard3D key={item.id} product={item} compact />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </StoreLayout>
  );
}

export default ProfilePage;
