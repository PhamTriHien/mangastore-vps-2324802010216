import type {
  AuthResponse,
  ChapterCreateInput,
  ChapterOut,
  ChapterSummaryOut,
  HealthOut,
  LoginInput,
  MangaDetailOut,
  MangaOut,
  MangaPayload,
  MangaQueryParams,
  MessageOut,
  RegisterInput,
  StatsOut,
  UserOut,
} from "../types/manga";

const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
export const API_BASE_URL = RAW_API_BASE.replace(/\/+$/, "") || "/api";
export const TOKEN_STORAGE_KEY = "mangastore_token";
export const DEFAULT_COVER_URL = "/covers/default-manga.svg";

export interface CoverPreset {
  label: string;
  url: string;
}

export const COVER_PRESETS: readonly CoverPreset[] = [
  { label: "One Piece", url: "/covers/one-piece.jpg" },
  { label: "Naruto", url: "/covers/naruto.jpg" },
  { label: "Dragon Ball", url: "/covers/dragon-ball.jpg" },
  { label: "Thanh Gươm Diệt Quỷ", url: "/covers/demon-slayer.jpg" },
  { label: "Chú Thuật Hồi Chiến", url: "/covers/jujutsu-kaisen.jpg" },
  { label: "Học Viện Anh Hùng", url: "/covers/my-hero-academia.jpg" },
  { label: "Đại Chiến Titan", url: "/covers/attack-on-titan.jpg" },
  { label: "Gia Đình Điệp Viên", url: "/covers/spy-family.jpg" },
  { label: "Người Cưa", url: "/covers/chainsaw-man.jpg" },
  { label: "Tokyo Revengers", url: "/covers/tokyo-revengers.jpg" },
  { label: "Blue Lock", url: "/covers/blue-lock.jpg" },
  { label: "Frieren", url: "/covers/frieren.jpg" },
];

export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

export function clearStoredToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

function translateKnownDetail(detail: string): string {
  const normalized = detail.trim();
  const lower = normalized.toLowerCase();

  if (
    lower.includes("invalid credentials") ||
    lower.includes("invalid username/email or password") ||
    lower.includes("incorrect")
  ) {
    return "Tên đăng nhập, email hoặc mật khẩu không chính xác.";
  }
  if (lower.includes("not authenticated") || lower.includes("could not validate credentials")) {
    return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  }
  if (lower.includes("username or email is already registered")) {
    return "Tên đăng nhập hoặc email này đã được đăng ký.";
  }
  if (lower.includes("username") && lower.includes("already")) {
    return "Tên đăng nhập này đã được sử dụng.";
  }
  if (lower.includes("email") && lower.includes("already")) {
    return "Email này đã được đăng ký.";
  }
  if (lower.includes("chapter number already exists")) {
    return "Số chương này đã tồn tại trong truyện.";
  }
  if (lower.includes("already exists")) {
    return "Dữ liệu đã tồn tại trong hệ thống.";
  }
  if (lower.includes("manga not found")) {
    return "Không tìm thấy truyện yêu cầu.";
  }
  if (lower.includes("chapter not found")) {
    return "Không tìm thấy chương truyện yêu cầu.";
  }
  return normalized;
}

function formatServerError(status: number, body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string" && detail.trim().length > 0) {
      return translateKnownDetail(detail);
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { loc?: unknown[]; msg?: string };
      const field = Array.isArray(first?.loc) ? String(first.loc[first.loc.length - 1] ?? "") : "";
      const msg = typeof first?.msg === "string" ? first.msg : "Dữ liệu không hợp lệ";
      return field ? `Trường "${field}" chưa hợp lệ: ${msg}` : `Dữ liệu chưa hợp lệ: ${msg}`;
    }
  }

  switch (status) {
    case 400:
      return "Yêu cầu chưa hợp lệ. Vui lòng kiểm tra lại thông tin.";
    case 401:
      return "Phiên đăng nhập hết hạn hoặc thông tin đăng nhập không đúng.";
    case 403:
      return "Bạn không có quyền thực hiện thao tác này.";
    case 404:
      return "Không tìm thấy nội dung yêu cầu.";
    case 409:
      return "Dữ liệu bị trùng lặp với bản ghi hiện có.";
    case 422:
      return "Dữ liệu gửi lên chưa đúng định dạng yêu cầu.";
    default:
      if (status >= 500) {
        return "Máy chủ thư viện đang gặp sự cố. Vui lòng thử lại sau.";
      }
      return `Yêu cầu thất bại (mã lỗi ${status}).`;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, token, signal } = options;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(
      "Không thể kết nối tới máy chủ thư viện. Vui lòng kiểm tra kết nối và thử lại.",
      0,
      error
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  let parsedBody: unknown = null;

  if (response.status !== 204) {
    if (contentType.includes("application/json")) {
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = null;
      }
    } else {
      const text = await response.text().catch(() => "");
      if (text) {
        try {
          parsedBody = JSON.parse(text);
        } catch {
          parsedBody = { detail: text };
        }
      }
    }
  }

  if (!response.ok) {
    if (response.status === 401 && token) {
      clearStoredToken();
    }
    throw new ApiError(formatServerError(response.status, parsedBody), response.status, parsedBody);
  }

  return parsedBody as T;
}

export const api = {
  getHealth(signal?: AbortSignal): Promise<HealthOut> {
    return request<HealthOut>("/health", { signal });
  },

  register(payload: RegisterInput): Promise<AuthResponse> {
    return request<AuthResponse>("/auth/register", {
      method: "POST",
      body: payload,
    });
  },

  login(payload: LoginInput): Promise<AuthResponse> {
    return request<AuthResponse>("/auth/login", {
      method: "POST",
      body: payload,
    });
  },

  getMe(token: string, signal?: AbortSignal): Promise<UserOut> {
    return request<UserOut>("/auth/me", { token, signal });
  },

  getStats(signal?: AbortSignal): Promise<StatsOut> {
    return request<StatsOut>("/stats", { signal });
  },

  getMangaList(query: MangaQueryParams = {}, signal?: AbortSignal): Promise<MangaOut[]> {
    const params = new URLSearchParams();
    params.set("search", query.search?.trim() ?? "");
    params.set("genre", query.genre?.trim() ?? "");
    params.set("status", query.status?.trim() ?? "");
    params.set("sort", query.sort ?? "latest");
    return request<MangaOut[]>(`/manga?${params.toString()}`, { signal });
  },

  getMangaDetail(mangaId: number, signal?: AbortSignal): Promise<MangaDetailOut> {
    return request<MangaDetailOut>(`/manga/${mangaId}`, { signal });
  },

  createManga(payload: MangaPayload, token: string): Promise<MangaOut> {
    return request<MangaOut>("/manga", {
      method: "POST",
      body: payload,
      token,
    });
  },

  updateManga(mangaId: number, payload: MangaPayload, token: string): Promise<MangaOut> {
    return request<MangaOut>(`/manga/${mangaId}`, {
      method: "PUT",
      body: payload,
      token,
    });
  },

  deleteManga(mangaId: number, token: string): Promise<MessageOut> {
    return request<MessageOut>(`/manga/${mangaId}`, {
      method: "DELETE",
      token,
    });
  },

  getMangaChapters(mangaId: number, signal?: AbortSignal): Promise<ChapterSummaryOut[]> {
    return request<ChapterSummaryOut[]>(`/manga/${mangaId}/chapters`, { signal });
  },

  createChapter(
    mangaId: number,
    payload: ChapterCreateInput,
    token: string
  ): Promise<ChapterOut> {
    return request<ChapterOut>(`/manga/${mangaId}/chapters`, {
      method: "POST",
      body: payload,
      token,
    });
  },

  getChapter(chapterId: number, signal?: AbortSignal): Promise<ChapterOut> {
    return request<ChapterOut>(`/chapters/${chapterId}`, { signal });
  },

  deleteChapter(chapterId: number, token: string): Promise<MessageOut> {
    return request<MessageOut>(`/chapters/${chapterId}`, {
      method: "DELETE",
      token,
    });
  },
};
