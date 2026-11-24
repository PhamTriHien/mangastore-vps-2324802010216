import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StoreLayout } from "../components/layout/StoreLayout";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { MangaIcon } from "../components/ui/MangaIcon";
import { useAuth } from "../contexts/AuthContext";
import { useCartWishlist } from "../contexts/CartWishlistContext";
import { useToast } from "../contexts/ToastContext";
import { ApiError, apiClient } from "../lib/api";
import { formatCurrency } from "../lib/format";

interface RawCartItem {
  product_id: number;
  title: string;
  author?: string | null;
  cover_url?: string | null;
  unit_price?: number;
  price?: number;
  quantity: number;
  subtotal?: number;
  stock_quantity?: number;
  max_stock?: number;
  status?: string;
  is_available?: boolean;
}

interface RawCartResponse {
  ok?: boolean;
  items: RawCartItem[];
  total_items?: number;
  sub_total?: number;
  shipping_fee?: number;
  grand_total?: number;
}

interface NormalizedCartItem {
  product_id: number;
  title: string;
  author: string;
  cover_url: string;
  unit_price: number;
  quantity: number;
  max_stock: number;
  is_available: boolean;
}

type ConfirmAction =
  | { type: "single"; productId: number; title: string }
  | { type: "selected"; productIds: number[] }
  | { type: "clear" };

const FREE_SHIPPING_THRESHOLD = 150_000;
const STANDARD_SHIPPING_FEE = 30_000;

function normalizeCartItem(item: RawCartItem): NormalizedCartItem {
  const unitPrice = Number(item.unit_price ?? item.price ?? 0);
  const maxStock = Number(item.stock_quantity ?? item.max_stock ?? 99);
  const isAvailable = item.is_available !== false && maxStock > 0;
  return {
    product_id: item.product_id,
    title: item.title,
    author: item.author ?? "",
    cover_url: item.cover_url || "/covers/default-manga.svg",
    unit_price: unitPrice,
    quantity: Math.max(1, item.quantity || 1),
    max_stock: Math.max(0, maxStock),
    is_available: isAvailable,
  };
}

export function CartPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { refreshCounts } = useCartWishlist();
  const { showToast } = useToast();

  const [items, setItems] = useState<NormalizedCartItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<number[]>([]);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const loadCart = useCallback(async (preserveSelection = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<RawCartResponse>("/api/cart");
      const normalized = (res.items ?? []).map(normalizeCartItem);
      setItems(normalized);
      const availableIds = normalized
        .filter((item) => item.is_available)
        .map((item) => item.product_id);

      setSelectedIds((prev) => {
        if (preserveSelection) {
          return prev.filter((id) => availableIds.includes(id));
        }
        return availableIds;
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setItems([]);
        setSelectedIds([]);
      } else {
        setError(err instanceof Error ? err.message : "Không thể tải giỏ hàng.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setItems([]);
      setSelectedIds([]);
      setLoading(false);
      return;
    }
    void loadCart(false);
  }, [authLoading, user, loadCart]);

  const availableItems = useMemo(
    () => items.filter((item) => item.is_available),
    [items],
  );

  const allAvailableSelected =
    availableItems.length > 0 &&
    availableItems.every((item) => selectedIds.includes(item.product_id));

  const selectedItems = useMemo(
    () =>
      items.filter(
        (item) => item.is_available && selectedIds.includes(item.product_id),
      ),
    [items, selectedIds],
  );

  const summary = useMemo(() => {
    const selectedQty = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
    const subTotal = selectedItems.reduce(
      (sum, item) => sum + item.unit_price * item.quantity,
      0,
    );
    const shippingFee =
      selectedItems.length === 0
        ? 0
        : subTotal >= FREE_SHIPPING_THRESHOLD
          ? 0
          : STANDARD_SHIPPING_FEE;
    const grandTotal = subTotal + shippingFee;
    const remainingForFreeShip = Math.max(0, FREE_SHIPPING_THRESHOLD - subTotal);
    const progressPercent = Math.min(
      100,
      Math.round((subTotal / FREE_SHIPPING_THRESHOLD) * 100),
    );
    return {
      selectedQty,
      subTotal,
      shippingFee,
      grandTotal,
      remainingForFreeShip,
      progressPercent,
    };
  }, [selectedItems]);

  const toggleSelectAll = () => {
    if (allAvailableSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(availableItems.map((item) => item.product_id));
    }
  };

  const toggleSelectItem = (productId: number) => {
    setSelectedIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId],
    );
  };

  const handleQuantityChange = async (
    item: NormalizedCartItem,
    nextQuantity: number,
  ) => {
    const clamped = Math.max(1, Math.min(item.max_stock || 1, nextQuantity));
    if (clamped === item.quantity) return;

    setUpdatingIds((prev) => [...prev, item.product_id]);
    try {
      const res = await apiClient.put<RawCartResponse>(
        `/api/cart/${item.product_id}`,
        { quantity: clamped },
      );
      if (Array.isArray(res.items)) {
        const normalized = res.items.map(normalizeCartItem);
        setItems(normalized);
        setSelectedIds((prev) =>
          prev.filter((id) =>
            normalized.some((x) => x.product_id === id && x.is_available),
          ),
        );
      } else {
        setItems((prev) =>
          prev.map((row) =>
            row.product_id === item.product_id ? { ...row, quantity: clamped } : row,
          ),
        );
      }
      await refreshCounts();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Không thể cập nhật số lượng.",
        "error",
      );
    } finally {
      setUpdatingIds((prev) => prev.filter((id) => id !== item.product_id));
    }
  };

  const executeConfirm = async () => {
    if (!confirmAction) return;
    setConfirmBusy(true);
    try {
      if (confirmAction.type === "single") {
        await apiClient.del(`/api/cart/${confirmAction.productId}`);
        setItems((prev) =>
          prev.filter((item) => item.product_id !== confirmAction.productId),
        );
        setSelectedIds((prev) =>
          prev.filter((id) => id !== confirmAction.productId),
        );
        showToast("Đã xóa sản phẩm khỏi giỏ hàng.", "success");
      } else if (confirmAction.type === "selected") {
        await Promise.all(
          confirmAction.productIds.map((id) => apiClient.del(`/api/cart/${id}`)),
        );
        const removedSet = new Set(confirmAction.productIds);
        setItems((prev) => prev.filter((item) => !removedSet.has(item.product_id)));
        setSelectedIds((prev) => prev.filter((id) => !removedSet.has(id)));
        showToast(
          `Đã xóa ${confirmAction.productIds.length} sản phẩm đã chọn.`,
          "success",
        );
      } else {
        await apiClient.del("/api/cart");
        setItems([]);
        setSelectedIds([]);
        showToast("Đã làm trống giỏ hàng.", "success");
      }
      await refreshCounts();
      setConfirmAction(null);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Thao tác giỏ hàng thất bại.",
        "error",
      );
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleProceedCheckout = () => {
    if (selectedItems.length === 0) {
      showToast("Vui lòng chọn ít nhất 1 sản phẩm để thanh toán.", "warning");
      return;
    }
    const idsParam = selectedItems.map((item) => item.product_id).join(",");
    navigate(`/checkout?items=${encodeURIComponent(idsParam)}`);
  };

  const confirmCopy = (() => {
    if (!confirmAction) {
      return { title: "", message: "", confirmLabel: "Xác nhận" };
    }
    if (confirmAction.type === "single") {
      return {
        title: "Xóa sản phẩm khỏi giỏ?",
        message: `Bạn có chắc muốn bỏ "${confirmAction.title}" khỏi giỏ hàng không?`,
        confirmLabel: "Xóa sản phẩm",
      };
    }
    if (confirmAction.type === "selected") {
      return {
        title: "Xóa các sản phẩm đã chọn?",
        message: `Bạn có chắc muốn xóa ${confirmAction.productIds.length} sản phẩm đang chọn khỏi giỏ hàng?`,
        confirmLabel: "Xóa đã chọn",
      };
    }
    return {
      title: "Xóa toàn bộ giỏ hàng?",
      message: "Tất cả sản phẩm trong giỏ hàng hiện tại sẽ bị xóa.",
      confirmLabel: "Xóa tất cả",
    };
  })();

  return (
    <StoreLayout>
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <nav className="mb-2 flex items-center gap-2 text-xs text-slate-400">
              <Link to="/" className="hover:text-white">
                Trang chủ
              </Link>
              <span>/</span>
              <span className="text-crimson-400 font-semibold">Giỏ hàng</span>
            </nav>
            <h1 className="font-display flex items-center gap-3 text-2xl font-extrabold text-white sm:text-3xl">
              <span className="bg-crimson-500/15 border-crimson-500/40 text-crimson-400 inline-flex h-10 w-10 items-center justify-center rounded-xl border">
                <MangaIcon name="shopping-bag" className="h-5 w-5" />
              </span>
              Giỏ hàng của bạn
            </h1>
          </div>

          {user && items.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setConfirmAction({ type: "selected", productIds: selectedIds })
                  }
                  className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs"
                >
                  <MangaIcon name="trash-2" className="h-4 w-4 text-rose-400" />
                  Xóa đã chọn ({selectedIds.length})
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmAction({ type: "clear" })}
                className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs text-rose-300"
              >
                <MangaIcon name="x-circle" className="h-4 w-4" />
                Xóa tất cả
              </button>
            </div>
          )}
        </div>

        {loading || authLoading ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              {[1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className="ms-panel-2d h-32 animate-pulse bg-slate-900/70"
                />
              ))}
            </div>
            <div className="ms-panel-2d h-80 animate-pulse bg-slate-900/70" />
          </div>
        ) : error ? (
          <div className="ms-panel-2d p-8 text-center">
            <p className="mb-4 text-rose-300">{error}</p>
            <button
              type="button"
              onClick={() => void loadCart(false)}
              className="ms-btn-2d ms-btn-2d-crimson px-5 py-2.5 text-sm"
            >
              <MangaIcon name="refresh-cw" className="h-4 w-4" />
              Thử lại
            </button>
          </div>
        ) : !user || items.length === 0 ? (
          <div className="ms-panel-2d mx-auto max-w-2xl px-6 py-12 text-center">
            <img
              src="/content/icons/spots/spot-empty-cart.svg"
              alt="Giỏ hàng trống"
              className="mx-auto mb-6 h-44 w-44 object-contain"
            />
            <h2 className="font-display mb-2 text-2xl font-bold text-white">
              {!user ? "Bạn chưa đăng nhập" : "Giỏ hàng của bạn đang trống"}
            </h2>
            <p className="mx-auto mb-6 max-w-md text-sm text-slate-400">
              {!user
                ? "Đăng nhập tài khoản MangaStore để lưu giỏ hàng, chọn sản phẩm thanh toán và theo dõi đơn hàng."
                : "Hãy khám phá kho Manga và Light Novel bản quyền để thêm truyện yêu thích vào giỏ nhé."}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {!user ? (
                <Link
                  to="/auth"
                  state={{ from: "/cart" }}
                  className="ms-btn-2d ms-btn-2d-crimson px-6 py-3 text-sm"
                >
                  <MangaIcon name="user" className="h-4 w-4" />
                  Đăng nhập ngay
                </Link>
              ) : null}
              <Link
                to="/products"
                className="ms-btn-2d ms-btn-2d-cyan px-6 py-3 text-sm"
              >
                <MangaIcon name="compass" className="h-4 w-4" />
                Khám phá cửa hàng
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid items-start gap-8 lg:grid-cols-12">
            {/* Cart items list */}
            <div className="space-y-4 lg:col-span-8">
              <div className="ms-panel-2d flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <label className="flex cursor-pointer items-center gap-3 select-none">
                  <input
                    type="checkbox"
                    checked={allAvailableSelected}
                    onChange={toggleSelectAll}
                    disabled={availableItems.length === 0}
                    className="accent-crimson-500 h-4 w-4 rounded border-slate-600 bg-slate-900"
                  />
                  <span className="text-sm font-semibold text-white">
                    Chọn tất cả ({selectedItems.length}/{availableItems.length} sản phẩm
                    khả dụng)
                  </span>
                </label>
                <span className="text-xs text-slate-400">
                  Tổng số lượng trong giỏ:{" "}
                  <strong className="text-white">
                    {items.reduce((sum, i) => sum + i.quantity, 0)}
                  </strong>
                </span>
              </div>

              {items.map((item) => {
                const isSelected = selectedIds.includes(item.product_id);
                const isUpdating = updatingIds.includes(item.product_id);
                const lineTotal = item.unit_price * item.quantity;

                return (
                  <div
                    key={item.product_id}
                    className={`ms-panel-2d flex flex-col gap-4 p-4 transition-all sm:flex-row sm:items-center ${
                      isSelected
                        ? "border-crimson-500/60"
                        : "border-slate-700/80 opacity-90"
                    } ${!item.is_available ? "bg-slate-900/50 opacity-70" : ""}`}
                  >
                    <div className="flex items-start gap-3 sm:items-center">
                      <input
                        type="checkbox"
                        checked={isSelected && item.is_available}
                        disabled={!item.is_available}
                        onChange={() => toggleSelectItem(item.product_id)}
                        aria-label={`Chọn ${item.title}`}
                        className="accent-crimson-500 mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 sm:mt-0"
                      />

                      <Link
                        to={`/products/${item.product_id}`}
                        className="h-28 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-950"
                      >
                        <img
                          src={item.cover_url}
                          alt={item.title}
                          onError={(e) => {
                            e.currentTarget.src = "/covers/default-manga.svg";
                          }}
                          className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                        />
                      </Link>
                    </div>

                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/products/${item.product_id}`}
                        className="font-display line-clamp-2 text-base font-bold text-white hover:text-cyan-300"
                      >
                        {item.title}
                      </Link>
                      {item.author && (
                        <p className="mt-0.5 text-xs text-slate-400">
                          Tác giả: {item.author}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <span className="text-crimson-400 font-mono text-sm font-bold">
                          {formatCurrency(item.unit_price)}
                        </span>
                        {item.is_available ? (
                          <span
                            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                              item.max_stock <= 10
                                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            }`}
                          >
                            Còn {item.max_stock} cuốn
                          </span>
                        ) : (
                          <span className="rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-rose-300">
                            Hết hàng / Ngừng kinh doanh
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 border-t border-slate-800 pt-3 sm:border-t-0 sm:pt-0">
                      <div className="flex items-center rounded-lg border border-slate-700 bg-slate-950">
                        <button
                          type="button"
                          disabled={
                            isUpdating || !item.is_available || item.quantity <= 1
                          }
                          onClick={() =>
                            void handleQuantityChange(item, item.quantity - 1)
                          }
                          aria-label="Giảm số lượng"
                          className="flex h-8 w-8 items-center justify-center text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <MangaIcon name="minus" className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-9 text-center font-mono text-sm font-bold text-white">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          disabled={
                            isUpdating ||
                            !item.is_available ||
                            item.quantity >= item.max_stock
                          }
                          onClick={() =>
                            void handleQuantityChange(item, item.quantity + 1)
                          }
                          aria-label="Tăng số lượng"
                          className="flex h-8 w-8 items-center justify-center text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <MangaIcon name="plus" className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="text-right">
                        <p className="font-mono text-base font-extrabold text-white">
                          {formatCurrency(lineTotal)}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() =>
                          setConfirmAction({
                            type: "single",
                            productId: item.product_id,
                            title: item.title,
                          })
                        }
                        aria-label={`Xóa ${item.title}`}
                        className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-400 transition-colors hover:border-rose-500/50 hover:text-rose-400"
                      >
                        <MangaIcon name="trash-2" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary panel */}
            <aside className="ms-panel-2d sticky top-24 space-y-5 p-6 lg:col-span-4">
              <h2 className="font-display flex items-center gap-2 text-lg font-extrabold text-white">
                <MangaIcon name="receipt" className="text-crimson-400 h-5 w-5" />
                Tóm tắt đơn hàng
              </h2>

              {/* Free shipping progress */}
              <div className="rounded-xl border border-slate-700/80 bg-slate-950/70 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                  <MangaIcon
                    name="truck"
                    className={
                      summary.remainingForFreeShip === 0 && selectedItems.length > 0
                        ? "h-4 w-4 text-emerald-400"
                        : "h-4 w-4 text-cyan-400"
                    }
                  />
                  {selectedItems.length === 0 ? (
                    <span className="text-slate-300">
                      Miễn phí vận chuyển cho đơn từ{" "}
                      {formatCurrency(FREE_SHIPPING_THRESHOLD)}
                    </span>
                  ) : summary.remainingForFreeShip === 0 ? (
                    <span className="text-emerald-300">
                      Đơn hàng đủ điều kiện miễn phí vận chuyển!
                    </span>
                  ) : (
                    <span className="text-cyan-200">
                      Mua thêm{" "}
                      <strong className="text-white">
                        {formatCurrency(summary.remainingForFreeShip)}
                      </strong>{" "}
                      để được miễn phí vận chuyển
                    </span>
                  )}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full transition-all duration-300 ${
                      summary.remainingForFreeShip === 0 && selectedItems.length > 0
                        ? "bg-emerald-500"
                        : "bg-cyan-500"
                    }`}
                    style={{ width: `${summary.progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="space-y-3 border-b border-slate-800 pb-4 text-sm">
                <div className="flex items-center justify-between text-slate-300">
                  <span>Sản phẩm đã chọn</span>
                  <span className="font-mono font-semibold text-white">
                    {selectedItems.length} tựa ({summary.selectedQty} cuốn)
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Tạm tính</span>
                  <span className="font-mono font-semibold text-white">
                    {formatCurrency(summary.subTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Phí vận chuyển dự kiến</span>
                  <span
                    className={`font-mono font-semibold ${
                      selectedItems.length > 0 && summary.shippingFee === 0
                        ? "text-emerald-400"
                        : "text-white"
                    }`}
                  >
                    {selectedItems.length === 0
                      ? formatCurrency(0)
                      : summary.shippingFee === 0
                        ? "Miễn phí"
                        : formatCurrency(summary.shippingFee)}
                  </span>
                </div>
              </div>

              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-slate-200">
                  Tổng thanh toán
                </span>
                <span className="text-crimson-400 font-mono text-2xl font-extrabold">
                  {formatCurrency(summary.grandTotal)}
                </span>
              </div>

              <button
                type="button"
                disabled={selectedItems.length === 0}
                onClick={handleProceedCheckout}
                className="ms-btn-2d ms-btn-2d-crimson w-full py-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MangaIcon name="check-circle-2" className="h-4 w-4" />
                Tiến hành thanh toán ({selectedItems.length})
              </button>

              <Link
                to="/products"
                className="ms-btn-2d ms-btn-2d-dark w-full py-2.5 text-xs"
              >
                <MangaIcon name="arrow-left" className="h-4 w-4" />
                Tiếp tục chọn truyện
              </Link>
            </aside>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmCopy.title}
        message={confirmCopy.message}
        confirmLabel={confirmCopy.confirmLabel}
        danger
        busy={confirmBusy}
        onConfirm={() => void executeConfirm()}
        onCancel={() => {
          if (!confirmBusy) setConfirmAction(null);
        }}
      />
    </StoreLayout>
  );
}

export default CartPage;
