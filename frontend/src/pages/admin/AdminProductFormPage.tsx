import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { useToast } from "../../contexts/ToastContext";
import { apiClient } from "../../lib/api";
import {
  AdminErrorState,
  AdminLoadingState,
  DEFAULT_COVER_URL,
  getErrorMessage,
  handleCoverError,
  resolveImageUrl,
} from "./adminShared";

interface ExistingGalleryAsset {
  id: number;
  url: string;
  asset_type: string;
  description: string | null;
  display_order: number;
}

interface AdminProductDetailPayload {
  id: number;
  title: string;
  author: string;
  publisher: string | null;
  publication_date: string | null;
  pages: number | null;
  dimensions: string | null;
  weight: string | null;
  language: string;
  isbn: string | null;
  description: string;
  full_description: string;
  cover_url: string;
  price: number;
  original_price: number | null;
  stock_quantity: number;
  in_stock: boolean;
  is_featured: boolean;
  is_new: boolean;
  category: string;
  tags: string[];
  tags_input?: string;
  gallery: ExistingGalleryAsset[];
}

interface CategoriesPayload {
  categories: string[];
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

function isAllowedImageFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return ALLOWED_IMAGE_EXT.some((ext) => lower.endsWith(ext));
}

export function AdminProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [categories, setCategories] = useState<string[]>([]);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [stockQuantity, setStockQuantity] = useState("10");
  const [inStock, setInStock] = useState(true);
  const [isFeatured, setIsFeatured] = useState(false);
  const [isNew, setIsNew] = useState(true);
  const [description, setDescription] = useState("");
  const [fullDescription, setFullDescription] = useState("");
  const [tags, setTags] = useState("");
  const [author, setAuthor] = useState("");
  const [publisher, setPublisher] = useState("");
  const [publicationDate, setPublicationDate] = useState("");
  const [pages, setPages] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [weight, setWeight] = useState("");
  const [language, setLanguage] = useState("Tiếng Việt");
  const [isbn, setIsbn] = useState("");

  const [existingCoverUrl, setExistingCoverUrl] = useState(DEFAULT_COVER_URL);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);

  const [existingGallery, setExistingGallery] = useState<ExistingGalleryAsset[]>([]);
  const [removeAssetIds, setRemoveAssetIds] = useState<number[]>([]);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [galleryPreviews, setGalleryPreviews] = useState<string[]>([]);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  useEffect(() => {
    return () => {
      for (const url of galleryPreviews) {
        URL.revokeObjectURL(url);
      }
    };
  }, [galleryPreviews]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const catPromise = apiClient
        .get<CategoriesPayload>("/api/admin/products")
        .then((res) => res.categories ?? [])
        .catch(() => [] as string[]);

      if (isEdit && id) {
        const [prod, loadedCats] = await Promise.all([
          apiClient.get<AdminProductDetailPayload>(`/api/admin/products/${id}`),
          catPromise,
        ]);
        setCategories(loadedCats);
        setTitle(prod.title ?? "");
        setCategory(prod.category ?? "");
        setPrice(String(prod.price ?? ""));
        setOriginalPrice(
          prod.original_price !== null && prod.original_price !== undefined
            ? String(prod.original_price)
            : ""
        );
        setStockQuantity(String(prod.stock_quantity ?? 0));
        setInStock(Boolean(prod.in_stock));
        setIsFeatured(Boolean(prod.is_featured));
        setIsNew(Boolean(prod.is_new));
        setDescription(prod.description ?? "");
        setFullDescription(prod.full_description ?? "");
        setTags(prod.tags_input ?? (prod.tags ?? []).join(", "));
        setAuthor(prod.author ?? "");
        setPublisher(prod.publisher ?? "");
        setPublicationDate(prod.publication_date ?? "");
        setPages(prod.pages !== null && prod.pages !== undefined ? String(prod.pages) : "");
        setDimensions(prod.dimensions ?? "");
        setWeight(prod.weight ?? "");
        setLanguage(prod.language || "Tiếng Việt");
        setIsbn(prod.isbn ?? "");
        setExistingCoverUrl(prod.cover_url || DEFAULT_COVER_URL);
        setExistingGallery(prod.gallery ?? []);
        setRemoveAssetIds([]);
      } else {
        const loadedCats = await catPromise;
        setCategories(loadedCats);
      }
    } catch (err) {
      setLoadError(getErrorMessage(err, "Không thể tải thông tin sản phẩm."));
    } finally {
      setLoading(false);
    }
  }, [id, isEdit]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  const handleCoverChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setCoverFile(null);
      setCoverPreviewUrl(null);
      return;
    }
    if (!isAllowedImageFile(file)) {
      showToast("Ảnh bìa chỉ hỗ trợ JPG, JPEG, PNG, GIF hoặc WEBP.", "warning");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      showToast("Kích thước ảnh bìa không được vượt quá 5MB.", "warning");
      event.target.value = "";
      return;
    }
    setCoverFile(file);
    setCoverPreviewUrl(URL.createObjectURL(file));
  };

  const handleGalleryFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length === 0) return;

    const validFiles: File[] = [];
    for (const file of selected) {
      if (!isAllowedImageFile(file)) {
        showToast(`Tệp "${file.name}" không đúng định dạng ảnh hỗ trợ.`, "warning");
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        showToast(`Tệp "${file.name}" vượt quá giới hạn 5MB.`, "warning");
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) {
      event.target.value = "";
      return;
    }

    setGalleryFiles((prev) => [...prev, ...validFiles]);
    setGalleryPreviews((prev) => [
      ...prev,
      ...validFiles.map((file) => URL.createObjectURL(file)),
    ]);
    event.target.value = "";
  };

  const removePendingGalleryFile = (index: number) => {
    setGalleryFiles((prev) => prev.filter((_, idx) => idx !== index));
    setGalleryPreviews((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target);
      return prev.filter((_, idx) => idx !== index);
    });
  };

  const toggleRemoveExistingAsset = (assetId: number) => {
    setRemoveAssetIds((prev) =>
      prev.includes(assetId)
        ? prev.filter((item) => item !== assetId)
        : [...prev, assetId]
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const cleanedTitle = title.trim();
    const cleanedCategory = category.trim();
    const parsedPrice = Number.parseFloat(price);
    const parsedStock = Number.parseInt(stockQuantity, 10);

    if (!cleanedTitle) {
      setFormError("Tên sản phẩm không được để trống.");
      return;
    }
    if (!cleanedCategory) {
      setFormError("Danh mục không được để trống.");
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setFormError("Giá bán phải lớn hơn 0.");
      return;
    }
    if (!Number.isFinite(parsedStock) || parsedStock < 0) {
      setFormError("Số lượng tồn kho phải là số nguyên >= 0.");
      return;
    }

    const trimmedOrig = originalPrice.trim();
    if (trimmedOrig) {
      const parsedOrig = Number.parseFloat(trimmedOrig);
      if (!Number.isFinite(parsedOrig) || parsedOrig <= 0) {
        setFormError("Giá gốc phải là số dương hoặc để trống.");
        return;
      }
    }

    const trimmedPages = pages.trim();
    if (trimmedPages) {
      const parsedPages = Number.parseInt(trimmedPages, 10);
      if (!Number.isFinite(parsedPages) || parsedPages < 1) {
        setFormError("Số trang phải là số nguyên >= 1.");
        return;
      }
    }

    const formData = new FormData();
    formData.append("title", cleanedTitle);
    formData.append("category", cleanedCategory);
    formData.append("price", String(parsedPrice));
    formData.append("original_price", trimmedOrig);
    formData.append("stock_quantity", String(parsedStock));
    formData.append("in_stock", String(inStock));
    formData.append("is_featured", String(isFeatured));
    formData.append("is_new", String(isNew));
    formData.append("description", description.trim());
    formData.append("full_description", fullDescription.trim());
    formData.append("tags", tags.trim());
    formData.append("author", author.trim() || "Không rõ");
    formData.append("publisher", publisher.trim());
    formData.append("publication_date", publicationDate.trim());
    formData.append("pages", trimmedPages);
    formData.append("dimensions", dimensions.trim());
    formData.append("weight", weight.trim());
    formData.append("language", language.trim() || "Tiếng Việt");
    formData.append("isbn", isbn.trim());

    if (coverFile) {
      formData.append("cover_file", coverFile);
    } else if (existingCoverUrl) {
      formData.append("cover_url", existingCoverUrl);
    }

    for (const file of galleryFiles) {
      formData.append("gallery_files", file);
    }

    if (isEdit && removeAssetIds.length > 0) {
      formData.append("remove_asset_ids", removeAssetIds.join(","));
    }

    setSubmitting(true);
    try {
      if (isEdit && id) {
        await apiClient.put(`/api/admin/products/${id}`, formData);
        showToast("Đã cập nhật sản phẩm thành công!", "success");
      } else {
        await apiClient.post("/api/admin/products", formData);
        showToast("Đã tạo sản phẩm mới thành công!", "success");
      }
      navigate("/admin/products");
    } catch (err) {
      const msg = getErrorMessage(err, "Không thể lưu sản phẩm. Vui lòng thử lại.");
      setFormError(msg);
      showToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="border-b border-white/10 pb-5">
          <h1 className="font-display text-2xl font-bold text-[#F5F6FA]">
            {isEdit ? "Chỉnh sửa sản phẩm" : "Thêm sản phẩm mới"}
          </h1>
        </div>
        <AdminLoadingState label="Đang tải biểu mẫu sản phẩm..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <div className="border-b border-white/10 pb-5">
          <h1 className="font-display text-2xl font-bold text-[#F5F6FA]">
            {isEdit ? "Chỉnh sửa sản phẩm" : "Thêm sản phẩm mới"}
          </h1>
        </div>
        <AdminErrorState message={loadError} onRetry={() => void loadInitialData()} />
      </div>
    );
  }

  const displayedCover = coverPreviewUrl ?? resolveImageUrl(existingCoverUrl);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-[#F5F6FA]">
            {isEdit ? "Sửa sản phẩm" : "Thêm sản phẩm mới"}
          </h1>
        </div>
        <Link
          to="/admin/products"
          className="inline-flex items-center gap-2 self-start rounded-xl border border-white/15 bg-[#131722] px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-[#E63946]/50 hover:text-white"
        >
          <MangaIcon name="arrow-left" className="h-4 w-4" />
          <span>Quay lại</span>
        </Link>
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

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-3xl border border-white/10 bg-[#131722]/90 p-6 shadow-xl backdrop-blur-xl sm:p-8"
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <label
              htmlFor="prod-title"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Tên sản phẩm *
            </label>
            <input
              id="prod-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nhập tên sản phẩm"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="prod-category"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Danh mục *
            </label>
            <input
              id="prod-category"
              type="text"
              required
              list="admin-product-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Ví dụ: Shounen, Seinen, Comedy..."
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
            <datalist id="admin-product-categories">
              {categories.map((cat) => (
                <option key={cat} value={cat} />
              ))}
            </datalist>
          </div>

          <div>
            <label
              htmlFor="prod-stock"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Số lượng tồn kho *
            </label>
            <input
              id="prod-stock"
              type="number"
              min={0}
              required
              value={stockQuantity}
              onChange={(e) => setStockQuantity(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-[#F5F6FA] focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="prod-price"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Giá bán (đ) *
            </label>
            <input
              id="prod-price"
              type="number"
              step="1000"
              min={1}
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="45000"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="prod-orig-price"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Giá gốc (đ)
            </label>
            <input
              id="prod-orig-price"
              type="number"
              step="1000"
              min={0}
              value={originalPrice}
              onChange={(e) => setOriginalPrice(e.target.value)}
              placeholder="55000"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="mb-2 block text-sm font-semibold text-slate-300">
              Ảnh bìa sản phẩm
            </label>
            <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#1B2130]/75 p-4 sm:flex-row sm:items-center">
              <img
                src={displayedCover}
                alt={title || "Ảnh bìa sản phẩm"}
                onError={handleCoverError}
                className="h-28 w-20 shrink-0 rounded-xl bg-[#0B0D14] object-cover shadow-md"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.gif,.webp"
                  onChange={handleCoverChange}
                  className="block w-full rounded-xl border border-dashed border-white/20 bg-[#131722] px-4 py-2.5 text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-[#E63946]/15 file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-[#FF6B77] hover:file:bg-[#E63946]/25 focus:border-[#E63946] focus:outline-none"
                />
                <p className="text-xs text-slate-400">
                  {coverFile
                    ? `Đã chọn ảnh mới: ${coverFile.name}`
                    : "Hỗ trợ JPG, JPEG, PNG, GIF, WEBP (tối đa 5MB)."}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-6 lg:col-span-2">
            <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-slate-200">
              <input
                type="checkbox"
                checked={inStock}
                onChange={(e) => setInStock(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-[#1B2130] accent-[#E63946]"
              />
              <span>Còn hàng (Đang bán)</span>
            </label>

            <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-slate-200">
              <input
                type="checkbox"
                checked={isFeatured}
                onChange={(e) => setIsFeatured(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-[#1B2130] accent-[#F59E0B]"
              />
              <MangaIcon name="star" className="h-4 w-4 text-[#F59E0B]" />
              <span>Sản phẩm nổi bật</span>
            </label>

            <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-slate-200">
              <input
                type="checkbox"
                checked={isNew}
                onChange={(e) => setIsNew(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-[#1B2130] accent-[#22D3EE]"
              />
              <MangaIcon name="sparkles" className="h-4 w-4 text-[#22D3EE]" />
              <span>Sản phẩm mới</span>
            </label>
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="prod-desc"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Mô tả ngắn
            </label>
            <textarea
              id="prod-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả ngắn gọn hiển thị trên thẻ sản phẩm"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="prod-full-desc"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Mô tả đầy đủ
            </label>
            <textarea
              id="prod-full-desc"
              rows={5}
              value={fullDescription}
              onChange={(e) => setFullDescription(e.target.value)}
              placeholder="Mô tả chi tiết nội dung và ấn phẩm"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="prod-tags"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Tags (phân cách bởi dấu phẩy)
            </label>
            <input
              id="prod-tags"
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="ví dụ: bestseller, phiêu lưu, action"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="prod-author"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Tác giả
            </label>
            <input
              id="prod-author"
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Tên tác giả"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="prod-publisher"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Nhà xuất bản
            </label>
            <input
              id="prod-publisher"
              type="text"
              value={publisher}
              onChange={(e) => setPublisher(e.target.value)}
              placeholder="NXB Kim Đồng, NXB Trẻ..."
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="prod-pub-date"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Ngày xuất bản
            </label>
            <input
              id="prod-pub-date"
              type="text"
              value={publicationDate}
              onChange={(e) => setPublicationDate(e.target.value)}
              placeholder="YYYY-MM-DD"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="prod-pages"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Số trang
            </label>
            <input
              id="prod-pages"
              type="number"
              min={1}
              value={pages}
              onChange={(e) => setPages(e.target.value)}
              placeholder="192"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="prod-dimensions"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Kích thước
            </label>
            <input
              id="prod-dimensions"
              type="text"
              value={dimensions}
              onChange={(e) => setDimensions(e.target.value)}
              placeholder="11.3 x 17.6 cm"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="prod-weight"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Trọng lượng
            </label>
            <input
              id="prod-weight"
              type="text"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="180 g"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="prod-language"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Ngôn ngữ
            </label>
            <input
              id="prod-language"
              type="text"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="Tiếng Việt"
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="prod-isbn"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              ISBN
            </label>
            <input
              id="prod-isbn"
              type="text"
              value={isbn}
              onChange={(e) => setIsbn(e.target.value)}
              placeholder="978-604-2-..."
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-3 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#1B2130]/60 p-5">
          <h2 className="font-display text-lg font-semibold text-[#F5F6FA]">
            Thư viện ảnh phụ
          </h2>

          {existingGallery.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {existingGallery.map((asset) => {
                const markedForRemove = removeAssetIds.includes(asset.id);
                return (
                  <div
                    key={asset.id}
                    className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                      markedForRemove
                        ? "border-red-500/45 bg-red-500/10"
                        : "border-white/10 bg-[#131722]/90"
                    }`}
                  >
                    <img
                      src={resolveImageUrl(asset.url)}
                      alt={`Ảnh phụ #${asset.id}`}
                      onError={handleCoverError}
                      className="h-20 w-14 shrink-0 rounded-lg object-cover"
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="truncate text-xs text-slate-400">
                        Thứ tự: {asset.display_order}
                      </p>
                      <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-red-400">
                        <input
                          type="checkbox"
                          checked={markedForRemove}
                          onChange={() => toggleRemoveExistingAsset(asset.id)}
                          className="h-4 w-4 rounded border-white/20 bg-[#1B2130] accent-[#E63946]"
                        />
                        <span>Xóa ảnh này</span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-white/15 bg-[#131722]/60 px-4 py-5 text-center text-sm text-slate-400">
              Chưa có ảnh phụ trong thư viện.
            </p>
          )}

          {galleryPreviews.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {galleryPreviews.map((previewUrl, index) => (
                <div
                  key={`${previewUrl}-${index}`}
                  className="relative overflow-hidden rounded-xl border border-cyan-500/35 bg-[#131722]"
                >
                  <img
                    src={previewUrl}
                    alt={galleryFiles[index]?.name ?? `Ảnh mới ${index + 1}`}
                    className="aspect-[3/4] w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePendingGalleryFile(index)}
                    aria-label="Bỏ ảnh này"
                    className="absolute right-1.5 top-1.5 rounded-lg bg-black/75 p-1 text-white hover:bg-[#E63946]"
                  >
                    <MangaIcon name="x" className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4">
            <label
              htmlFor="prod-gallery-files"
              className="mb-2 block text-sm font-semibold text-slate-300"
            >
              Tải thêm ảnh thư viện
            </label>
            <input
              id="prod-gallery-files"
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.gif,.webp"
              onChange={handleGalleryFilesChange}
              className="block w-full rounded-xl border border-dashed border-white/20 bg-[#131722] px-4 py-3 text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-[#E63946]/15 file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-[#FF6B77] hover:file:bg-[#E63946]/25 focus:border-[#E63946] focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-6">
          <Link
            to="/admin/products"
            className="rounded-xl border border-white/15 bg-[#1B2130] px-6 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10"
          >
            Hủy
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-xl border px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MangaIcon name="save" className="h-4 w-4" />
            )}
            <span>
              {submitting
                ? "Đang lưu..."
                : isEdit
                  ? "Cập nhật sản phẩm"
                  : "Lưu sản phẩm"}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}

export default AdminProductFormPage;
