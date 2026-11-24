from collections.abc import Generator
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


SessionLocal = sessionmaker(autocommit=False, autoflush=False, expire_on_commit=False)

_engine: Engine | None = None
_engine_url: str | None = None


def create_db_engine(database_url: str) -> Engine:
    if database_url.startswith("sqlite"):
        engine = create_engine(
            database_url,
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(engine, "connect")
        def _set_sqlite_pragma(dbapi_connection: Any, _connection_record: Any) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        return engine

    return create_engine(database_url, pool_pre_ping=True)


def get_engine() -> Engine:
    global _engine, _engine_url
    settings = get_settings()
    if _engine is None or _engine_url != settings.database_url:
        if _engine is not None:
            _engine.dispose()
        _engine = create_db_engine(settings.database_url)
        _engine_url = settings.database_url
        SessionLocal.configure(bind=_engine)
    return _engine


def dispose_engine() -> None:
    global _engine, _engine_url
    if _engine is not None:
        _engine.dispose()
        _engine = None
        _engine_url = None
        SessionLocal.configure(bind=None)


def get_db() -> Generator[Session, None, None]:
    get_engine()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def __getattr__(name: str) -> Any:
    if name == "engine":
        return get_engine()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
