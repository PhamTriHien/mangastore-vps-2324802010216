import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { apiClient } from "../../lib/api";
import {
  AdminErrorState,
  AdminForbiddenCard,
  AdminLoadingState,
  getErrorMessage,
} from "./adminShared";

interface RoleOption {
  id: number;
  code: string;
  display_name: string;
}

interface CustomerDetailPayload {
  id: number;
  username: string;
  email: string;
  phone: string | null;
  role_id: number;
  status: string;
  available_roles?: RoleOption[];
}

const DEFAULT_ROLES: readonly RoleOption[] = [
  { id: 1, code: "quan_tri_vien", display_name: "Quản trị viên" },
  { id: 2, code: "nhan_vien", display_name: "Nhân viên" },
  { id: 3, code: "khach_hang", display_name: "Khách hàng" },
];

const ACCOUNT_STATUS_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "hoat_dong", label: "Hoạt động" },
  { value: "bi_khoa", label: "Bị khóa" },
  { value: "tam_khoa", label: "Tạm khóa" },
  { value: "khoa_vinh_vien", label: "Khóa vĩnh viễn" },
];

export function AdminCustomerEditPage() {
  const { id } = useParams<{ id: string }>();
  const { isFullAdmin } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roleId, setRoleId] = useState<number>(3);
  const [status, setStatus] = useState("hoat_dong");
  const [roles, setRoles] = useState<RoleOption[]>([...DEFAULT_ROLES]);

  const loadCustomer = useCallback(async () => {
    if (!isFullAdmin || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiClient.get<CustomerDetailPayload>(`/api/admin/customers/${id}`);
      setUsername(data.username ?? "");
      setEmail(data.email ?? "");
      setPhone(data.phone ?? "");
      setRoleId(data.role_id ?? 3);
      setStatus(data.status || "hoat_dong");
      if (data.available_roles && data.available_roles.length > 0) {
        setRoles(data.available_roles);
      }
    } catch (err) {
      setLoadError(getErrorMessage(err, "Không thể tải thông tin khách hàng."));
    } finally {
      setLoading(false);
    }
  }, [id, isFullAdmin]);

  useEffect(() => {
    void loadCustomer();
  }, [loadCustomer]);

  if (!isFullAdmin) {
    return (
      <AdminForbiddenCard message="Chỉ Quản trị viên (Role 1) mới có quyền chỉnh sửa thông tin tài khoản." />
    );
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id) return;
    setFormError(null);

    const cleanedUsername = username.trim();
    const cleanedEmail = email.trim();
    if (!cleanedUsername || !cleanedEmail) {
      setFormError("Tên đăng nhập và email không được để trống.");
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.put(`/api/admin/customers/${id}`, {
        username: cleanedUsername,
        email: cleanedEmail,
        phone: phone.trim() || null,
        role_id: roleId,
        status,
      });
      showToast("Đã cập nhật thông tin tài khoản thành công!", "success");
      navigate("/admin/customers");
    } catch (err) {
      const msg = getErrorMessage(err, "Không thể cập nhật thông tin khách hàng.");
      setFormError(msg);
      showToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <AdminLoadingState label="Đang tải thông tin tài khoản..." />;
  }

  if (loadError) {
    return <AdminErrorState message={loadError} onRetry={() => void loadCustomer()} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-4 border-b border-white/10 pb-6">
        <Link
          to="/admin/customers"
          aria-label="Quay lại danh sách khách hàng"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-[#131722] text-slate-300 transition-colors hover:border-[#E63946]/60 hover:text-white"
        >
          <MangaIcon name="arrow-left" className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold text-[#F5F6FA]">
            Chỉnh sửa tài khoản #{id}
          </h1>
        </div>
      </div>

      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300"
        >
          <MangaIcon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-[#131722]/90 p-6 shadow-xl backdrop-blur-xl sm:p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="cust-username"
              className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-300"
            >
              <MangaIcon name="user" className="h-4 w-4 text-[#22D3EE]" />
              <span>Tên đăng nhập</span>
            </label>
            <input
              id="cust-username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Nhập tên đăng nhập"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="cust-email"
              className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-300"
            >
              <MangaIcon name="mail" className="h-4 w-4 text-[#22D3EE]" />
              <span>Email</span>
            </label>
            <input
              id="cust-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Nhập email"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="cust-phone"
              className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-300"
            >
              <MangaIcon name="phone" className="h-4 w-4 text-[#22D3EE]" />
              <span>Số điện thoại</span>
            </label>
            <input
              id="cust-phone"
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Nhập số điện thoại"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="cust-role"
              className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-300"
            >
              <MangaIcon name="shield" className="h-4 w-4 text-[#F59E0B]" />
              <span>Vai trò</span>
            </label>
            <select
              id="cust-role"
              value={roleId}
              onChange={(e) => setRoleId(Number(e.target.value))}
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-[#F5F6FA] focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.display_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="cust-status"
              className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-300"
            >
              <MangaIcon name="toggle-left" className="h-4 w-4 text-emerald-400" />
              <span>Trạng thái</span>
            </label>
            <select
              id="cust-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-[#F5F6FA] focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            >
              {ACCOUNT_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-3 pt-4 sm:flex-row">
            <button
              type="submit"
              disabled={submitting}
              className="ms-btn-2d ms-btn-2d-crimson flex flex-1 items-center justify-center gap-2 rounded-xl border px-6 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MangaIcon name="save" className="h-4 w-4" />
              )}
              <span>{submitting ? "Đang lưu..." : "Lưu thay đổi"}</span>
            </button>
            <Link
              to="/admin/customers"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#1B2130] px-6 py-3 font-semibold text-slate-200 transition-colors hover:bg-white/10"
            >
              <MangaIcon name="x" className="h-4 w-4" />
              <span>Hủy bỏ</span>
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AdminCustomerEditPage;
