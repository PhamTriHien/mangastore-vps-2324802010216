from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.security import get_current_user, get_optional_user
from app.services import reader_service

router = APIRouter(prefix="/api/reader", tags=["reader"])


class ReaderCommentCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source_id: str = Field(
        ...,
        min_length=1,
        max_length=64,
        validation_alias=AliasChoices("source_id", "source"),
    )
    manga_id: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1, max_length=2000)
    parent_comment_id: int | None = Field(default=None, ge=1)
    chapter_id: str | None = Field(default=None, max_length=255)
    chapter_label: str | None = Field(default=None, max_length=120)

    @field_validator("source_id", "manga_id", "content")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Trường dữ liệu không được để trống")
        return cleaned


class ReaderRatingCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source_id: str = Field(
        ...,
        min_length=1,
        max_length=64,
        validation_alias=AliasChoices("source_id", "source"),
    )
    manga_id: str = Field(..., min_length=1, max_length=255)
    score: int = Field(..., ge=1, le=5)

    @field_validator("source_id", "manga_id")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Trường dữ liệu không được để trống")
        return cleaned


class ReaderBookmarkCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source_id: str = Field(
        ...,
        min_length=1,
        max_length=64,
        validation_alias=AliasChoices("source_id", "source"),
    )
    manga_id: str = Field(..., min_length=1, max_length=255)
    title: str = Field(default="", max_length=255)
    cover_url: str = Field(default="", max_length=500)
    author: str = Field(default="", max_length=150)
    status_label: str = Field(default="", max_length=80)
    category: str = Field(default="reading", max_length=30)

    @field_validator("source_id", "manga_id")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Trường dữ liệu không được để trống")
        return cleaned


class ReaderProgressCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source_id: str = Field(
        ...,
        min_length=1,
        max_length=64,
        validation_alias=AliasChoices("source_id", "source"),
    )
    manga_id: str = Field(..., min_length=1, max_length=255)
    chapter_id: str = Field(..., min_length=1, max_length=255)
    page: int = Field(
        default=1,
        ge=1,
        validation_alias=AliasChoices("page", "current_page"),
    )
    total_pages: int | None = Field(default=None, ge=0)
    title: str | None = Field(default=None, max_length=255)
    chapter_label: str | None = Field(default=None, max_length=200)
    cover_url: str | None = Field(default=None, max_length=500)
    language: str | None = Field(default=None, max_length=16)

    @field_validator("source_id", "manga_id", "chapter_id")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Trường dữ liệu không được để trống")
        return cleaned


def _resolve_source_param(source: str | None, source_id: str | None) -> str:
    resolved = (source or source_id or "").strip()
    if not resolved:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Thiếu tham số source.",
        )
    return resolved


@router.get("/sources")
async def list_reader_sources(
    probe: bool = Query(default=True),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    return await reader_service.get_sources(db, probe_external=probe)


@router.get("/tags")
async def get_reader_tags(db: Session = Depends(get_db)) -> dict[str, Any]:
    return await reader_service.get_dual_tags(db)


@router.get("/browse")
async def browse_reader_manga(
    source: str = Query(default="mangadex-vi"),
    q: str | None = Query(default=None),
    search: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    demographic: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    sort: str = Query(default="popular"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=100),
    proxy: bool = Query(default=True),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    effective_q = q if (q and q.strip()) else (search if (search and search.strip()) else keyword)
    return await reader_service.browse_manga(
        db,
        source=source,
        q=effective_q,
        tag=tag,
        demographic=demographic,
        status_filter=status_filter,
        sort=sort,
        page=page,
        page_size=page_size,
        use_proxy=proxy,
    )


@router.get("/cross-search")
async def cross_search_reader_manga(
    q: str = Query(default=""),
    search: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
    limit: int = Query(default=8, ge=1, le=24),
    proxy: bool = Query(default=True),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    effective_q = q.strip() or (search or "").strip() or (keyword or "").strip()
    return await reader_service.cross_search_manga(
        db,
        effective_q,
        limit=limit,
        use_proxy=proxy,
    )


@router.get("/detail")
async def get_reader_manga_detail(
    source: str = Query(default="mangadex-vi"),
    id: str = Query(..., min_length=1),
    lang: str = Query(default="vi"),
    chapter_order: str = Query(default="desc"),
    chapter_q: str | None = Query(default=None),
    proxy: bool = Query(default=True),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
) -> dict[str, Any]:
    return await reader_service.get_manga_detail(
        db,
        source=source,
        manga_id=id,
        lang=lang,
        chapter_order=chapter_order,
        chapter_q=chapter_q,
        proxy=proxy,
        current_user=current_user,
    )


@router.get("/read")
async def read_reader_chapter(
    source: str = Query(default="mangadex-vi"),
    manga_id: str = Query(default=""),
    chapter_id: str = Query(..., min_length=1),
    lang: str = Query(default="vi"),
    quality: str = Query(default="saver"),
    proxy: bool = Query(default=True),
    page: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
) -> dict[str, Any]:
    return await reader_service.get_chapter_pages(
        db,
        source=source,
        manga_id=manga_id,
        chapter_id=chapter_id,
        lang=lang,
        quality=quality,
        proxy=proxy,
        page=page,
        current_user=current_user,
    )


@router.get("/image-proxy")
async def proxy_reader_image(
    url: str = Query(..., min_length=1),
    source: str | None = Query(default=None),
) -> Response:
    content, media_type = await reader_service.fetch_proxied_image(url, source)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/comments")
def list_reader_comments(
    source: str | None = Query(default=None),
    source_id: str | None = Query(default=None),
    manga_id: str = Query(..., min_length=1),
    limit: int = Query(default=60, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
) -> dict[str, Any]:
    resolved_src = _resolve_source_param(source, source_id)
    comments = reader_service.get_comments(
        db,
        resolved_src,
        manga_id,
        current_user=current_user,
        limit=limit,
    )
    local_stats = reader_service.get_single_stats(db, resolved_src, manga_id)
    loaded_total = sum(1 + len(c.get("replies") or []) for c in comments)
    return {
        "comments": comments,
        "total_count": max(local_stats["comment_count"], loaded_total),
        "local_stats": local_stats,
    }


@router.post("/comments", status_code=status.HTTP_201_CREATED)
def create_reader_comment(
    payload: ReaderCommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return reader_service.add_comment(
        db,
        source_id=payload.source_id,
        manga_id=payload.manga_id,
        user=current_user,
        content=payload.content,
        parent_comment_id=payload.parent_comment_id,
        chapter_id=payload.chapter_id,
        chapter_label=payload.chapter_label,
    )


@router.delete("/comments/{comment_id}")
def remove_reader_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return reader_service.delete_comment(
        db,
        comment_id=comment_id,
        current_user=current_user,
    )


@router.post("/rate")
def rate_reader_manga(
    payload: ReaderRatingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return reader_service.upsert_rating(
        db,
        source_id=payload.source_id,
        manga_id=payload.manga_id,
        user=current_user,
        score=payload.score,
    )


@router.get("/shelf")
def get_reader_shelf(
    category: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return reader_service.get_shelf(db, current_user.id, category=category)


@router.post("/bookmarks")
def save_reader_bookmark(
    payload: ReaderBookmarkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return reader_service.set_bookmark(
        db,
        user_id=current_user.id,
        source_id=payload.source_id,
        manga_id=payload.manga_id,
        category=payload.category,
        title=payload.title,
        cover_url=payload.cover_url,
        author=payload.author,
        status_label=payload.status_label,
    )


@router.post("/progress")
def save_reader_progress(
    payload: ReaderProgressCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    history = reader_service.update_reading_progress(
        db,
        user_id=current_user.id,
        source_id=payload.source_id,
        manga_id=payload.manga_id,
        chapter_id=payload.chapter_id,
        page=payload.page,
        total_pages=payload.total_pages,
        title=payload.title,
        chapter_label=payload.chapter_label,
        cover_url=payload.cover_url,
        language=payload.language,
    )
    return {"message": "Đã lưu tiến độ đọc.", "history": history}


@router.delete("/history/clear")
def clear_reader_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    return reader_service.clear_user_history(db, user_id=current_user.id)


@router.delete("/history")
def delete_reader_history(
    source: str | None = Query(default=None),
    source_id: str | None = Query(default=None),
    manga_id: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    resolved_src = _resolve_source_param(source, source_id)
    return reader_service.remove_history_item(
        db,
        user_id=current_user.id,
        source_id=resolved_src,
        manga_id=manga_id,
    )
