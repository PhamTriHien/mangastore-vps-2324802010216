from datetime import datetime
import math

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

ALLOWED_MANGA_STATUSES = ("Đang tiến hành", "Hoàn thành", "Tạm ngưng")


def _strip_required_text(value: str, field_name: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{field_name} cannot be blank")
    return cleaned


def _validate_finite(value: float, field_name: str) -> float:
    if not math.isfinite(value):
        raise ValueError(f"{field_name} must be a finite number")
    return value


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    role: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)

    @field_validator("username")
    @classmethod
    def _validate_username(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 3:
            raise ValueError("username must be at least 3 characters")
        return cleaned

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class LoginRequest(BaseModel):
    identifier: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)

    @field_validator("identifier")
    @classmethod
    def _validate_identifier(cls, value: str) -> str:
        return _strip_required_text(value, "identifier")


class ChapterSummaryOut(BaseModel):
    id: int
    manga_id: int
    chapter_number: float
    title: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChapterOut(BaseModel):
    id: int
    manga_id: int
    manga_title: str
    chapter_number: float
    title: str
    content: str
    created_at: datetime
    prev_chapter_id: int | None = None
    next_chapter_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


class MangaOut(BaseModel):
    id: int
    title: str
    author: str
    genre: str
    status: str
    cover_url: str
    description: str
    rating: float
    views: int
    chapter_count: int
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MangaDetailOut(MangaOut):
    chapters: list[ChapterSummaryOut]


class MangaCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    author: str = Field(..., min_length=1, max_length=150)
    genre: str = Field(..., min_length=1, max_length=100)
    status: str = Field(default="Đang tiến hành", max_length=50)
    cover_url: str = Field(default="", max_length=500)
    description: str = Field(default="", max_length=5000)
    rating: float = Field(default=4.8, ge=0.0, le=5.0)

    @field_validator("title", "author", "genre")
    @classmethod
    def _validate_required_fields(cls, value: str, info) -> str:
        return _strip_required_text(value, info.field_name)

    @field_validator("status", mode="before")
    @classmethod
    def _validate_status(cls, value: str | None) -> str:
        if value is None:
            return "Đang tiến hành"
        cleaned = str(value).strip()
        if not cleaned:
            return "Đang tiến hành"
        if cleaned not in ALLOWED_MANGA_STATUSES:
            raise ValueError(f"status must be one of: {', '.join(ALLOWED_MANGA_STATUSES)}")
        return cleaned

    @field_validator("cover_url", "description")
    @classmethod
    def _strip_optional_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("rating")
    @classmethod
    def _validate_rating(cls, value: float) -> float:
        return _validate_finite(value, "rating")


class MangaUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    author: str | None = Field(default=None, min_length=1, max_length=150)
    genre: str | None = Field(default=None, min_length=1, max_length=100)
    status: str | None = Field(default=None, max_length=50)
    cover_url: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    rating: float | None = Field(default=None, ge=0.0, le=5.0)

    @field_validator("title", "author", "genre")
    @classmethod
    def _validate_optional_required_fields(cls, value: str | None, info) -> str | None:
        if value is None:
            return None
        return _strip_required_text(value, info.field_name)

    @field_validator("status", mode="before")
    @classmethod
    def _validate_status(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip()
        if not cleaned:
            return "Đang tiến hành"
        if cleaned not in ALLOWED_MANGA_STATUSES:
            raise ValueError(f"status must be one of: {', '.join(ALLOWED_MANGA_STATUSES)}")
        return cleaned

    @field_validator("cover_url", "description")
    @classmethod
    def _strip_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("rating")
    @classmethod
    def _validate_rating(cls, value: float | None) -> float | None:
        if value is None:
            return None
        return _validate_finite(value, "rating")


class ChapterCreate(BaseModel):
    chapter_number: float = Field(..., gt=0)
    title: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1)

    @field_validator("chapter_number")
    @classmethod
    def _validate_chapter_number(cls, value: float) -> float:
        return _validate_finite(value, "chapter_number")

    @field_validator("title", "content")
    @classmethod
    def _validate_chapter_text(cls, value: str, info) -> str:
        return _strip_required_text(value, info.field_name)


class StatsOut(BaseModel):
    total_mangas: int
    total_chapters: int
    total_users: int
    total_views: int
    genres: list[str]
