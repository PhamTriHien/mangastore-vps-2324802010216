import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { apiClient } from "../../lib/api";
import { formatCurrency, formatDate, formatDateTime } from "../../lib/format";
import {
  AdminErrorState,
  AdminLoadingState,
  getErrorMessage,
  handleCoverError,
  resolveImageUrl,
} from "./adminShared";

interface ImportedProductItem {
  id: number;
  title: string;
  cover_url: string | null;
  price: number;
  stock_quantity: number;
  status: string;
}

interface ImportHistoryDetailResponse {
  id: number;
  batch_id: string;
  imported_at: string;
  imported_by: string | null;
  product_count: number;
  is_zip_import: boolean;
  file_name: string | null;
  is_restored: boolean;
  restored_at: string | null;
  restored_by: string | null;
  products: ImportedProductItem[];
}

interface RestoreBatchResponse {
  success: boolean;
  batch_id: string;
  products_deleted: number;
  products_archived: number;
  images_deleted: number;
  message: string;
}

export function AdminImportHistoryDetailPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const { isFullAdmin } = useAuth();
  const { showToast } = useToast();

  const [detail, setDetail] = useState<ImportHistoryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!batchId) {
      setError("Mã đợt nhập không hợp lệ.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ImportHistoryDetailResponse>(
        `/api/admin/import/history/${encodeURIComponent(batchId)}`
      );
      setDetail(res);
    } catch (err) {
      setError(getErrorMessage(err, "Không thể tải chi tiết đợt nhập."));
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleConfirmRestore = async () => {
    if (!detail) return;
    setRestoring(true);
    try {
      const res = await apiClient.post<RestoreBatchResponse>(
        `/api/admin/import/history/${encodeURIComponent(detail.batch_id)}/restore`
      );
      showToast(res.message || "Đã hoàn tác đợt nhập thành công!", "success");
      setConfirmOpen(false);
      await loadDetail();
    } catch (err) {
      showToast(getErrorMessage(err, "Không thể hoàn tác đợt nhập này."), "error");
    } finally {
      setRestoring(false);
    }
  };

  if (loading) {
    return <AdminLoadingState label="Đang tải chi tiết đợt nhập..." />;
  }

  if (error || !detail) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-5">
          <h1 className="font-display text-2xl font-bold text-[#F5F6FA]">Chi tiết Import</h1>
          <Link
            to="/admin/import/history"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#131722] px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-[#1B2130]"
          >
            <MangaIcon name="arrow-left" className="h-4 w-4" />
            <span>Quay lại</span>
          </Link>
        </div>
        <AdminErrorState
          message={error ?? "Không tìm thấy thông tin đợt nhập."}
          onRetry={() => void loadDetail()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-[#F5F6FA]">Chi tiết Import</h1>
          <p className="mt-1 text-sm text-slate-400">
            Mã đợt nhập:{" "}
            <code className="rounded border border-white/10 bg-[#1B2130] px-2 py-0.5 text-xs text-slate-200">
              {detail.batch_id}
            </code>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/admin/import/history"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#131722] px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-[#1B2130]"
          >
            <MangaIcon name="arrow-left" className="h-4 w-4" />
            <span>Quay lại</span>
          </Link>
          {isFullAdmin && !detail.is_restored ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold text-white"
            >
              <MangaIcon name="undo-2" className="h-4 w-4" />
              <span>Hoàn tác Import</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/15 text-[#22D3EE]">
              <MangaIcon name="calendar" className="h-5 w-5" />
            </span>
            <div>
              <p className="text-lg font-bold text-[#F5F6FA]">
                {formatDate(detail.imported_at)}
              </p>
              <p className="text-xs text-slate-400">{formatDateTime(detail.imported_at)}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
              <MangaIcon name="package" className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-bold text-emerald-400">{detail.product_count}</p>
              <p className="text-sm text-slate-400">Sản phẩm</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/15 text-[#F59E0B]">
              <MangaIcon
                name={detail.is_zip_import ? "archive" : "file-spreadsheet"}
                className="h-5 w-5"
              />
            </span>
            <div className="min-w-0">
              <p
                className="truncate text-sm font-bold text-[#F5F6FA]"
                title={detail.file_name ?? ""}
              >
                {detail.file_name || "Không rõ"}
              </p>
              <p className="text-xs text-slate-400">
                {detail.is_zip_import ? "ZIP + Ảnh" : "Excel"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-4 shadow-lg">
          <div className="flex items-center gap-3">
            {detail.is_restored ? (
              <>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-orange-500/30 bg-orange-500/15 text-orange-400">
                  <MangaIcon name="undo-2" className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-bold text-orange-400">Đã hoàn tác</p>
                  <p className="text-xs text-slate-400">
                    {detail.restored_at ? formatDateTime(detail.restored_at) : ""}
                  </p>
                </div>
              </>
            ) : (
              <>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                  <MangaIcon name="check-circle" className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-bold text-emerald-400">Đang hoạt động</p>
                  <p className="text-xs text-slate-400">
                    Bởi {detail.imported_by || "Admin"}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {detail.is_restored ? (
        <div className="flex items-start gap-2.5 rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-300">
          <MangaIcon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Đợt nhập này đã được hoàn tác</p>
            <p>
              Thực hiện lúc{" "}
              {detail.restored_at ? formatDateTime(detail.restored_at) : "—"} bởi{" "}
              {detail.restored_by || "Admin"}.
            </p>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-5 shadow-xl backdrop-blur-xl">
        <h2 className="mb-4 font-display text-lg font-semibold text-[#F5F6FA]">
          Danh sách sản phẩm trong đợt nhập
        </h2>

        {detail.products.length === 0 ? (
          <div className="py-10 text-center text-slate-400">
            <MangaIcon name="package-x" className="mx-auto h-12 w-12 opacity-50" />
            <p className="mt-2">
              {detail.is_restored
                ? "Các sản phẩm chưa phát sinh đơn hàng trong đợt nhập này đã được xóa."
                : "Không có dữ liệu sản phẩm."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4">ID</th>
                  <th className="py-2 pr-4">Ảnh</th>
                  <th className="py-2 pr-4">Tên sản phẩm</th>
                  <th className="py-2 pr-4 text-right">Giá bán</th>
                  <th className="py-2 pr-4 text-center">Tồn kho</th>
                  <th className="py-2 pr-4 text-center">Trạng thái</th>
                  {!detail.is_restored ? <th className="py-2 text-right">Thao tác</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {detail.products.map((prod) => (
                  <tr key={prod.id} className="transition-colors hover:bg-white/5">
                    <td className="py-3 pr-4 font-mono text-xs text-slate-400">#{prod.id}</td>
                    <td className="py-3 pr-4">
                      <img
                        src={resolveImageUrl(prod.cover_url)}
                        alt={prod.title}
                        onError={handleCoverError}
                        className="h-12 w-9 rounded-lg bg-[#1B2130] object-cover shadow"
                      />
                    </td>
                    <td className="py-3 pr-4 font-semibold text-[#F5F6FA]">{prod.title}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-[#F59E0B]">
                      {formatCurrency(prod.price)}
                    </td>
                    <td className="py-3 pr-4 text-center text-slate-300">
                      {prod.stock_quantity}
                    </td>
                    <td className="py-3 pr-4 text-center">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          prod.status === "dang_ban"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : prod.status === "ngung_ban"
                              ? "bg-slate-500/20 text-slate-300"
                              : "bg-red-500/20 text-red-300"
                        }`}
                      >
                        {prod.status === "dang_ban"
                          ? "Đang bán"
                          : prod.status === "ngung_ban"
                            ? "Ngừng bán"
                            : "Hết hàng"}
                      </span>
                    </td>
                    {!detail.is_restored ? (
                      <td className="py-3 text-right">
                        <Link
                          to={`/admin/products/${prod.id}/edit`}
                          className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-[#22D3EE] transition-colors hover:bg-cyan-500/25"
                        >
                          <MangaIcon name="edit-2" className="h-3.5 w-3.5" />
                          <span>Sửa</span>
                        </Link>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Xác nhận hoàn tác Import"
        message={`Hoàn tác đợt nhập "${detail.file_name || detail.batch_id}" (${detail.product_count} sản phẩm)? Các sản phẩm chưa phát sinh đơn hàng sẽ bị xóa vĩnh viễn cùng ảnh đã import.`}
        confirmLabel="Hoàn tác Import"
        danger
        busy={restoring}
        onConfirm={() => void handleConfirmRestore()}
        onCancel={() => {
          if (!restoring) setConfirmOpen(false);
        }}
      />
    </div>
  );
}

export default AdminImportHistoryDetailPage;
