from contextlib import asynccontextmanager
import logging
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import ensure_upload_dirs, get_settings
from app.database import Base, SessionLocal, dispose_engine, get_db, get_engine
from app.routers import admin, auth, cart_orders, chatbot, profile, reader, store
from app.seed import seed_catalog

logger = logging.getLogger(__name__)


class DynamicCORSMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._cached_origins: tuple[str, ...] | None = None
        self._cors: CORSMiddleware | None = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        origins = tuple(get_settings().cors_origins)
        if self._cors is None or self._cached_origins != origins:
            self._cached_origins = origins
            self._cors = CORSMiddleware(
                self.app,
                allow_origins=list(origins),
                allow_credentials=True,
                allow_methods=["*"],
                allow_headers=["*"],
            )
        await self._cors(scope, receive, send)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_upload_dirs()
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_catalog(db)
    finally:
        db.close()

    try:
        yield
    finally:
        dispose_engine()


app = FastAPI(
    title="MangaStore VPS Full API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(DynamicCORSMiddleware)
app.include_router(auth.router)
app.include_router(store.router)
app.include_router(cart_orders.router)
app.include_router(profile.router)
app.include_router(reader.router)
app.include_router(admin.router)
app.include_router(chatbot.router)


@app.get("/uploads/{subpath:path}", include_in_schema=False)
def serve_uploaded_file(subpath: str) -> FileResponse:
    upload_root = Path(get_settings().upload_dir).resolve()
    target = (upload_root / subpath).resolve()
    if not target.is_relative_to(upload_root) or not target.is_file():
        raise HTTPException(status_code=404, detail="Tệp không tồn tại.")
    return FileResponse(target)


@app.get("/api/health", tags=["health"])
def health_check(db: Session = Depends(get_db)) -> JSONResponse:
    try:
        db.execute(text("SELECT 1"))
        return JSONResponse(status_code=200, content={"status": "ok", "db": "ok"})
    except SQLAlchemyError as exc:
        logger.error("Health check failed: %s", exc)
        return JSONResponse(status_code=503, content={"status": "error", "db": "unavailable"})
