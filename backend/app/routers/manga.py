from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Chapter, Manga, User, utc_now
from app.schemas import (
    ChapterCreate,
    ChapterOut,
    ChapterSummaryOut,
    MangaCreate,
    MangaDetailOut,
    MangaOut,
    MangaUpdate,
    StatsOut,
)
from app.security import get_current_user

router = APIRouter(prefix="/api", tags=["manga"])


def _build_manga_out(manga: Manga, chapter_count: int) -> MangaOut:
    return MangaOut(
        id=manga.id,
        title=manga.title,
        author=manga.author,
        genre=manga.genre,
        status=manga.status,
        cover_url=manga.cover_url,
        description=manga.description,
        rating=manga.rating,
        views=manga.views,
        chapter_count=chapter_count,
        created_by=manga.created_by,
        created_at=manga.created_at,
        updated_at=manga.updated_at,
    )


def _get_chapter_neighbors(
    db: Session,
    manga_id: int,
    chapter_id: int,
) -> tuple[int | None, int | None]:
    ordered_ids = list(
        db.scalars(
            select(Chapter.id)
            .where(Chapter.manga_id == manga_id)
            .order_by(Chapter.chapter_number.asc(), Chapter.id.asc())
        ).all()
    )
    try:
        idx = ordered_ids.index(chapter_id)
    except ValueError:
        return None, None
    prev_id = ordered_ids[idx - 1] if idx > 0 else None
    next_id = ordered_ids[idx + 1] if idx + 1 < len(ordered_ids) else None
    return prev_id, next_id


def _build_chapter_out(
    chapter: Chapter,
    manga_title: str,
    prev_chapter_id: int | None,
    next_chapter_id: int | None,
) -> ChapterOut:
    return ChapterOut(
        id=chapter.id,
        manga_id=chapter.manga_id,
        manga_title=manga_title,
        chapter_number=chapter.chapter_number,
        title=chapter.title,
        content=chapter.content,
        created_at=chapter.created_at,
        prev_chapter_id=prev_chapter_id,
        next_chapter_id=next_chapter_id,
    )


@router.get("/stats", response_model=StatsOut)
def get_stats(db: Session = Depends(get_db)) -> StatsOut:
    total_mangas = db.scalar(select(func.count(Manga.id))) or 0
    total_chapters = db.scalar(select(func.count(Chapter.id))) or 0
    total_users = db.scalar(select(func.count(User.id))) or 0
    total_views = db.scalar(select(func.coalesce(func.sum(Manga.views), 0))) or 0
    genres = list(
        db.scalars(select(Manga.genre).distinct().order_by(Manga.genre.asc())).all()
    )
    return StatsOut(
        total_mangas=int(total_mangas),
        total_chapters=int(total_chapters),
        total_users=int(total_users),
        total_views=int(total_views),
        genres=genres,
    )


@router.get("/manga", response_model=list[MangaOut])
def list_manga(
    search: str = Query(default=""),
    genre: str = Query(default=""),
    status_filter: str = Query(default="", alias="status"),
    sort: str = Query(default="latest"),
    db: Session = Depends(get_db),
) -> list[MangaOut]:
    chapter_counts_subq = (
        select(
            Chapter.manga_id.label("manga_id"),
            func.count(Chapter.id).label("chapter_count"),
        )
        .group_by(Chapter.manga_id)
        .subquery()
    )

    stmt = select(
        Manga,
        func.coalesce(chapter_counts_subq.c.chapter_count, 0).label("chapter_count"),
    ).outerjoin(chapter_counts_subq, Manga.id == chapter_counts_subq.c.manga_id)

    search_term = search.strip()
    if search_term:
        pattern = f"%{search_term}%"
        stmt = stmt.where(
            or_(
                Manga.title.ilike(pattern),
                Manga.author.ilike(pattern),
                Manga.genre.ilike(pattern),
            )
        )

    genre_term = genre.strip()
    if genre_term and genre_term.lower() not in {"all", "tất cả"}:
        stmt = stmt.where(func.lower(Manga.genre) == genre_term.lower())

    status_term = status_filter.strip()
    if status_term and status_term.lower() not in {"all", "tất cả"}:
        stmt = stmt.where(Manga.status == status_term)

    sort_key = sort.strip().lower() or "latest"
    if sort_key == "views":
        stmt = stmt.order_by(Manga.views.desc(), Manga.id.desc())
    elif sort_key == "rating":
        stmt = stmt.order_by(Manga.rating.desc(), Manga.views.desc(), Manga.id.desc())
    elif sort_key == "title":
        stmt = stmt.order_by(Manga.title.asc(), Manga.id.asc())
    else:
        stmt = stmt.order_by(Manga.updated_at.desc(), Manga.id.desc())

    rows = db.execute(stmt).all()
    return [_build_manga_out(manga, int(chapter_count)) for manga, chapter_count in rows]


@router.get("/manga/{manga_id}", response_model=MangaDetailOut)
def get_manga_detail(manga_id: int, db: Session = Depends(get_db)) -> MangaDetailOut:
    update_result = db.execute(
        update(Manga)
        .where(Manga.id == manga_id)
        .values(views=Manga.views + 1)
    )
    if update_result.rowcount == 0:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Manga not found")
    db.commit()

    manga = db.scalar(
        select(Manga)
        .options(selectinload(Manga.chapters))
        .where(Manga.id == manga_id)
    )
    if manga is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Manga not found")

    ordered_chapters = sorted(
        manga.chapters,
        key=lambda ch: (ch.chapter_number, ch.id),
    )
    return MangaDetailOut(
        id=manga.id,
        title=manga.title,
        author=manga.author,
        genre=manga.genre,
        status=manga.status,
        cover_url=manga.cover_url,
        description=manga.description,
        rating=manga.rating,
        views=manga.views,
        chapter_count=len(ordered_chapters),
        created_by=manga.created_by,
        created_at=manga.created_at,
        updated_at=manga.updated_at,
        chapters=[ChapterSummaryOut.model_validate(ch) for ch in ordered_chapters],
    )


@router.post("/manga", response_model=MangaOut, status_code=status.HTTP_201_CREATED)
def create_manga(
    payload: MangaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MangaOut:
    manga = Manga(
        title=payload.title,
        author=payload.author,
        genre=payload.genre,
        status=payload.status,
        cover_url=payload.cover_url,
        description=payload.description,
        rating=payload.rating,
        views=0,
        created_by=current_user.id,
    )
    db.add(manga)
    db.commit()
    db.refresh(manga)
    return _build_manga_out(manga, 0)


@router.put("/manga/{manga_id}", response_model=MangaOut)
def update_manga(
    manga_id: int,
    payload: MangaUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> MangaOut:
    manga = db.scalar(select(Manga).where(Manga.id == manga_id))
    if manga is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Manga not found")

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if value is not None:
            setattr(manga, field, value)
    manga.updated_at = utc_now()

    db.commit()
    db.refresh(manga)
    chapter_count = db.scalar(
        select(func.count(Chapter.id)).where(Chapter.manga_id == manga.id)
    ) or 0
    return _build_manga_out(manga, int(chapter_count))


@router.delete("/manga/{manga_id}")
def delete_manga(
    manga_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    manga = db.scalar(select(Manga).where(Manga.id == manga_id))
    if manga is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Manga not found")

    db.delete(manga)
    db.commit()
    return {"message": "Manga deleted successfully"}


@router.get("/manga/{manga_id}/chapters", response_model=list[ChapterSummaryOut])
def list_chapters(manga_id: int, db: Session = Depends(get_db)) -> list[ChapterSummaryOut]:
    manga_exists = db.scalar(select(Manga.id).where(Manga.id == manga_id))
    if manga_exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Manga not found")

    chapters = db.scalars(
        select(Chapter)
        .where(Chapter.manga_id == manga_id)
        .order_by(Chapter.chapter_number.asc(), Chapter.id.asc())
    ).all()
    return [ChapterSummaryOut.model_validate(ch) for ch in chapters]


@router.post(
    "/manga/{manga_id}/chapters",
    response_model=ChapterOut,
    status_code=status.HTTP_201_CREATED,
)
def create_chapter(
    manga_id: int,
    payload: ChapterCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ChapterOut:
    manga = db.scalar(select(Manga).where(Manga.id == manga_id))
    if manga is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Manga not found")

    duplicate = db.scalar(
        select(Chapter.id).where(
            Chapter.manga_id == manga_id,
            Chapter.chapter_number == payload.chapter_number,
        )
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Chapter number already exists for this manga",
        )

    chapter = Chapter(
        manga_id=manga_id,
        chapter_number=payload.chapter_number,
        title=payload.title,
        content=payload.content,
    )
    manga.updated_at = utc_now()
    db.add(chapter)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Chapter number already exists for this manga",
        ) from None
    db.refresh(chapter)

    prev_id, next_id = _get_chapter_neighbors(db, manga_id, chapter.id)
    return _build_chapter_out(chapter, manga.title, prev_id, next_id)


@router.get("/chapters/{chapter_id}", response_model=ChapterOut)
def get_chapter_detail(chapter_id: int, db: Session = Depends(get_db)) -> ChapterOut:
    chapter = db.scalar(
        select(Chapter)
        .options(selectinload(Chapter.manga))
        .where(Chapter.id == chapter_id)
    )
    if chapter is None or chapter.manga is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found")

    prev_id, next_id = _get_chapter_neighbors(db, chapter.manga_id, chapter.id)
    return _build_chapter_out(chapter, chapter.manga.title, prev_id, next_id)


@router.delete("/chapters/{chapter_id}")
def delete_chapter(
    chapter_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    chapter = db.scalar(select(Chapter).where(Chapter.id == chapter_id))
    if chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found")

    db.delete(chapter)
    db.commit()
    return {"message": "Chapter deleted successfully"}
