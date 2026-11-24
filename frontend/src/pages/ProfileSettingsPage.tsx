import { Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StoreLayout } from "../components/layout/StoreLayout";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { MangaIcon } from "../components/ui/MangaIcon";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { ApiError, apiClient } from "../lib/api";
import { VN_PROVINCES } from "../lib/format";
import type { ShippingAddressDto } from "../types/api";

export function ProfileSettingsPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { showToast } = useToast();

  // Change password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Address book state
  const [addresses, setAddresses] = useState<ShippingAddressDto[]>([]);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addrFullName, setAddrFullName] = useState("");
  const [addrPhone, setAddrPhone] = useState("");
  const [addrLine, setAddrLine] = useState("");
  const [addrWard, setAddrWard] = useState("");
  const [addrDistrict, setAddrDistrict] = useState("");
  const [addrProvince, setAddrProvince] = useState("");
  const [addrDefault, setAddrDefault] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ShippingAddressDto | null>(
    null,
  );
  const [deletingAddress, setDeletingAddress] = useState(false);

  const loadAddresses = useCallback(async () => {
    setLoadingAddresses(true);
    try {
      const res = await apiClient.get<{ addresses: ShippingAddressDto[] }>(
        "/api/profile/addresses",
      );
      setAddresses(res.addresses ?? []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/auth", {
          replace: true,
          state: { from: "/profile/settings" },
        });
        return;
      }
      showToast(
        err instanceof Error ? err.message : "Không thể tải sổ địa chỉ.",
        "error",
      );
    } finally {
      setLoadingAddresses(false);
    }
  }, [navigate, showToast]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth", {
        replace: true,
        state: { from: "/profile/settings" },
      });
      return;
    }
    void loadAddresses();
  }, [authLoading, user, navigate, loadAddresses]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      showToast("Vui lòng nhập mật khẩu hiện tại.", "warning");
      return;
    }
    if (newPassword.length < 6) {
      showToast("Mật khẩu mới cần tối thiểu 6 ký tự.", "warning");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("Mật khẩu xác nhận không khớp.", "warning");
      return;
    }

    setChangingPassword(true);
    try {
      const res = await apiClient.post<{ ok: boolean; message?: string }>(
        "/api/profile/change-password",
        {
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        },
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast(res.message || "Đổi mật khẩu thành công!", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Đổi mật khẩu thất bại.",
        "error",
      );
    } finally {
      setChangingPassword(false);
    }
  };

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addrFullName.trim() || !addrPhone.trim() || !addrLine.trim()) {
      showToast("Vui lòng điền họ tên, số điện thoại và địa chỉ.", "warning");
      return;
    }

    setSavingAddress(true);
    try {
      await apiClient.post<{ ok: boolean; address: ShippingAddressDto }>(
        "/api/profile/addresses",
        {
          full_name: addrFullName.trim(),
          phone_number: addrPhone.trim(),
          address_line: addrLine.trim(),
          ward: addrWard.trim() || null,
          district: addrDistrict.trim() || null,
          province: addrProvince || null,
          country: "Việt Nam",
          is_default: addrDefault,
        },
      );
      setAddrFullName("");
      setAddrPhone("");
      setAddrLine("");
      setAddrWard("");
      setAddrDistrict("");
      setAddrProvince("");
      setAddrDefault(false);
      setShowAddForm(false);
      showToast("Đã thêm địa chỉ giao hàng mới.", "success");
      await loadAddresses();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Không thể lưu địa chỉ.",
        "error",
      );
    } finally {
      setSavingAddress(false);
    }
  };

  const handleSetDefault = async (addressId: number) => {
    try {
      await apiClient.post(`/api/profile/addresses/${addressId}/default`);
      setAddresses((prev) =>
        prev.map((addr) => ({
          ...addr,
          is_default: addr.id === addressId,
        })),
      );
      showToast("Đã cập nhật địa chỉ mặc định.", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Không thể đặt địa chỉ mặc định.",
        "error",
      );
    }
  };

  const handleDeleteAddress = async () => {
    if (!deleteTarget) return;
    setDeletingAddress(true);
    try {
      await apiClient.del(`/api/profile/addresses/${deleteTarget.id}`);
      setAddresses((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      showToast("Đã xóa địa chỉ.", "success");
      setDeleteTarget(null);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Xóa địa chỉ thất bại.",
        "error",
      );
    } finally {
      setDeletingAddress(false);
    }
  };

  return (
    <StoreLayout>
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Profile Navigation */}
        <div className="mb-6 flex flex-wrap gap-2">
          <Link
            to="/profile"
            className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs"
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
            className="ms-btn-2d ms-btn-2d-crimson px-4 py-2 text-xs"
          >
            <MangaIcon name="settings" className="h-3.5 w-3.5" />
            Cài đặt & Địa chỉ
          </Link>
        </div>

        <h1 className="font-display mb-6 flex items-center gap-3 text-2xl font-extrabold text-white">
          <MangaIcon name="settings" className="text-crimson-400 h-6 w-6" />
          Cài đặt bảo mật & Sổ địa chỉ
        </h1>

        <div className="grid items-start gap-8 lg:grid-cols-12">
          {/* Password Section */}
          <form
            onSubmit={(e) => void handleChangePassword(e)}
            className="ms-panel-2d space-y-4 p-6 lg:col-span-5"
          >
            <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
              <MangaIcon name="lock" className="text-crimson-400 h-5 w-5" />
              Đổi mật khẩu
            </h2>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                Mật khẩu hiện tại
              </label>
              <div className="relative">
                <input
                  type={showCurrent ? "text" : "password"}
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="focus:border-crimson-400 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 pr-10 text-sm text-white outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((prev) => !prev)}
                  aria-label="Hiện hoặc ẩn mật khẩu hiện tại"
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showCurrent ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                Mật khẩu mới (ít nhất 6 ký tự)
              </label>
              <div className="relative">
                <input
                  type={showNew ? "text" : "password"}
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="focus:border-crimson-400 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 pr-10 text-sm text-white outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowNew((prev) => !prev)}
                  aria-label="Hiện hoặc ẩn mật khẩu mới"
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showNew ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                Xác nhận mật khẩu mới
              </label>
              <div className="relative">
                <input
                  type={showConfirm ? "text" : "password"}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="focus:border-crimson-400 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 pr-10 text-sm text-white outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((prev) => !prev)}
                  aria-label="Hiện hoặc ẩn mật khẩu xác nhận"
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showConfirm ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={changingPassword}
              className="ms-btn-2d ms-btn-2d-crimson w-full py-3 text-sm disabled:opacity-50"
            >
              <MangaIcon name="shield-check" className="h-4 w-4" />
              {changingPassword ? "Đang cập nhật..." : "Cập nhật mật khẩu"}
            </button>
          </form>

          {/* Address Book Section */}
          <div className="ms-panel-2d space-y-5 p-6 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
                <MangaIcon name="map-pin" className="h-5 w-5 text-cyan-400" />
                Sổ địa chỉ giao hàng ({addresses.length})
              </h2>
              <button
                type="button"
                onClick={() => setShowAddForm((prev) => !prev)}
                className="ms-btn-2d ms-btn-2d-cyan px-4 py-2 text-xs"
              >
                <MangaIcon
                  name={showAddForm ? "x" : "plus"}
                  className="h-3.5 w-3.5"
                />
                {showAddForm ? "Đóng biểu mẫu" : "Thêm địa chỉ mới"}
              </button>
            </div>

            {showAddForm && (
              <form
                onSubmit={(e) => void handleAddAddress(e)}
                className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/75 p-4"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-300">
                      Họ tên người nhận *
                    </label>
                    <input
                      type="text"
                      required
                      value={addrFullName}
                      onChange={(e) => setAddrFullName(e.target.value)}
                      className="focus:border-cyan-400 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-300">
                      Số điện thoại *
                    </label>
                    <input
                      type="tel"
                      required
                      value={addrPhone}
                      onChange={(e) => setAddrPhone(e.target.value)}
                      className="focus:border-cyan-400 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-300">
                      Tỉnh / Thành phố
                    </label>
                    <select
                      value={addrProvince}
                      onChange={(e) => setAddrProvince(e.target.value)}
                      className="focus:border-cyan-400 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                    >
                      <option value="">-- Chọn --</option>
                      {VN_PROVINCES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-300">
                      Quận / Huyện
                    </label>
                    <input
                      type="text"
                      value={addrDistrict}
                      onChange={(e) => setAddrDistrict(e.target.value)}
                      className="focus:border-cyan-400 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-300">
                      Phường / Xã
                    </label>
                    <input
                      type="text"
                      value={addrWard}
                      onChange={(e) => setAddrWard(e.target.value)}
                      className="focus:border-cyan-400 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">
                    Số nhà, tên đường *
                  </label>
                  <input
                    type="text"
                    required
                    value={addrLine}
                    onChange={(e) => setAddrLine(e.target.value)}
                    className="focus:border-cyan-400 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                  />
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={addrDefault}
                    onChange={(e) => setAddrDefault(e.target.checked)}
                    className="accent-cyan-400"
                  />
                  Đặt làm địa chỉ giao hàng mặc định
                </label>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={savingAddress}
                    className="ms-btn-2d ms-btn-2d-crimson px-4 py-2 text-xs disabled:opacity-50"
                  >
                    {savingAddress ? "Đang lưu..." : "Lưu địa chỉ"}
                  </button>
                </div>
              </form>
            )}

            {loadingAddresses ? (
              <div className="space-y-3">
                {[1, 2].map((idx) => (
                  <div
                    key={idx}
                    className="h-24 animate-pulse rounded-xl bg-slate-900/70"
                  />
                ))}
              </div>
            ) : addresses.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-8 text-center text-sm text-slate-400">
                Bạn chưa lưu địa chỉ giao hàng nào.
              </div>
            ) : (
              <div className="space-y-3">
                {addresses.map((addr) => (
                  <div
                    key={addr.id}
                    className={`rounded-xl border p-4 ${
                      addr.is_default
                        ? "border-emerald-500/50 bg-emerald-500/5"
                        : "border-slate-700/80 bg-slate-950/60"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-white">
                            {addr.full_name}
                          </span>
                          <span className="text-xs text-slate-400">
                            · {addr.phone_number}
                          </span>
                          {addr.is_default && (
                            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                              Mặc định
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-300">
                          {[
                            addr.address_line,
                            addr.ward,
                            addr.district,
                            addr.province,
                            addr.country,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {!addr.is_default && (
                          <button
                            type="button"
                            onClick={() => void handleSetDefault(addr.id)}
                            className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20"
                          >
                            Đặt mặc định
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(addr)}
                          aria-label="Xóa địa chỉ"
                          className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-slate-400 hover:border-rose-500/50 hover:text-rose-400"
                        >
                          <MangaIcon name="trash-2" className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Xóa địa chỉ giao hàng?"
        message={
          deleteTarget
            ? `Bạn có chắc muốn xóa địa chỉ của "${deleteTarget.full_name}" khỏi sổ địa chỉ?`
            : ""
        }
        confirmLabel="Xóa địa chỉ"
        danger
        busy={deletingAddress}
        onConfirm={() => void handleDeleteAddress()}
        onCancel={() => {
          if (!deletingAddress) setDeleteTarget(null);
        }}
      />
    </StoreLayout>
  );
}

export default ProfileSettingsPage;
