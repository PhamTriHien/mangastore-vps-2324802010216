import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { apiClient } from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";
import { AdminErrorState, AdminLoadingState, getErrorMessage } from "./adminShared";

interface ImportHistoryItem {
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
}

interface ImportHistoryResponse {
  items: ImportHistoryItem[];
  total: number;
  page: number;
  page_size: number;
}

interface RestoreBatchResponse {
  success: boolean;
  batch_id: string;
  products_deleted: number;
  products_archived: number;
  images_deleted: number;
  message: string;
}

const PAGE_SIZE = 10;

export function AdminImportHistoryPage() {
  const { isFullAdmin } = useAuth();
  const { showToast } = useToast();

  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ImportHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [restoreTarget, setRestoreTarget] = useState<ImportHistoryItem | null>(null);
  const [restoring, setRestoring] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ImportHistoryResponse>(
        `/api/admin/import/history?page=${page}&page_size=${PAGE_SIZE}`
      );
      setItems(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      setError(getErrorMessage(err, "Không thể tải lịch sử import."));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handleConfirmRestore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const res = await apiClient.post<RestoreBatchResponse>(
        `/api/admin/import/history/${encodeURIComponent(restoreTarget.batch_id)}/restore`
      );
      showToast(res.message || "Đã hoàn tác đợt nhập thành công!", "success");
      setRestoreTarget(null);
      await loadHistory();
    } catch (err) {
      showToast(getErrorMessage(err, "Không thể hoàn tác đợt nhập này."), "error");
    } finally {
      setRestoring(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-[#F5F6FA]">Lịch sử Import</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/admin/products"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#131722] px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-[#1B2130]"
          >
            <MangaIcon name="arrow-left" className="h-4 w-4" />
            <span>Quản lý sản phẩm</span>
          </Link>
          <Link
            to="/admin/import"
            className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold text-white"
          >
            <MangaIcon name="upload" className="h-4 w-4" />
            <span>Import mới</span>
          </Link>
        </div>
      </div>

      {loading ? (
        <AdminLoadingState label="Đang tải lịch sử nhập hàng..." />
      ) : error ? (
        <AdminErrorState message={error} onRetry={() => void loadHistory()} />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#131722]/90 py-14 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-[#1B2130] text-slate-400">
            <MangaIcon name="history" className="h-8 w-8" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-[#F5F6FA]">
            Chưa có lịch sử import
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Các đợt nhập hàng Excel hoặc ZIP sẽ hiển thị tại đây.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-4 shadow-xl backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-3 pr-4">Thời gian</th>
                  <th className="py-3 pr-4">Mã đợt</th>
                  <th className="py-3 pr-4">Tệp</th>
                  <th className="py-3 pr-4 text-center">Số SP</th>
                  <th className="py-3 pr-4">Người nhập</th>
                  <th className="py-3 pr-4">Loại</th>
                  <th className="py-3 pr-4 text-center">Trạng thái</th>
                  <th className="py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {items.map((item) => (
                  <tr key={item.batch_id} className="transition-colors hover:bg-white/5">
                    <td className="whitespace-nowrap py-3 pr-4">
                      <div className="font-medium text-[#F5F6FA]">
                        {formatDate(item.imported_at)}
                      </div>
                      <div className="text-xs text-slate-400">
                        {formatDateTime(item.imported_at)}
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-300">
                      {item.batch_id}
                    </td>
                    <td className="max-w-xs truncate py-3 pr-4" title={item.file_name ?? ""}>
                      <div className="flex items-center gap-2">
                        <MangaIcon
                          name={item.is_zip_import ? "archive" : "file-spreadsheet"}
                          className={`h-4 w-4 ${
                            item.is_zip_import ? "text-[#F59E0B]" : "text-emerald-400"
                          }`}
                        />
                        <span className="truncate font-medium text-slate-200">
                          {item.file_name || "Không rõ"}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-center">
                      <span className="inline-flex items-center justify-center rounded-full bg-cyan-500/20 px-2.5 py-1 text-sm font-bold text-[#22D3EE]">
                        {item.product_count}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-300">
                      {item.imported_by || "Admin"}
                    </td>
                    <td className="py-3 pr-4">
                      {item.is_zip_import ? (
                        <span className="inline-flex rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-[#F59E0B]">
                          ZIP + Ảnh
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                          Excel
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-center">
                      {item.is_restored ? (
                        <div>
                          <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/20 px-2.5 py-0.5 text-xs font-semibold text-orange-300">
                            <MangaIcon name="undo-2" className="h-3 w-3" />
                            <span>Đã hoàn tác</span>
                          </span>
                          {item.restored_at ? (
                            <p className="mt-1 text-xs text-slate-400">
                              {formatDateTime(item.restored_at)}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                          <MangaIcon name="check" className="h-3 w-3" />
                          <span>Hoạt động</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/admin/import/history/${item.batch_id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-[#22D3EE] transition-colors hover:bg-cyan-500/25"
                        >
                          <MangaIcon name="eye" className="h-3.5 w-3.5" />
                          <span>Chi tiết</span>
                        </Link>
                        {isFullAdmin && !item.is_restored ? (
                          <button
                            type="button"
                            onClick={() => setRestoreTarget(item)}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/25"
                          >
                            <MangaIcon name="undo-2" className="h-3.5 w-3.5" />
                            <span>Hoàn tác Import</span>
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
              <p className="text-sm text-slate-400">
                Trang {page} / {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-[#1B2130] px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:opacity-40"
                >
                  <MangaIcon name="chevron-left" className="h-4 w-4" />
                  <span>Trước</span>
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-[#1B2130] px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:opacity-40"
                >
                  <span>Sau</span>
                  <MangaIcon name="chevron-right" className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={restoreTarget !== null}
        title="Xác nhận hoàn tác Import"
        message={
          restoreTarget
            ? `Hoàn tác đợt nhập "${restoreTarget.file_name || restoreTarget.batch_id}" (${restoreTarget.product_count} sản phẩm)? Các sản phẩm chưa phát sinh đơn hàng sẽ bị xóa vĩnh viễn cùng ảnh đã tải lên.`
            : ""
        }
        confirmLabel="Hoàn tác Import"
        danger
        busy={restoring}
        onConfirm={() => void handleConfirmRestore()}
        onCancel={() => {
          if (!restoring) setRestoreTarget(null);
        }}
      />
    </div>
  );
}

export default AdminImportHistoryPage;
