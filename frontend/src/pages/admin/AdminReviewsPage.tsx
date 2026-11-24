import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Loader2, Star } from "lucide-react";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { apiClient } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { AdminErrorState, AdminLoadingState, getErrorMessage } from "./adminShared";

interface AdminReviewItem {
  id: number;
  product_id: number;
  product_name: string;
  user_id: number;
  username: string;
  rating: number;
  content: string;
  is_purchased: boolean;
  admin_reply: string | null;
  admin_replied_by: string | null;
  admin_replied_at: string | null;
  created_at: string;
}

interface AdminReviewsResponse {
  items: AdminReviewItem[];
  total: number;
  page: number;
  page_size: number;
}

const PAGE_SIZES = [10, 20, 50, 100] as const;

export function AdminReviewsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  const [rating, setRating] = useState("");
  const [hasReply, setHasReply] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const [reviews, setReviews] = useState<AdminReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [replyingId, setReplyingId] = useState<number | null>(null);

  const fetchReviews = useCallback(
    async (targetPage?: number, overrides?: { search?: string; rating?: string; hasReply?: string; pageSize?: number }) => {
      setLoading(true);
      setError(null);
      try {
        const activePage = targetPage ?? page;
        const activeSearch = overrides?.search ?? search;
        const activeRating = overrides?.rating ?? rating;
        const activeHasReply = overrides?.hasReply ?? hasReply;
        const activePageSize = overrides?.pageSize ?? pageSize;

        const params = new URLSearchParams();
        params.set("page", String(activePage));
        params.set("page_size", String(activePageSize));
        if (activeSearch.trim()) params.set("search", activeSearch.trim());
        if (activeRating) params.set("rating", activeRating);
        if (activeHasReply) params.set("has_reply", activeHasReply);

        const res = await apiClient.get<AdminReviewsResponse>(
          `/api/admin/reviews?${params.toString()}`
        );
        const list = res.items ?? [];
        setReviews(list);
        setTotal(res.total ?? 0);
        const drafts: Record<number, string> = {};
        for (const rev of list) {
          drafts[rev.id] = rev.admin_reply ?? "";
        }
        setReplyDrafts(drafts);
      } catch (err) {
        setError(getErrorMessage(err, "Không thể tải danh sách đánh giá."));
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, search, rating, hasReply]
  );

  useEffect(() => {
    void fetchReviews();
  }, [fetchReviews]);

  const handleFilterSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    void fetchReviews(1);
  };

  const handleResetFilters = () => {
    setSearch("");
    setRating("");
    setHasReply("");
    setPageSize(20);
    setPage(1);
    void fetchReviews(1, { search: "", rating: "", hasReply: "", pageSize: 20 });
  };

  const handleSendReply = async (reviewId: number) => {
    const replyText = (replyDrafts[reviewId] ?? "").trim();
    if (!replyText) {
      showToast("Vui lòng nhập nội dung phản hồi.", "warning");
      return;
    }

    setReplyingId(reviewId);
    try {
      const res = await apiClient.post<{
        id: number;
        admin_reply: string;
        admin_replied_by: string;
        admin_replied_at: string;
        message: string;
      }>(`/api/admin/reviews/${reviewId}/reply`, { reply: replyText });

      setReviews((prev) =>
        prev.map((rev) =>
          rev.id === reviewId
            ? {
                ...rev,
                admin_reply: res.admin_reply,
                admin_replied_by: res.admin_replied_by,
                admin_replied_at: res.admin_replied_at,
              }
            : rev
        )
      );
      showToast(res.message || "Đã gửi phản hồi tới khách hàng.", "success");
    } catch (err) {
      showToast(getErrorMessage(err, "Không thể gửi phản hồi."), "error");
    } finally {
      setReplyingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#F5F6FA] sm:text-3xl">
            Quản lý &amp; phản hồi đánh giá
          </h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <MangaIcon name="shield" className="h-4 w-4 text-[#22D3EE]" />
          <span>{user?.username ?? "Admin"}</span>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-5 shadow-xl backdrop-blur-xl">
        <form
          onSubmit={handleFilterSubmit}
          className="grid gap-3 md:grid-cols-4 md:items-end"
        >
          <div>
            <label
              htmlFor="rev-search"
              className="mb-1 block text-xs font-semibold text-slate-300"
            >
              Tìm kiếm
            </label>
            <input
              id="rev-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tên truyện, khách hàng, nội dung..."
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-3 py-2 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="rev-rating"
              className="mb-1 block text-xs font-semibold text-slate-300"
            >
              Số sao
            </label>
            <select
              id="rev-rating"
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-3 py-2 text-sm text-[#F5F6FA] focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            >
              <option value="">Tất cả</option>
              {[5, 4, 3, 2, 1].map((s) => (
                <option key={s} value={String(s)}>
                  {s} sao
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="rev-has-reply"
              className="mb-1 block text-xs font-semibold text-slate-300"
            >
              Trạng thái phản hồi
            </label>
            <select
              id="rev-has-reply"
              value={hasReply}
              onChange={(e) => setHasReply(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-3 py-2 text-sm text-[#F5F6FA] focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            >
              <option value="">Tất cả</option>
              <option value="true">Đã phản hồi</option>
              <option value="false">Chưa phản hồi</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="rev-page-size"
              className="mb-1 block text-xs font-semibold text-slate-300"
            >
              Số dòng / trang
            </label>
            <select
              id="rev-page-size"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-3 py-2 text-sm text-[#F5F6FA] focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            >
              {PAGE_SIZES.map((sz) => (
                <option key={sz} value={sz}>
                  {sz} đánh giá
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 md:col-span-4">
            <button
              type="submit"
              className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold text-white"
            >
              <MangaIcon name="search" className="h-4 w-4" />
              <span>Lọc</span>
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#1B2130] px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10"
            >
              <MangaIcon name="refresh-ccw" className="h-4 w-4" />
              <span>Xóa lọc</span>
            </button>
            <span className="ml-auto text-xs text-slate-400">
              Tổng: <strong className="text-[#F5F6FA]">{total}</strong> đánh giá
            </span>
          </div>
        </form>
      </div>

      {loading ? (
        <AdminLoadingState label="Đang tải danh sách đánh giá..." />
      ) : error ? (
        <AdminErrorState message={error} onRetry={() => void fetchReviews()} />
      ) : reviews.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-12 text-center shadow-lg">
          <MangaIcon
            name="message-circle"
            className="mx-auto mb-3 h-10 w-10 text-slate-500"
          />
          <p className="font-semibold text-slate-200">Chưa có đánh giá nào phù hợp.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {reviews.map((review) => {
            const isReplying = replyingId === review.id;
            return (
              <article
                key={review.id}
                className="rounded-2xl border border-white/10 bg-[#131722]/90 p-5 shadow-lg backdrop-blur-xl"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-full border border-cyan-500/30 bg-cyan-500/15 px-2.5 py-0.5 text-xs font-semibold text-[#22D3EE]">
                        {review.product_name}
                      </span>
                      <span className="font-semibold text-[#F5F6FA]">{review.username}</span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <MangaIcon name="calendar" className="h-3.5 w-3.5" />
                      <span>{formatDateTime(review.created_at)}</span>
                      <span>·</span>
                      <Link
                        to={`/products/${review.product_id}`}
                        className="inline-flex items-center gap-1 text-[#FF6B77] hover:underline"
                      >
                        <MangaIcon name="link" className="h-3 w-3" />
                        <span>Xem sản phẩm</span>
                      </Link>
                    </div>

                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((starIdx) => (
                        <Star
                          key={starIdx}
                          className={`h-4 w-4 ${
                            starIdx <= review.rating
                              ? "fill-amber-400 text-amber-400"
                              : "text-slate-600"
                          }`}
                        />
                      ))}
                      <span className="ml-1.5 text-sm font-semibold text-slate-200">
                        {review.rating}/5
                      </span>
                    </div>
                  </div>

                  {review.is_purchased ? (
                    <span className="inline-flex items-center gap-1 self-start rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300">
                      <MangaIcon name="check-circle" className="h-3.5 w-3.5" />
                      <span>Đã mua hàng</span>
                    </span>
                  ) : null}
                </div>

                {review.content ? (
                  <p className="mt-3 rounded-xl border border-white/5 bg-[#1B2130]/50 px-4 py-3 text-sm leading-relaxed text-slate-200">
                    {review.content}
                  </p>
                ) : null}

                <div className="mt-4 rounded-xl border border-[#E63946]/30 bg-[#1B2130]/90 p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#FF6B77]">
                      <MangaIcon name="reply" className="h-4 w-4" />
                      <span>Phản hồi tới khách hàng</span>
                    </div>
                    {review.admin_replied_at ? (
                      <span className="text-xs text-slate-400">
                        Đã phản hồi bởi {review.admin_replied_by ?? "Admin"} lúc{" "}
                        {formatDateTime(review.admin_replied_at)}
                      </span>
                    ) : null}
                  </div>

                  <textarea
                    rows={3}
                    value={replyDrafts[review.id] ?? ""}
                    onChange={(e) =>
                      setReplyDrafts((prev) => ({
                        ...prev,
                        [review.id]: e.target.value,
                      }))
                    }
                    placeholder="Nhập nội dung phản hồi tới khách hàng..."
                    className="w-full rounded-xl border border-white/15 bg-[#131722] px-3 py-2 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/25"
                  />

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-400">
                      Người phản hồi: {user?.username ?? "Admin"}
                    </span>
                    <button
                      type="button"
                      disabled={isReplying}
                      onClick={() => void handleSendReply(review.id)}
                      className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {isReplying ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MangaIcon name="send" className="h-4 w-4" />
                      )}
                      <span>{isReplying ? "Đang gửi..." : "Gửi phản hồi"}</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <p className="text-sm text-slate-400">
            Trang {page} / {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-[#131722] px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-[#1B2130] disabled:opacity-40"
            >
              <MangaIcon name="chevron-left" className="h-4 w-4" />
              <span>Trước</span>
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-[#131722] px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-[#1B2130] disabled:opacity-40"
            >
              <span>Sau</span>
              <MangaIcon name="chevron-right" className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AdminReviewsPage;
