from datetime import datetime, timedelta, timezone
import hashlib
import secrets

import bcrypt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import User, UserActivity, UserSession

_bearer_scheme = HTTPBearer(auto_error=False)


def ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    password_bytes = password.encode("utf-8")[:72]
    hashed = bcrypt.hashpw(password_bytes, bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    if not password_hash or not password_hash.startswith("$2"):
        return False
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8")[:72],
            password_hash.encode("utf-8"),
        )
    except (ValueError, TypeError):
        return False


def create_access_token(
    user_id: int,
    role_id: int = 3,
    session_id: str | None = None,
    expire_minutes: int | None = None,
) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    ttl = expire_minutes if expire_minutes and expire_minutes > 0 else settings.jwt_expire_minutes
    payload: dict[str, object] = {
        "sub": str(user_id),
        "role_id": role_id,
        "iat": now,
        "exp": now + timedelta(minutes=ttl),
    }
    if session_id:
        payload["sid"] = session_id
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token_payload(token: str) -> dict[str, object] | None:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
        subject = payload.get("sub")
        if subject is None:
            return None
        int(subject)
        return payload
    except (jwt.InvalidTokenError, TypeError, ValueError):
        return None


def decode_access_token(token: str) -> int | None:
    payload = decode_access_token_payload(token)
    if payload is None:
        return None
    return int(str(payload["sub"]))


def create_user_session(
    db: Session,
    user: User,
    remember_me: bool = False,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    ttl_minutes = 30 * 24 * 60 if remember_me else max(120, get_settings().jwt_expire_minutes)
    expires_at = now + timedelta(minutes=ttl_minutes)
    session_id = secrets.token_hex(24)
    token = create_access_token(
        user_id=user.id,
        role_id=user.role_id,
        session_id=session_id,
        expire_minutes=ttl_minutes,
    )
    db_session = UserSession(
        session_id=session_id,
        user_id=user.id,
        token_hash=sha256_hex(token),
        is_persistent=remember_me,
        ip_address=(ip_address or "")[:64] or None,
        user_agent=(user_agent or "")[:400] or None,
        created_at=now,
        expires_at=expires_at,
    )
    db.add(db_session)
    user.last_login_at = now
    db.commit()
    return token, session_id


def revoke_session(db: Session, session_id: str | None) -> None:
    if not session_id:
        return
    db.execute(delete(UserSession).where(UserSession.session_id == session_id))
    db.commit()


def revoke_all_user_sessions(
    db: Session, user_id: int, except_session_id: str | None = None
) -> None:
    stmt = delete(UserSession).where(UserSession.user_id == user_id)
    if except_session_id:
        stmt = stmt.where(UserSession.session_id != except_session_id)
    db.execute(stmt)
    db.commit()


def log_user_activity(
    db: Session,
    user_id: int,
    activity_type: str,
    content: str | None = None,
    request: Request | None = None,
) -> None:
    ip = None
    ua = None
    if request is not None:
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        ip = forwarded or (request.client.host if request.client else None)
        ua = request.headers.get("user-agent")
    db.add(
        UserActivity(
            user_id=user_id,
            activity_type=activity_type[:100],
            content=content,
            ip_address=(ip or "")[:64] or None,
            user_agent=(ua or "")[:400] or None,
        )
    )


def _resolve_user_from_credentials(
    credentials: HTTPAuthorizationCredentials | None,
    db: Session,
) -> tuple[User | None, str | None]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        return None, None
    payload = decode_access_token_payload(credentials.credentials)
    if payload is None:
        return None, None
    user_id = int(str(payload["sub"]))
    sid = str(payload["sid"]) if payload.get("sid") else None

    user = db.scalar(select(User).where(User.id == user_id))
    if user is None or user.status != "hoat_dong":
        return None, None

    if sid is not None:
        sess = db.scalar(
            select(UserSession).where(
                UserSession.session_id == sid,
                UserSession.user_id == user_id,
            )
        )
        if sess is None or ensure_utc(sess.expires_at) <= datetime.now(timezone.utc):
            return None, None

    return user, sid


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    user, _ = _resolve_user_from_credentials(credentials, db)
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    user, _ = _resolve_user_from_credentials(credentials, db)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phiên đăng nhập không hợp lệ hoặc đã hết hạn.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_current_session_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> str | None:
    _, sid = _resolve_user_from_credentials(credentials, db)
    return sid


def require_staff(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role_id not in (1, 2):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền truy cập khu vực quản trị.",
        )
    return current_user


def require_full_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role_id != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ Quản trị viên cấp cao mới có quyền thực hiện thao tác này.",
        )
    return current_user
