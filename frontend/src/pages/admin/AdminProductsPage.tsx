import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { useToast } from "../../contexts/ToastContext";
import { apiClient } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import {
  AdminErrorState,
  AdminLoadingState,
  getErrorMessage,
  handleCoverError,
  resolveImageUrl,
} from "./adminShared";

type ProductFilterKey = "all" | "featured" | "new" | "instock" | "outofstock";

interface AdminProductItem {
  id: number;
  title: string;
  author: string;
  publisher: string | null;
  category: string;
  tags: string[];
  price: number;
  original_price: number | null;
  stock_quantity: number;
  in_stock: boolean;
  status: string;
  is_featured: boolean;
  is_new: boolean;
  cover_url: string;
  average_rating: number;
  ratings_count: number;
  units_sold: number;
}

interface AdminProductsCounts {
  all: number;
  featured: number;
  new: number;
  instock: number;
  outofstock: number;
}

interface AdminProductsResponse {
  items: AdminProductItem[];
  counts: AdminProductsCounts;
  categories: string[];
}

const FILTER_PILLS: readonly {
  key: ProductFilterKey;
  label: string;
  icon: string;
  activeClass: string;
  hoverClass: string;
}[] = [
  {
    key: "all",
    label: "Tất cả",
    icon: "list",
    activeClass: "bg-[#E63946] text-white shadow-lg shadow-[#E63946]/25",
    hoverClass: "hover:bg-white/5 hover:text-white",
  },
  {
    key: "featured",
    label: "Nổi bật",
    icon: "star",
    activeClass: "bg-[#F59E0B] text-slate-950 shadow-lg shadow-[#F59E0B]/20",
    hoverClass: "hover:bg-[#F59E0B]/15 hover:text-[#F59E0B]",
  },
  {
    key: "new",
    label: "Mới",
    icon: "sparkles",
    activeClass: "bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20",
    hoverClass: "hover:bg-cyan-500/15 hover:text-cyan-300",
  },
  {
    key: "instock",
    label: "Còn hàng",
    icon: "check-circle",
    activeClass: "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20",
    hoverClass: "hover:bg-emerald-500/15 hover:text-emerald-300",
  },
  {
    key: "outofstock",
    label: "Hết hàng",
    icon: "x-circle",
    activeClass: "bg-red-500 text-white shadow-lg shadow-red-500/20",
    hoverClass: "hover:bg-red-500/15 hover:text-red-300",
  },
];

export function AdminProductsPage() {
  const { showToast } = useToast();
  const [filter, setFilter] = useState<ProductFilterKey>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [products, setProducts] = useState<AdminProductItem[]>([]);
  const [counts, setCounts] = useState<AdminProductsCounts>({
    all: 0,
    featured: 0,
    new: 0,
    instock: 0,
    outofstock: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [stockDrafts, setStockDrafts] = useState<Record<number, string>>({});
  const [savingStockId, setSavingStockId] = useState<number | null>(null);
  const [togglingFeaturedId, setTogglingFeaturedId] = useState<number | null>(null);
  const [unmarkingNewId, setUnmarkingNewId] = useState<number | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AdminProductItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("filter", filter);
      if (debouncedSearch) {
        params.set("search", debouncedSearch);
      }
      const res = await apiClient.get<AdminProductsResponse>(
        `/api/admin/products?${params.toString()}`
      );
      setProducts(res.items ?? []);
      setCounts(
        res.counts ?? {
          all: res.items?.length ?? 0,
          featured: 0,
          new: 0,
          instock: 0,
          outofstock: 0,
        }
      );
      const nextDrafts: Record<number, string> = {};
      for (const item of res.items ?? []) {
        nextDrafts[item.id] = String(item.stock_quantity);
      }
      setStockDrafts(nextDrafts);
    } catch (err) {
      setError(getErrorMessage(err, "Không thể tải danh sách sản phẩm."));
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedSearch]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const handleSaveStock = async (product: AdminProductItem) => {
    const rawValue = stockDrafts[product.id] ?? String(product.stock_quantity);
    const parsedQty = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsedQty) || parsedQty < 0) {
      showToast("Số lượng tồn kho phải là số nguyên >= 0.", "warning");
      return;
    }

    setSavingStockId(product.id);
    try {
      const res = await apiClient.post<{
        id: number;
        stock_quantity: number;
        status: string;
        message: string;
      }>(`/api/admin/products/${product.id}/stock`, { quantity: parsedQty });
      showToast(res.message || "Đã cập nhật tồn kho.", "success");
      await loadProducts();
    } catch (err) {
      showToast(getErrorMessage(err, "Không thể cập nhật tồn kho."), "error");
    } finally {
      setSavingStockId(null);
    }
  };

  const handleToggleFeatured = async (product: AdminProductItem) => {
    setTogglingFeaturedId(product.id);
    try {
      const res = await apiClient.post<{
        id: number;
        is_featured: boolean;
        message: string;
      }>(`/api/admin/products/${product.id}/toggle-featured`);
      showToast(res.message || "Đã cập nhật trạng thái nổi bật.", "success");
      await loadProducts();
    } catch (err) {
      showToast(getErrorMessage(err, "Không thể cập nhật nổi bật."), "error");
    } finally {
      setTogglingFeaturedId(null);
    }
  };

  const handleUnmarkNew = async (product: AdminProductItem) => {
    setUnmarkingNewId(product.id);
    try {
      const res = await apiClient.post<{
        id: number;
        is_new: boolean;
        message: string;
      }>(`/api/admin/products/${product.id}/unmark-new`);
      showToast(res.message || "Đã bỏ nhãn sản phẩm mới.", "success");
      await loadProducts();
    } catch (err) {
      showToast(getErrorMessage(err, "Không thể bỏ nhãn mới."), "error");
    } finally {
      setUnmarkingNewId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await apiClient.del<{
        archived: boolean;
        deleted: boolean;
        message: string;
      }>(`/api/admin/products/${deleteTarget.id}`);
      showToast(res.message || "Đã xử lý xóa sản phẩm.", "success");
      setDeleteTarget(null);
      await loadProducts();
    } catch (err) {
      showToast(getErrorMessage(err, "Không thể xóa sản phẩm."), "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#F5F6FA] sm:text-3xl">
            Quản lý sản phẩm
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
            to="/admin/import"
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25"
          >
            <MangaIcon name="file-spreadsheet" className="h-4 w-4" />
            <span>Import Excel/ZIP</span>
          </Link>
          <Link
            to="/admin/products/new"
            className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold text-white"
          >
            <MangaIcon name="plus" className="h-4 w-4" />
            <span>Thêm sản phẩm mới</span>
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm font-medium text-slate-400">Lọc:</span>
        {FILTER_PILLS.map((pill) => {
          const isActive = filter === pill.key;
          const count = counts[pill.key];
          return (
            <button
              key={pill.key}
              type="button"
              onClick={() => setFilter(pill.key)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                isActive
                  ? pill.activeClass
                  : `border border-white/10 bg-[#131722]/90 text-slate-300 ${pill.hoverClass}`
              }`}
            >
              <MangaIcon name={pill.icon} className="h-4 w-4" />
              <span>{pill.label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  isActive ? "bg-black/20 text-current" : "bg-[#1B2130] text-slate-300"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <MangaIcon
            name="search"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm theo ID, tên truyện, tác giả hoặc danh mục..."
            aria-label="Tìm kiếm sản phẩm"
            className="h-10 w-full rounded-xl border border-white/15 bg-[#1B2130] pl-10 pr-9 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
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
        <p className="text-sm text-slate-400">
          Hiển thị <strong className="text-[#F5F6FA]">{products.length}</strong> sản phẩm
        </p>
      </div>

      {loading ? (
        <AdminLoadingState label="Đang tải danh sách sản phẩm..." />
      ) : error ? (
        <AdminErrorState message={error} onRetry={() => void loadProducts()} />
      ) : (
        <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-4 shadow-xl backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-3 pr-3">ID</th>
                  <th className="py-3 pr-3">Ảnh</th>
                  <th className="py-3 pr-4">Sản phẩm</th>
                  <th className="py-3 pr-4">Danh mục</th>
                  <th className="py-3 pr-4 text-right">Giá bán</th>
                  <th className="py-3 pr-4 text-center">Tồn kho</th>
                  <th className="py-3 pr-3 text-center">Trạng thái</th>
                  <th className="py-3 pr-3 text-center">Nổi bật</th>
                  <th className="py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {products.length > 0 ? (
                  products.map((product) => {
                    const isSavingStock = savingStockId === product.id;
                    const isToggling = togglingFeaturedId === product.id;
                    const isUnmarking = unmarkingNewId === product.id;
                    const isDiscontinued = product.status === "ngung_ban";

                    return (
                      <tr key={product.id} className="transition-colors hover:bg-white/5">
                        <td className="py-3 pr-3 font-mono text-xs text-slate-400">
                          #{product.id}
                        </td>
                        <td className="py-3 pr-3">
                          <img
                            src={resolveImageUrl(product.cover_url)}
                            alt={product.title}
                            onError={handleCoverError}
                            className="h-14 w-10 rounded-lg bg-[#1B2130] object-cover shadow"
                          />
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-[#F5F6FA]">{product.title}</span>
                            {product.is_new ? (
                              <span className="rounded-full border border-cyan-500/35 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-cyan-300">
                                Mới
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {product.author} · {product.units_sold.toLocaleString("vi-VN")} đã bán
                          </p>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="inline-flex rounded-lg border border-white/10 bg-[#1B2130] px-2.5 py-1 text-xs font-medium text-slate-200">
                            {product.category}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-right">
                          <span className="font-semibold text-[#F59E0B]">
                            {formatCurrency(product.price)}
                          </span>
                          {product.original_price && product.original_price > product.price ? (
                            <p className="text-xs text-slate-500 line-through">
                              {formatCurrency(product.original_price)}
                            </p>
                          ) : null}
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center justify-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              value={stockDrafts[product.id] ?? String(product.stock_quantity)}
                              onChange={(e) =>
                                setStockDrafts((prev) => ({
                                  ...prev,
                                  [product.id]: e.target.value,
                                }))
                              }
                              aria-label={`Số lượng tồn kho của ${product.title}`}
                              className="h-8 w-16 rounded-lg border border-white/15 bg-[#1B2130] px-2 text-center text-xs font-semibold text-[#F5F6FA] focus:border-[#E63946] focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={isSavingStock}
                              onClick={() => void handleSaveStock(product)}
                              title="Lưu tồn kho"
                              className="inline-flex h-8 items-center justify-center rounded-lg border border-white/15 bg-[#1B2130] px-2.5 text-xs font-semibold text-slate-200 transition-colors hover:border-cyan-400/50 hover:text-cyan-300 disabled:opacity-50"
                            >
                              {isSavingStock ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                "Lưu"
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-3 pr-3 text-center">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              isDiscontinued
                                ? "bg-slate-500/20 text-slate-300"
                                : product.in_stock
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : "bg-red-500/20 text-red-300"
                            }`}
                          >
                            {isDiscontinued
                              ? "Ngừng bán"
                              : product.in_stock
                                ? "Còn hàng"
                                : "Hết hàng"}
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-center">
                          <button
                            type="button"
                            disabled={isToggling}
                            onClick={() => void handleToggleFeatured(product)}
                            title={
                              product.is_featured
                                ? "Bỏ khỏi kệ nổi bật"
                                : "Thêm vào kệ nổi bật"
                            }
                            aria-label={`Chuyển trạng thái nổi bật cho ${product.title}`}
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${
                              product.is_featured
                                ? "bg-amber-500/20 text-[#F59E0B] hover:bg-amber-500/30"
                                : "bg-[#1B2130] text-slate-500 hover:bg-amber-500/15 hover:text-[#F59E0B]"
                            }`}
                          >
                            {isToggling ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <MangaIcon name="star" className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {product.is_new ? (
                              <button
                                type="button"
                                disabled={isUnmarking}
                                onClick={() => void handleUnmarkNew(product)}
                                title="Bỏ nhãn sản phẩm mới"
                                className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/30 px-2.5 py-1.5 text-xs font-semibold text-[#22D3EE] transition-colors hover:bg-cyan-500/15 disabled:opacity-50"
                              >
                                <MangaIcon name="sparkles" className="h-3.5 w-3.5" />
                                <span>{isUnmarking ? "..." : "Bỏ mới"}</span>
                              </button>
                            ) : null}
                            <Link
                              to={`/admin/products/${product.id}/edit`}
                              className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:border-[#22D3EE]/50 hover:text-[#22D3EE]"
                            >
                              <MangaIcon name="edit" className="h-3.5 w-3.5" />
                              <span>Sửa</span>
                            </Link>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(product)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/15"
                            >
                              <MangaIcon name="trash-2" className="h-3.5 w-3.5" />
                              <span>Xóa</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="py-14 text-center text-slate-400">
                      <MangaIcon
                        name="package"
                        className="mx-auto mb-3 h-12 w-12 text-slate-500"
                      />
                      <p className="font-semibold text-slate-200">Không có sản phẩm phù hợp</p>
                      <p className="mt-1 text-sm">
                        Thử thay đổi bộ lọc hoặc thêm sản phẩm mới vào cửa hàng.
                      </p>
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
        title="Xóa sản phẩm"
        message={
          deleteTarget
            ? `Bạn có chắc muốn xóa "${deleteTarget.title}"? Nếu sản phẩm đã có đơn hàng, hệ thống sẽ chuyển sang trạng thái ngừng bán.`
            : ""
        }
        confirmLabel="Xóa sản phẩm"
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

export default AdminProductsPage;
