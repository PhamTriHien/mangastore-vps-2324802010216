import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { useToast } from "../../contexts/ToastContext";
import { apiClient, downloadFileWithAuth } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { getErrorMessage } from "./adminShared";

interface ImportPreviewRow {
  row_number: number;
  name: string;
  category: string;
  price: number;
  original_price: number | null;
  stock_quantity: number;
  author: string;
  publisher: string | null;
  description: string;
  tags: string;
  is_featured: boolean;
  cover_image_file: string;
  gallery_image_files: string;
  is_valid: boolean;
  errors: string[];
}

interface ImportPreviewResponse {
  import_token: string;
  file_name: string;
  is_zip_import: boolean;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  images_found: number;
  products: ImportPreviewRow[];
}

interface ImportExecuteError {
  row_number: number;
  product_name: string;
  error_message: string;
}

interface ImportExecuteResponse {
  success: boolean;
  batch_id: string | null;
  message: string;
  total_processed: number;
  success_count: number;
  failed_count: number;
  errors: ImportExecuteError[];
}

export function AdminImportPage() {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [downloadingType, setDownloadingType] = useState<"excel" | "zip" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [result, setResult] = useState<ImportExecuteResponse | null>(null);

  const applyFile = (file: File | null) => {
    setUploadError(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls") && !lower.endsWith(".zip")) {
      setUploadError("Chỉ hỗ trợ file Excel (.xlsx, .xls) hoặc ZIP.");
      return;
    }
    setSelectedFile(file);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    applyFile(event.target.files?.[0] ?? null);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    applyFile(file);
  };

  const handlePreviewSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUploadError(null);

    if (!selectedFile) {
      setUploadError("Vui lòng chọn tệp Excel hoặc ZIP trước khi tải lên.");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    setPreviewLoading(true);
    try {
      const res = await apiClient.post<ImportPreviewResponse>(
        "/api/admin/import/preview",
        formData
      );
      setPreview(res);
      setResult(null);
      showToast(`Đã phân tích ${res.total_rows} dòng từ ${res.file_name}.`, "info");
    } catch (err) {
      const msg = getErrorMessage(err, "Không thể đọc tệp nhập dữ liệu.");
      setUploadError(msg);
      showToast(msg, "error");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!preview) return;
    setExecuting(true);
    try {
      const res = await apiClient.post<ImportExecuteResponse>("/api/admin/import/execute", {
        import_token: preview.import_token,
      });
      setResult(res);
      setPreview(null);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      showToast(res.message, res.success ? "success" : "warning");
    } catch (err) {
      showToast(getErrorMessage(err, "Không thể thực hiện import dữ liệu."), "error");
    } finally {
      setExecuting(false);
    }
  };

  const handleCancelImport = async () => {
    if (!preview) return;
    setCancelling(true);
    try {
      await apiClient.post("/api/admin/import/cancel", {
        import_token: preview.import_token,
      });
      showToast("Đã hủy phiên nhập dữ liệu.", "info");
    } catch {
      // Ignore cancel cleanup errors and reset local state
    } finally {
      setCancelling(false);
      setPreview(null);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownloadTemplate = async (type: "excel" | "zip") => {
    setDownloadingType(type);
    try {
      if (type === "excel") {
        await downloadFileWithAuth(
          "/api/admin/import/template?type=excel",
          "Template_Import_SanPham.xlsx"
        );
      } else {
        await downloadFileWithAuth(
          "/api/admin/import/template?type=zip",
          "Template_Import_SanPham.zip"
        );
      }
      showToast("Đã tải tệp mẫu thành công.", "success");
    } catch (err) {
      showToast(getErrorMessage(err, "Không thể tải tệp mẫu."), "error");
    } finally {
      setDownloadingType(null);
    }
  };

  const handleResetAll = () => {
    setResult(null);
    setPreview(null);
    setSelectedFile(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isSelectedZip = selectedFile?.name.toLowerCase().endsWith(".zip") ?? false;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-[#F5F6FA]">
            Nhập hàng hàng loạt (Excel / ZIP)
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/admin/import/history"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#131722] px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-white/30 hover:bg-[#1B2130]"
          >
            <MangaIcon name="history" className="h-4 w-4" />
            <span>Lịch sử Import</span>
          </Link>
          <Link
            to="/admin/products"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#131722] px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-[#E63946]/50 hover:text-white"
          >
            <MangaIcon name="arrow-left" className="h-4 w-4" />
            <span>Quản lý sản phẩm</span>
          </Link>
        </div>
      </div>

      {result ? (
        <div className="space-y-6">
          <div
            className={`flex items-center gap-4 rounded-2xl border p-6 shadow-lg ${
              result.success
                ? "border-emerald-500/35 bg-emerald-500/10"
                : "border-red-500/35 bg-red-500/10"
            }`}
          >
            <span
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border ${
                result.success
                  ? "border-emerald-500/35 bg-emerald-500/20 text-emerald-400"
                  : "border-red-500/35 bg-red-500/20 text-red-400"
              }`}
            >
              <MangaIcon
                name={result.success ? "check-circle-2" : "x-circle"}
                className="h-8 w-8"
              />
            </span>
            <div className="min-w-0 flex-1">
              <h2
                className={`font-display text-2xl font-bold ${
                  result.success ? "text-emerald-300" : "text-red-300"
                }`}
              >
                {result.success ? "Import hoàn tất!" : "Import thất bại"}
              </h2>
              <p className={result.success ? "text-emerald-200" : "text-red-300"}>
                {result.message}
              </p>
              {result.batch_id ? (
                <div className="mt-2">
                  <Link
                    to={`/admin/import/history/${result.batch_id}`}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#22D3EE] hover:underline"
                  >
                    <span>Xem chi tiết đợt nhập #{result.batch_id}</span>
                    <MangaIcon name="arrow-right" className="h-4 w-4" />
                  </Link>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-5 shadow-lg">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/15 text-[#22D3EE]">
                  <MangaIcon name="file-spreadsheet" className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-2xl font-bold text-[#F5F6FA]">
                    {result.total_processed}
                  </p>
                  <p className="text-sm text-slate-400">Tổng xử lý</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-5 shadow-lg">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                  <MangaIcon name="check-circle" className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-2xl font-bold text-emerald-400">
                    {result.success_count}
                  </p>
                  <p className="text-sm text-slate-400">Thành công</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-5 shadow-lg">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/15 text-red-400">
                  <MangaIcon name="x-circle" className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-2xl font-bold text-red-400">{result.failed_count}</p>
                  <p className="text-sm text-slate-400">Thất bại</p>
                </div>
              </div>
            </div>
          </div>

          {result.errors.length > 0 ? (
            <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-5 shadow-xl">
              <h3 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-[#F5F6FA]">
                <MangaIcon name="alert-triangle" className="h-5 w-5 text-red-400" />
                <span>Chi tiết dòng lỗi</span>
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/10 text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <th className="py-2 pr-4">Dòng</th>
                      <th className="py-2 pr-4">Sản phẩm</th>
                      <th className="py-2">Lỗi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {result.errors.map((errItem, idx) => (
                      <tr key={`${errItem.row_number}-${idx}`} className="hover:bg-red-500/10">
                        <td className="py-2 pr-4 font-mono text-slate-400">
                          {errItem.row_number}
                        </td>
                        <td className="py-2 pr-4 font-semibold text-[#F5F6FA]">
                          {errItem.product_name}
                        </td>
                        <td className="py-2 text-red-400">{errItem.error_message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={handleResetAll}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#1B2130] px-6 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-[#E63946]/50 hover:text-white"
            >
              <MangaIcon name="upload" className="h-4 w-4" />
              <span>Import thêm</span>
            </button>
            <Link
              to="/admin/products"
              className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-xl border px-6 py-3 text-sm font-semibold text-white"
            >
              <MangaIcon name="package" className="h-4 w-4" />
              <span>Xem danh sách sản phẩm</span>
            </Link>
          </div>
        </div>
      ) : preview ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-2xl font-bold text-[#F5F6FA]">
              Xem trước: {preview.file_name}
            </h2>
            {preview.is_zip_import ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#F59E0B]/30 bg-[#F59E0B]/15 px-3 py-1 text-xs font-semibold text-[#F59E0B]">
                <MangaIcon name="archive" className="h-3.5 w-3.5" />
                <span>ZIP + Ảnh</span>
              </span>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-4 shadow-lg">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/15 text-[#22D3EE]">
                  <MangaIcon name="file-spreadsheet" className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-2xl font-bold text-[#F5F6FA]">{preview.total_rows}</p>
                  <p className="text-sm text-slate-400">Tổng số dòng</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-4 shadow-lg">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                  <MangaIcon name="check-circle" className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-2xl font-bold text-emerald-400">{preview.valid_rows}</p>
                  <p className="text-sm text-slate-400">Hợp lệ</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-4 shadow-lg">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/15 text-red-400">
                  <MangaIcon name="x-circle" className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-2xl font-bold text-red-400">{preview.invalid_rows}</p>
                  <p className="text-sm text-slate-400">Lỗi</p>
                </div>
              </div>
            </div>

            {preview.is_zip_import ? (
              <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-4 shadow-lg">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/15 text-[#F59E0B]">
                    <MangaIcon name="image" className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-2xl font-bold text-[#F59E0B]">
                      {preview.images_found}
                    </p>
                    <p className="text-sm text-slate-400">Ảnh tìm thấy</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {preview.invalid_rows > 0 ? (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
              <MangaIcon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Có {preview.invalid_rows} dòng bị lỗi</p>
                <p>
                  Các dòng bị lỗi sẽ bị bỏ qua khi xác nhận import. Bạn có thể tiếp tục với{" "}
                  {preview.valid_rows} dòng hợp lệ hoặc hủy để chỉnh sửa lại tệp.
                </p>
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-4 shadow-xl backdrop-blur-xl">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-white/10 text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3">Dòng</th>
                    <th className="py-2 pr-3">Trạng thái</th>
                    <th className="py-2 pr-3">Tên sản phẩm</th>
                    <th className="py-2 pr-3">Danh mục</th>
                    <th className="py-2 pr-3 text-right">Giá bán</th>
                    <th className="py-2 pr-3 text-center">Tồn kho</th>
                    <th className="py-2 pr-3">Tác giả</th>
                    {preview.is_zip_import ? <th className="py-2 pr-3">Ảnh bìa</th> : null}
                    <th className="py-2">Lỗi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {preview.products.map((row) => (
                    <tr
                      key={row.row_number}
                      className={`transition-colors ${
                        row.is_valid ? "hover:bg-white/5" : "bg-red-500/10"
                      }`}
                    >
                      <td className="py-2.5 pr-3 font-mono text-slate-400">
                        {row.row_number}
                      </td>
                      <td className="py-2.5 pr-3">
                        {row.is_valid ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                            <MangaIcon name="check" className="h-3 w-3" />
                            <span>Hợp lệ</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-semibold text-red-300">
                            <MangaIcon name="x" className="h-3 w-3" />
                            <span>Lỗi</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 font-semibold text-[#F5F6FA]">
                        {row.name || "(Trống)"}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-300">
                        {row.category || "(Trống)"}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-semibold text-[#F59E0B]">
                        {formatCurrency(row.price)}
                      </td>
                      <td className="py-2.5 pr-3 text-center text-slate-200">
                        {row.stock_quantity}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-300">{row.author || "—"}</td>
                      {preview.is_zip_import ? (
                        <td className="py-2.5 pr-3">
                          {row.cover_image_file ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[#F59E0B]/30 bg-[#F59E0B]/15 px-2 py-0.5 text-xs font-semibold text-[#F59E0B]">
                              <MangaIcon name="image" className="h-3 w-3" />
                              <span>{row.cover_image_file}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">Mặc định</span>
                          )}
                        </td>
                      ) : null}
                      <td className="py-2.5 text-xs text-red-400">
                        {row.errors.length > 0 ? row.errors.join("; ") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col justify-end gap-3 sm:flex-row">
            <button
              type="button"
              disabled={executing || cancelling}
              onClick={() => void handleCancelImport()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#1B2130] px-6 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <MangaIcon name="x" className="h-4 w-4" />
              <span>{cancelling ? "Đang hủy..." : "Hủy"}</span>
            </button>

            {preview.valid_rows > 0 ? (
              <button
                type="button"
                disabled={executing || cancelling}
                onClick={() => void handleExecuteImport()}
                className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center justify-center gap-2 rounded-xl border px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {executing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MangaIcon name="upload" className="h-4 w-4" />
                )}
                <span>
                  {executing
                    ? "Đang import..."
                    : `Xác nhận Import (${preview.valid_rows} sản phẩm)`}
                </span>
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-6 shadow-xl backdrop-blur-xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#E63946]/30 bg-[#E63946]/15 text-[#FF6B77]">
                <MangaIcon name="upload" className="h-5 w-5" />
              </span>
              <h2 className="font-display text-lg font-bold text-[#F5F6FA]">
                Tải tệp nhập hàng
              </h2>
            </div>

            {uploadError ? (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-300"
              >
                <MangaIcon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{uploadError}</span>
              </div>
            ) : null}

            <form onSubmit={handlePreviewSubmit} className="space-y-4">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                  dragActive
                    ? "border-[#E63946] bg-[#E63946]/10"
                    : "border-white/20 bg-[#1B2130]/60 hover:border-[#E63946]/60 hover:bg-[#E63946]/5"
                }`}
              >
                <span className="mx-auto mb-3 inline-flex items-center justify-center">
                  <MangaIcon
                    name={isSelectedZip ? "archive" : "file-spreadsheet"}
                    className={`h-12 w-12 ${
                      selectedFile
                        ? isSelectedZip
                          ? "text-[#F59E0B]"
                          : "text-[#22D3EE]"
                        : "text-slate-400"
                    }`}
                  />
                </span>
                <p className="mb-3 text-sm font-medium text-slate-200">
                  Kéo thả file Excel (.xlsx) hoặc ZIP vào đây
                </p>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#E63946] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#FF4D5A]">
                  <MangaIcon name="folder-open" className="h-4 w-4" />
                  <span>Chọn file</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.zip"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>

                {selectedFile ? (
                  <div className="mt-4 space-y-1">
                    <p className="text-sm font-semibold text-emerald-400">
                      Đã chọn: {selectedFile.name}
                    </p>
                    <p
                      className={`text-xs font-semibold ${
                        isSelectedZip ? "text-[#F59E0B]" : "text-[#22D3EE]"
                      }`}
                    >
                      {isSelectedZip
                        ? "Gói ZIP — Sẽ kiểm tra và import kèm ảnh bìa/ảnh phụ"
                        : "Tệp Excel — Kiểm tra và import danh sách sản phẩm"}
                    </p>
                  </div>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={previewLoading}
                className="ms-btn-2d ms-btn-2d-crimson inline-flex w-full items-center justify-center gap-2 rounded-xl border px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {previewLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MangaIcon name="upload" className="h-4 w-4" />
                )}
                <span>{previewLoading ? "Đang phân tích..." : "Upload và Preview"}</span>
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-6 shadow-xl backdrop-blur-xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                <MangaIcon name="download" className="h-5 w-5" />
              </span>
              <h2 className="font-display text-lg font-bold text-[#F5F6FA]">Tải file mẫu</h2>
            </div>

            <p className="mb-5 text-sm leading-relaxed text-slate-400">
              Tải mẫu Excel chuẩn 12 cột hoặc gói ZIP mẫu gồm{" "}
              <code className="rounded bg-[#1B2130] px-1.5 py-0.5 text-slate-200">
                products.xlsx
              </code>{" "}
              và thư mục{" "}
              <code className="rounded bg-[#1B2130] px-1.5 py-0.5 text-slate-200">
                images/
              </code>
              .
            </p>

            <div className="space-y-3">
              <button
                type="button"
                disabled={downloadingType !== null}
                onClick={() => void handleDownloadTemplate("excel")}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-6 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:opacity-60"
              >
                {downloadingType === "excel" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MangaIcon name="file-spreadsheet" className="h-4 w-4" />
                )}
                <span>Tải file Excel mẫu (.xlsx)</span>
              </button>

              <button
                type="button"
                disabled={downloadingType !== null}
                onClick={() => void handleDownloadTemplate("zip")}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#F59E0B]/40 bg-[#F59E0B]/15 px-6 py-3 text-sm font-semibold text-[#F59E0B] transition-colors hover:bg-[#F59E0B]/25 disabled:opacity-60"
              >
                {downloadingType === "zip" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MangaIcon name="archive" className="h-4 w-4" />
                )}
                <span>Tải file ZIP mẫu (.zip)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminImportPage;
