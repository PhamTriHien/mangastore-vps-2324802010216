import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { apiClient } from "../../lib/api";
import { formatCurrency, formatDate, formatDateTime } from "../../lib/format";
import {
  AdminErrorState,
  AdminForbiddenCard,
  AdminLoadingState,
  getErrorMessage,
  getRoleBadgeClass,
  getRoleLabel,
} from "./adminShared";

type CustomerStatusFilter = "all" | "hoat_dong" | "bi_khoa";

interface AdminCustomerItem {
  id: number;
  username: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  role_id: number;
  role: string;
  role_name: string;
  status: string;
  last_login_at: string | null;
  created_at: string;
  total_orders: number;
  total_spent: number;
}

interface AdminCustomersResponse {
  items: AdminCustomerItem[];
  total: number;
  active: number;
  blocked: number;
}

function getCustomerStatusMeta(status: string): { label: string; badgeClass: string } {
  const norm = status.trim().toLowerCase();
  if (norm === "hoat_dong") {
    return { label: "Hoạt động", badgeClass: "bg-emerald-500/20 text-emerald-300" };
  }
  if (norm === "tam_khoa") {
    return { label: "Tạm khóa", badgeClass: "bg-amber-500/20 text-amber-300" };
  }
  if (norm === "khoa_vinh_vien") {
    return { label: "Khóa vĩnh viễn", badgeClass: "bg-red-500/25 text-red-300" };
  }
  return { label: "Bị khóa", badgeClass: "bg-red-500/20 text-red-300" };
}

export function AdminCustomersPage() {
  const { user: currentUser, isFullAdmin } = useAuth();
  const { showToast } = useToast();

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CustomerStatusFilter>("all");

  const [customers, setCustomers] = useState<AdminCustomerItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [blockedCount, setBlockedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminCustomerItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadCustomers = useCallback(async () => {
    if (!isFullAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const qs = params.toString();
      const res = await apiClient.get<AdminCustomersResponse>(
        `/api/admin/customers${qs ? `?${qs}` : ""}`
      );
      setCustomers(res.items ?? []);
      setTotalCount(res.total ?? 0);
      setActiveCount(res.active ?? 0);
      setBlockedCount(res.blocked ?? 0);
    } catch (err) {
      setError(getErrorMessage(err, "Không thể tải danh sách khách hàng."));
    } finally {
      setLoading(false);
    }
  }, [isFullAdmin, debouncedSearch, statusFilter]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  if (!isFullAdmin) {
    return (
      <AdminForbiddenCard message="Chỉ Quản trị viên (Role 1) mới có quyền truy cập Quản lý khách hàng." />
    );
  }

  const handleToggleStatus = async (customer: AdminCustomerItem) => {
    setTogglingId(customer.id);
    try {
      const res = await apiClient.post<{
        id: number;
        status: string;
        message: string;
      }>(`/api/admin/customers/${customer.id}/toggle-status`);
      showToast(res.message || "Đã cập nhật trạng thái tài khoản!", "success");
      await loadCustomers();
    } catch (err) {
      showToast(getErrorMessage(err, "Không thể thay đổi trạng thái tài khoản."), "error");
    } finally {
      setTogglingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await apiClient.del<{
        success: boolean;
        deleted_id: number;
        message: string;
      }>(`/api/admin/customers/${deleteTarget.id}`);
      showToast(res.message || "Đã xóa tài khoản khách hàng!", "success");
      setDeleteTarget(null);
      await loadCustomers();
    } catch (err) {
      showToast(getErrorMessage(err, "Không thể xóa tài khoản khách hàng."), "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-white/10 pb-6">
        <h1 className="font-display text-3xl font-bold text-[#F5F6FA]">
          Quản lý khách hàng
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-5 shadow-lg backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/15 text-[#22D3EE]">
              <MangaIcon name="users" className="h-6 w-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#F5F6FA]">{totalCount}</p>
              <p className="text-sm text-slate-400">Tổng tài khoản</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-5 shadow-lg backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
              <MangaIcon name="user-check" className="h-6 w-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#F5F6FA]">{activeCount}</p>
              <p className="text-sm text-slate-400">Đang hoạt động</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-5 shadow-lg backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/15 text-red-400">
              <MangaIcon name="user-x" className="h-6 w-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#F5F6FA]">{blockedCount}</p>
              <p className="text-sm text-slate-400">Bị khóa</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full max-w-md">
          <MangaIcon
            name="search"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm theo tên, email, SĐT..."
            aria-label="Tìm kiếm khách hàng"
            className="w-full rounded-xl border border-white/15 bg-[#1B2130] py-2.5 pl-10 pr-9 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Xóa từ khóa tìm kiếm"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <MangaIcon name="x" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-400">Lọc:</span>
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-all ${
              statusFilter === "all"
                ? "bg-[#E63946] text-white shadow-lg shadow-[#E63946]/25"
                : "border border-white/10 bg-[#131722]/90 text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            Tất cả
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("hoat_dong")}
            className={`rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-all ${
              statusFilter === "hoat_dong"
                ? "bg-emerald-500 text-slate-950 shadow-lg"
                : "border border-white/10 bg-[#131722]/90 text-slate-300 hover:bg-emerald-500/15 hover:text-emerald-300"
            }`}
          >
            Hoạt động
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("bi_khoa")}
            className={`rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-all ${
              statusFilter === "bi_khoa"
                ? "bg-red-500 text-white shadow-lg"
                : "border border-white/10 bg-[#131722]/90 text-slate-300 hover:bg-red-500/15 hover:text-red-300"
            }`}
          >
            Bị khóa
          </button>
        </div>
      </div>

      {loading ? (
        <AdminLoadingState label="Đang tải danh sách khách hàng..." />
      ) : error ? (
        <AdminErrorState message={error} onRetry={() => void loadCustomers()} />
      ) : (
        <div className="rounded-3xl border border-white/10 bg-[#131722]/90 p-5 shadow-xl backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-3 pr-3">ID</th>
                  <th className="py-3 pr-4">Tài khoản</th>
                  <th className="py-3 pr-4">Liên hệ</th>
                  <th className="py-3 pr-4">Vai trò</th>
                  <th className="py-3 pr-4 text-center">Đơn hàng</th>
                  <th className="py-3 pr-4 text-right">Tổng chi tiêu</th>
                  <th className="py-3 pr-4 text-center">Trạng thái</th>
                  <th className="py-3 pr-4">Đăng nhập cuối</th>
                  <th className="py-3 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {customers.length > 0 ? (
                  customers.map((customer) => {
                    const statusMeta = getCustomerStatusMeta(customer.status);
                    const isSelf = currentUser?.id === customer.id;
                    const isTargetAdmin = customer.role_id === 1;
                    const isActive = customer.status.toLowerCase() === "hoat_dong";
                    const isToggling = togglingId === customer.id;

                    return (
                      <tr key={customer.id} className="transition-colors hover:bg-white/5">
                        <td className="py-4 pr-3 font-mono text-xs text-slate-400">
                          #{customer.id}
                        </td>
                        <td className="py-4 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E63946]/30 bg-[#E63946]/15 font-semibold text-[#FF6B77]">
                              {customer.username.slice(0, 1).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-semibold text-[#F5F6FA]">
                                {customer.username}
                              </p>
                              <p className="text-xs text-slate-400">
                                Tham gia: {formatDate(customer.created_at)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          <p className="text-[#F5F6FA]">{customer.email}</p>
                          {customer.phone ? (
                            <p className="text-xs text-slate-400">{customer.phone}</p>
                          ) : null}
                        </td>
                        <td className="py-4 pr-4">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${getRoleBadgeClass(
                              customer.role_id
                            )}`}
                          >
                            <MangaIcon name="shield" className="h-3 w-3" />
                            <span>{getRoleLabel(customer.role_id, customer.role_name)}</span>
                          </span>
                        </td>
                        <td className="py-4 pr-4 text-center font-semibold text-[#F5F6FA]">
                          {customer.total_orders}
                        </td>
                        <td className="py-4 pr-4 text-right font-semibold text-[#F59E0B]">
                          {formatCurrency(customer.total_spent)}
                        </td>
                        <td className="py-4 pr-4 text-center">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.badgeClass}`}
                          >
                            {statusMeta.label}
                          </span>
                        </td>
                        <td className="py-4 pr-4 text-slate-300">
                          {customer.last_login_at ? (
                            <span>{formatDateTime(customer.last_login_at)}</span>
                          ) : (
                            <span className="text-slate-500">Chưa đăng nhập</span>
                          )}
                        </td>
                        <td className="py-4">
                          <div className="flex items-center justify-center gap-2">
                            <Link
                              to={`/admin/customers/${customer.id}/edit`}
                              className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:border-[#22D3EE]/50 hover:text-[#22D3EE]"
                            >
                              <MangaIcon name="pencil" className="h-3.5 w-3.5" />
                              <span>Sửa</span>
                            </Link>

                            {!isTargetAdmin && !isSelf ? (
                              <>
                                <button
                                  type="button"
                                  disabled={isToggling}
                                  onClick={() => void handleToggleStatus(customer)}
                                  title={
                                    isActive ? "Khóa tài khoản" : "Mở khóa tài khoản"
                                  }
                                  className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                                    isActive
                                      ? "border-amber-500/30 text-amber-300 hover:bg-amber-500/15"
                                      : "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15"
                                  }`}
                                >
                                  {isToggling ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <MangaIcon
                                      name={isActive ? "lock" : "unlock"}
                                      className="h-3.5 w-3.5"
                                    />
                                  )}
                                  <span>{isActive ? "Khóa" : "Mở khóa"}</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setDeleteTarget(customer)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/15"
                                >
                                  <MangaIcon name="trash-2" className="h-3.5 w-3.5" />
                                  <span>Xóa</span>
                                </button>
                              </>
                            ) : (
                              <span className="text-xs italic text-slate-500">
                                {isSelf ? "Tài khoản hiện tại" : "Admin"}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      <MangaIcon
                        name="users"
                        className="mx-auto mb-3 h-12 w-12 text-slate-500"
                      />
                      <p className="font-semibold text-slate-200">
                        Không tìm thấy tài khoản nào
                      </p>
                      <p className="mt-1 text-sm">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Xóa tài khoản khách hàng"
        message={
          deleteTarget
            ? `Bạn có chắc muốn xóa tài khoản "${deleteTarget.username}"? Thao tác này không thể hoàn tác.`
            : ""
        }
        confirmLabel="Xóa tài khoản"
        danger
        busy={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
    </div>
  );
}

export default AdminCustomersPage;
