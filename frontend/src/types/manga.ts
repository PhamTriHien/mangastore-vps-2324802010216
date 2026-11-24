export type MangaSortOption = "latest" | "views" | "rating" | "title";

export interface HealthOut {
  status: string;
  db: string;
}

export interface UserOut {
  id: number;
  username: string;
  email: string;
  role: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: UserOut;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

export interface LoginInput {
  identifier: string;
  password: string;
}

export interface StatsOut {
  total_mangas: number;
  total_chapters: number;
  total_users: number;
  total_views: number;
  genres: string[];
}

export interface MangaOut {
  id: number;
  title: string;
  author: string;
  genre: string;
  status: string;
  cover_url: string;
  description: string;
  rating: number;
  views: number;
  chapter_count: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChapterSummaryOut {
  id: number;
  manga_id: number;
  chapter_number: number;
  title: string;
  created_at: string;
}

export interface MangaDetailOut extends MangaOut {
  chapters: ChapterSummaryOut[];
}

export interface MangaPayload {
  title: string;
  author: string;
  genre: string;
  status: string;
  cover_url: string;
  description: string;
  rating: number;
}

export interface ChapterOut {
  id: number;
  manga_id: number;
  manga_title: string;
  chapter_number: number;
  title: string;
  content: string;
  created_at: string;
  prev_chapter_id: number | null;
  next_chapter_id: number | null;
}

export interface ChapterCreateInput {
  chapter_number: number;
  title: string;
  content: string;
}

export interface MessageOut {
  message: string;
}

export interface MangaQueryParams {
  search?: string;
  genre?: string;
  status?: string;
  sort?: MangaSortOption;
}
