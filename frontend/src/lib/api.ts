const TOKEN_LOCAL_KEY = "mangastore_token";
const TOKEN_SESSION_KEY = "mangastore_session_token";
const AUTH_EXPIRED_EVENT = "ms:auth-expired";

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_LOCAL_KEY) || sessionStorage.getItem(TOKEN_SESSION_KEY);
}

export function setStoredToken(token: string | null, persistent = true): void {
  localStorage.removeItem(TOKEN_LOCAL_KEY);
  sessionStorage.removeItem(TOKEN_SESSION_KEY);
  if (!token) return;
  if (persistent) {
    localStorage.setItem(TOKEN_LOCAL_KEY, token);
  } else {
    sessionStorage.setItem(TOKEN_SESSION_KEY, token);
  }
}

export function onAuthExpired(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(AUTH_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
}

async function parseErrorMessage(resp: Response): Promise<{ msg: string; data: unknown }> {
  let payload: unknown = null;
  try {
    payload = await resp.json();
  } catch {
    return { msg: `Lỗi máy chủ (HTTP ${resp.status})`, data: null };
  }
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.detail === "string") return { msg: obj.detail, data: payload };
    if (typeof obj.message === "string") return { msg: obj.message, data: payload };
    if (typeof obj.error === "string") return { msg: obj.error, data: payload };
  }
  return { msg: `Yêu cầu thất bại (HTTP ${resp.status})`, data: payload };
}

export async function request<T>(
  path: string,
  options: RequestInit & { skipAuthExpiredEvent?: boolean } = {}
): Promise<T> {
  const { skipAuthExpiredEvent, headers: customHeaders, body, ...rest } = options;
  const token = getStoredToken();
  const headers = new Headers(customHeaders);

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (body && !(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const resp = await fetch(path, {
    ...rest,
    headers,
    body,
  });

  if (!resp.ok) {
    if (resp.status === 401 && token && !skipAuthExpiredEvent) {
      setStoredToken(null);
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }
    const { msg, data } = await parseErrorMessage(resp);
    throw new ApiError(resp.status, msg, data);
  }

  if (resp.status === 204) {
    return undefined as T;
  }
  return (await resp.json()) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown, skipAuthExpiredEvent = false) =>
    request<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      skipAuthExpiredEvent,
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export async function downloadFileWithAuth(path: string, fallbackName: string): Promise<void> {
  const token = getStoredToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const resp = await fetch(path, { headers });
  if (!resp.ok) {
    const { msg } = await parseErrorMessage(resp);
    throw new ApiError(resp.status, msg);
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const cd = resp.headers.get("content-disposition") || "";
  const match = cd.match(/filename\*?=(?:UTF-8'')?"?([^";\n]+)"?/i);
  a.download = match ? decodeURIComponent(match[1]) : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
