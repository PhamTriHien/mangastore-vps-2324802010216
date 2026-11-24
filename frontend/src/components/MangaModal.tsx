import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertCircle, Check, Loader2, Save, X } from "lucide-react";
import { ApiError, COVER_PRESETS, DEFAULT_COVER_URL, api } from "../lib/api";
import { MANGA_STATUS_OPTIONS, resolveCoverUrl } from "../lib/format";
import type { MangaOut, MangaPayload } from "../types/manga";

interface MangaModalProps {
  open: boolean;
  manga: MangaOut | null;
  token: string | null;
  availableGenres: string[];
  onClose: () => void;
  onSaved: (saved: MangaOut, isEdit: boolean) => void;
  onUnauthorized: () => void;
}

export function MangaModal({
  open,
  manga,
  token,
  availableGenres,
  onClose,
  onSaved,
  onUnauthorized,
}: MangaModalProps) {
  const isEdit = manga !== null;

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [genre, setGenre] = useState("");
  const [status, setStatus] = useState<string>("Đang tiến hành");
  const [coverUrl, setCoverUrl] = useState<string>(COVER_PRESETS[0]?.url ?? DEFAULT_COVER_URL);
  const [rating, setRating] = useState("4.8");
  const [description, setDescription] = useState("");
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (manga) {
      setTitle(manga.title);
      setAuthor(manga.author);
      setGenre(manga.genre);
      setStatus(manga.status || "Đang tiến hành");
      setCoverUrl(manga.cover_url || DEFAULT_COVER_URL);
      setRating(String(manga.rating));
      setDescription(manga.description);
    } else {
      setTitle("");
      setAuthor("");
      setGenre(availableGenres[0] ?? "Hành động");
      setStatus("Đang tiến hành");
      setCoverUrl(COVER_PRESETS[0]?.url ?? DEFAULT_COVER_URL);
      setRating("4.8");
      setDescription("");
    }
    setFailedPreviewUrl(null);
    setError(null);
  }, [open, manga, availableGenres]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const resolvedPreview = resolveCoverUrl(coverUrl);
  const previewSrc =
    failedPreviewUrl === resolvedPreview ? DEFAULT_COVER_URL : resolvedPreview;

  const statusChoices = MANGA_STATUS_OPTIONS.includes(
    status as (typeof MANGA_STATUS_OPTIONS)[number]
  )
    ? [...MANGA_STATUS_OPTIONS]
    : [status, ...MANGA_STATUS_OPTIONS];

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("Bạn cần đăng nhập để thực hiện thao tác này.");
      return;
    }

    const parsedRating = Number.parseFloat(rating);
    if (!title.trim() || !author.trim() || !genre.trim()) {
      setError("Vui lòng nhập đầy đủ Tên truyện, Tác giả và Thể loại.");
      return;
    }
    if (!Number.isFinite(parsedRating) || parsedRating < 0 || parsedRating > 5) {
      setError("Điểm đánh giá phải nằm trong khoảng từ 0.0 đến 5.0.");
      return;
    }

    const payload: MangaPayload = {
      title: title.trim(),
      author: author.trim(),
      genre: genre.trim(),
      status: status.trim() || "Đang tiến hành",
      cover_url: coverUrl.trim() || DEFAULT_COVER_URL,
      description: description.trim(),
      rating: Number(parsedRating.toFixed(1)),
    };

    setSubmitting(true);
    try {
      const saved = isEdit
        ? await api.updateManga(manga.id, payload, token)
        : await api.createManga(payload, token);
      onSaved(saved, isEdit);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          onUnauthorized();
        }
        setError(err.message);
      } else {
        setError("Không thể lưu thông tin truyện. Vui lòng thử lại.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manga-modal-title"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#232838] bg-[#131620] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#232838] px-6 py-4">
          <h2 id="manga-modal-title" className="text-lg font-bold text-[#F5F6FA]">
            {isEdit ? "Chỉnh sửa thông tin truyện" : "Thêm đầu truyện mới"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Đóng hộp thoại"
            className="rounded-lg p-1.5 text-[#94A3B8] transition-colors hover:bg-[#1E2436] hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-6">
          {error ? (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2.5 rounded-xl border border-[#E63946]/45 bg-[#E63946]/12 px-4 py-3 text-sm text-[#FF9BA3]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#E63946]" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="grid gap-6 md:grid-cols-[200px_1fr]">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-[#CBD5E1]">Xem trước bìa</p>
              <div className="mx-auto aspect-[3/4] w-44 overflow-hidden rounded-xl border border-[#232838] bg-[#0A0B10] shadow-lg md:w-full">
                <img
                  src={previewSrc}
                  alt={title || "Xem trước ảnh bìa"}
                  onError={() => {
                    if (previewSrc !== DEFAULT_COVER_URL) {
                      setFailedPreviewUrl(resolvedPreview);
                    }
                  }}
                  className="h-full w-full object-cover"
                />
              </div>
              <p className="text-center text-[11px] text-[#64748B]">
                Tự động dùng ảnh mặc định nếu đường dẫn không tải được
              </p>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="manga-title"
                    className="mb-1.5 block text-xs font-semibold text-[#CBD5E1]"
                  >
                    Tên truyện
                  </label>
                  <input
                    id="manga-title"
                    type="text"
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Ví dụ: Đảo Hải Tặc"
                    className="w-full rounded-xl border border-[#232838] bg-[#0A0B10] px-3.5 py-2.5 text-sm text-[#F5F6FA] placeholder-[#64748B] focus:border-[#06B6D4] focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="manga-author"
                    className="mb-1.5 block text-xs font-semibold text-[#CBD5E1]"
                  >
                    Tác giả
                  </label>
                  <input
                    id="manga-author"
                    type="text"
                    required
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                    placeholder="Ví dụ: Eiichiro Oda"
                    className="w-full rounded-xl border border-[#232838] bg-[#0A0B10] px-3.5 py-2.5 text-sm text-[#F5F6FA] placeholder-[#64748B] focus:border-[#06B6D4] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="manga-genre"
                    className="mb-1.5 block text-xs font-semibold text-[#CBD5E1]"
                  >
                    Thể loại
                  </label>
                  <input
                    id="manga-genre"
                    type="text"
                    required
                    list="manga-genre-suggestions"
                    value={genre}
                    onChange={(event) => setGenre(event.target.value)}
                    placeholder="Hành động, Phiêu lưu..."
                    className="w-full rounded-xl border border-[#232838] bg-[#0A0B10] px-3.5 py-2.5 text-sm text-[#F5F6FA] placeholder-[#64748B] focus:border-[#06B6D4] focus:outline-none"
                  />
                  {availableGenres.length > 0 ? (
                    <datalist id="manga-genre-suggestions">
                      {availableGenres.map((item) => (
                        <option key={item} value={item} />
                      ))}
                    </datalist>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="manga-status"
                    className="mb-1.5 block text-xs font-semibold text-[#CBD5E1]"
                  >
                    Trạng thái
                  </label>
                  <select
                    id="manga-status"
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    className="w-full rounded-xl border border-[#232838] bg-[#0A0B10] px-3.5 py-2.5 text-sm text-[#F5F6FA] focus:border-[#06B6D4] focus:outline-none"
                  >
                    {statusChoices.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="manga-rating"
                    className="mb-1.5 block text-xs font-semibold text-[#CBD5E1]"
                  >
                    Đánh giá (0 - 5)
                  </label>
                  <input
                    id="manga-rating"
                    type="number"
                    min="0"
                    max="5"
                    step="0.1"
                    value={rating}
                    onChange={(event) => setRating(event.target.value)}
                    className="w-full rounded-xl border border-[#232838] bg-[#0A0B10] px-3.5 py-2.5 text-sm text-[#F5F6FA] focus:border-[#06B6D4] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="manga-cover-url"
                  className="mb-1.5 block text-xs font-semibold text-[#CBD5E1]"
                >
                  Ảnh bìa (đường dẫn hoặc chọn nhanh bên dưới)
                </label>
                <input
                  id="manga-cover-url"
                  type="text"
                  value={coverUrl}
                  onChange={(event) => {
                    setCoverUrl(event.target.value);
                    setFailedPreviewUrl(null);
                  }}
                  placeholder="/covers/one-piece.jpg hoặc https://..."
                  className="w-full rounded-xl border border-[#232838] bg-[#0A0B10] px-3.5 py-2.5 text-sm text-[#F5F6FA] placeholder-[#64748B] focus:border-[#06B6D4] focus:outline-none"
                />

                <div className="mt-2.5 grid grid-cols-6 gap-2 sm:grid-cols-12">
                  {COVER_PRESETS.map((preset) => {
                    const selected = coverUrl.trim() === preset.url;
                    return (
                      <button
                        key={preset.url}
                        type="button"
                        onClick={() => {
                          setCoverUrl(preset.url);
                          setFailedPreviewUrl(null);
                        }}
                        title={preset.label}
                        aria-label={`Chọn ảnh bìa ${preset.label}`}
                        className={`relative aspect-[3/4] overflow-hidden rounded-lg border transition-transform hover:scale-105 ${
                          selected
                            ? "border-[#06B6D4] ring-2 ring-[#06B6D4]/50"
                            : "border-[#232838] opacity-75 hover:opacity-100"
                        }`}
                      >
                        <img
                          src={preset.url}
                          alt={preset.label}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                        {selected ? (
                          <span className="absolute inset-0 flex items-center justify-center bg-[#06B6D4]/25">
                            <Check className="h-4 w-4 text-white drop-shadow" />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  htmlFor="manga-description"
                  className="mb-1.5 block text-xs font-semibold text-[#CBD5E1]"
                >
                  Mô tả nội dung
                </label>
                <textarea
                  id="manga-description"
                  rows={4}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Tóm tắt cốt truyện..."
                  className="w-full resize-y rounded-xl border border-[#232838] bg-[#0A0B10] px-3.5 py-2.5 text-sm leading-relaxed text-[#F5F6FA] placeholder-[#64748B] focus:border-[#06B6D4] focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-[#232838] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="ms-btn-3d-subtle rounded-xl border border-[#232838] bg-[#191D2A] px-4 py-2 text-sm font-medium text-[#CBD5E1] hover:border-[#333B54] hover:text-white disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="ms-btn-3d inline-flex items-center gap-2 rounded-xl bg-[#E63946] px-5 py-2 text-sm font-semibold text-white hover:bg-[#EE4653] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              <span>
                {submitting
                  ? "Đang lưu..."
                  : isEdit
                    ? "Lưu thay đổi"
                    : "Tạo truyện"}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
