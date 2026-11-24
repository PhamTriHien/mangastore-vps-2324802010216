from datetime import datetime, timedelta, timezone
import hmac
import logging
import secrets
import threading
import time
from urllib.parse import urlencode
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
import httpx
import jwt
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import PasswordResetToken, Role, User, utc_now
from app.security import (
    create_user_session,
    ensure_utc,
    get_current_session_id,
    get_current_user,
    hash_password,
    log_user_activity,
    revoke_all_user_sessions,
    revoke_session,
    sha256_hex,
    verify_password,
)
from app.services import email_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

_MAX_VERIFY_ATTEMPTS = 5
_STATE_TTL_SECONDS = 600.0
_state_lock = threading.Lock()
_google_oauth_states: dict[str, float] = {}
_reset_verify_attempts: dict[str, int] = {}
_verified_reset_tokens: dict[str, tuple[str, float]] = {}


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    phone: str | None = None
    avatar_url: str | None = None
    role_id: int
    role: str
    status: str
    last_login_at: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    session_id: str
    user: UserOut


class RegisterRequest(BaseModel):
    username: str | None = Field(default=None, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    phone: str | None = Field(default=None, max_length=20)
    recaptcha_token: str | None = Field(default=None, max_length=4096)

    @field_validator("username")
    @classmethod
    def _clean_username(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if len(cleaned) < 3:
            raise ValueError("Tên đăng nhập phải có ít nhất 3 ký tự.")
        return cleaned

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()

    @field_validator("phone")
    @classmethod
    def _clean_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned[:20] or None


class LoginRequest(BaseModel):
    identifier: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)
    remember_me: bool = False

    @field_validator("identifier")
    @classmethod
    def _clean_identifier(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Vui lòng nhập tên đăng nhập hoặc email.")
        return cleaned


class GoogleCallbackRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=2048)
    state: str | None = Field(default=None, max_length=256)
    redirect_uri: str | None = Field(default=None, max_length=500)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class VerifyCodeRequest(BaseModel):
    email: EmailStr
    reset_token_id: str = Field(..., min_length=1, max_length=64)
    code: str = Field(..., min_length=1, max_length=12)

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()

    @field_validator("reset_token_id", "code")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Giá trị không được để trống.")
        return cleaned


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    reset_token_id: str = Field(..., min_length=1, max_length=64)
    new_password: str = Field(..., min_length=6, max_length=128)
    confirm_password: str = Field(..., min_length=6, max_length=128)
    verification_token: str | None = Field(default=None, max_length=2048)

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


def _extract_client_meta(request: Request) -> tuple[str | None, str | None]:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    ip = forwarded or (request.client.host if request.client else None)
    ua = request.headers.get("user-agent")
    return (ip or "")[:64] or None, (ua or "")[:400] or None


def _ensure_customer_role(db: Session) -> None:
    if db.scalar(select(Role.id).where(Role.id == 3)) is None:
        db.add(
            Role(
                id=3,
                code="khach_hang",
                display_name="Khách hàng",
                description="Thành viên mua truyện và đọc truyện trực tuyến",
                priority=10,
            )
        )
        db.flush()


def _username_exists(db: Session, candidate: str) -> bool:
    return (
        db.scalar(select(User.id).where(func.lower(User.username) == candidate.lower()))
        is not None
    )


def _resolve_unique_username(db: Session, desired_name: str | None, email: str) -> str:
    raw = (desired_name or "").strip()
    if not raw:
        raw = email.split("@", 1)[0].strip()
    if len(raw) < 3:
        raw = f"{raw or 'user'}_reader"
    base = raw[:50].strip() or "user"

    if not _username_exists(db, base):
        return base

    for suffix in range(1, 1000):
        suffix_str = f"_{suffix}"
        candidate = f"{base[: 50 - len(suffix_str)]}{suffix_str}"
        if not _username_exists(db, candidate):
            return candidate

    random_suffix = f"_{secrets.token_hex(3)}"
    return f"{base[: 50 - len(random_suffix)]}{random_suffix}"


def _verify_recaptcha_if_configured(token: str | None) -> None:
    secret_key = get_settings().recaptcha_secret_key.strip()
    if not secret_key:
        return

    cleaned_token = (token or "").strip()
    if not cleaned_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vui lòng hoàn tất xác minh bảo mật reCAPTCHA.",
        )

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                "https://www.google.com/recaptcha/api/siteverify",
                data={"secret": secret_key, "response": cleaned_token},
            )
        data = resp.json() if resp.is_success else {}
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("reCAPTCHA verification error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Không thể xác minh reCAPTCHA lúc này. Vui lòng thử lại.",
        ) from None

    if not isinstance(data, dict) or not data.get("success"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Xác minh bảo mật reCAPTCHA thất bại. Vui lòng thử lại.",
        )


def _prune_memory_stores(now_ts: float) -> None:
    expired_states = [k for k, exp in _google_oauth_states.items() if exp <= now_ts]
    for k in expired_states:
        _google_oauth_states.pop(k, None)

    expired_tokens = [k for k, (_, exp) in _verified_reset_tokens.items() if exp <= now_ts]
    for k in expired_tokens:
        _verified_reset_tokens.pop(k, None)
        _reset_verify_attempts.pop(k, None)


def _resolve_google_redirect_uri(override: str | None = None) -> str:
    settings = get_settings()
    if settings.google_redirect_uri.strip():
        return settings.google_redirect_uri.strip()
    if override and override.strip():
        return override.strip()
    return f"{settings.app_base_url.rstrip('/')}/auth/google/callback"


def _issue_reset_verification_token(reset_token_id: str, email: str, expires_at: datetime) -> str:
    settings = get_settings()
    payload = {
        "purpose": "password_reset",
        "tid": reset_token_id,
        "email": email,
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _check_reset_verified(
    reset_token_id: str,
    email: str,
    verification_token: str | None,
) -> bool:
    if verification_token and verification_token.strip():
        settings = get_settings()
        try:
            payload = jwt.decode(
                verification_token.strip(),
                settings.jwt_secret,
                algorithms=[settings.jwt_algorithm],
            )
            if (
                payload.get("purpose") == "password_reset"
                and payload.get("tid") == reset_token_id
                and str(payload.get("email") or "").lower() == email
            ):
                return True
        except jwt.InvalidTokenError:
            return False

    now_ts = time.time()
    with _state_lock:
        _prune_memory_stores(now_ts)
        entry = _verified_reset_tokens.get(reset_token_id)
        if not entry:
            return False
        stored_email, exp_ts = entry
        return stored_email == email and exp_ts > now_ts


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthResponse:
    _verify_recaptcha_if_configured(payload.recaptcha_token)

    normalized_email = payload.email
    existing_email = db.scalar(select(User.id).where(func.lower(User.email) == normalized_email))
    if existing_email is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email này đã được đăng ký.",
        )

    if payload.username is not None:
        if _username_exists(db, payload.username):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên đăng nhập này đã được sử dụng.",
            )
        final_username = payload.username
    else:
        final_username = _resolve_unique_username(db, None, normalized_email)

    _ensure_customer_role(db)

    user = User(
        username=final_username,
        email=normalized_email,
        password_hash=hash_password(payload.password),
        phone=payload.phone,
        role_id=3,
        role="khach_hang",
        status="hoat_dong",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tên đăng nhập hoặc email này đã được đăng ký.",
        ) from None
    db.refresh(user)

    ip, ua = _extract_client_meta(request)
    token, session_id = create_user_session(db, user, remember_me=False, ip_address=ip, user_agent=ua)
    log_user_activity(
        db,
        user.id,
        "register_password",
        f"Đăng ký tài khoản mới ({user.email})",
        request,
    )
    db.commit()
    db.refresh(user)

    return AuthResponse(
        access_token=token,
        token_type="bearer",
        session_id=session_id,
        user=UserOut.model_validate(user),
    )


@router.post("/login", response_model=AuthResponse)
def login(
    payload: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthResponse:
    identifier = payload.identifier
    user = db.scalar(
        select(User).where(
            or_(
                User.username == identifier,
                func.lower(User.email) == identifier.lower(),
            )
        )
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập, email hoặc mật khẩu không chính xác.",
        )

    if user.status != "hoat_dong":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản của bạn hiện đang bị khóa. Vui lòng liên hệ quản trị viên.",
        )

    ip, ua = _extract_client_meta(request)
    token, session_id = create_user_session(
        db,
        user,
        remember_me=payload.remember_me,
        ip_address=ip,
        user_agent=ua,
    )
    log_user_activity(
        db,
        user.id,
        "login_password",
        f"Đăng nhập bằng tài khoản ({user.email})",
        request,
    )
    db.commit()
    db.refresh(user)

    return AuthResponse(
        access_token=token,
        token_type="bearer",
        session_id=session_id,
        user=UserOut.model_validate(user),
    )


@router.post("/logout")
def logout(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    session_id: str | None = Depends(get_current_session_id),
) -> dict[str, bool]:
    revoke_session(db, session_id)
    log_user_activity(db, current_user.id, "logout", "Đăng xuất tài khoản", request)
    db.commit()
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current_user)


@router.get("/google-url")
def get_google_oauth_url() -> dict[str, object]:
    settings = get_settings()
    client_id = settings.google_client_id.strip()
    client_secret = settings.google_client_secret.strip()
    if not client_id or not client_secret:
        return {"configured": False, "url": ""}

    redirect_uri = _resolve_google_redirect_uri()
    state = secrets.token_hex(32)
    now_ts = time.time()
    with _state_lock:
        _prune_memory_stores(now_ts)
        _google_oauth_states[state] = now_ts + _STATE_TTL_SECONDS

    query = urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": "openid email profile",
            "state": state,
            "prompt": "select_account",
        }
    )
    return {
        "configured": True,
        "url": f"https://accounts.google.com/o/oauth2/v2/auth?{query}",
        "state": state,
    }


@router.post("/google-callback", response_model=AuthResponse)
def google_callback(
    payload: GoogleCallbackRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthResponse:
    settings = get_settings()
    client_id = settings.google_client_id.strip()
    client_secret = settings.google_client_secret.strip()
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Đăng nhập bằng Google chưa được cấu hình trên máy chủ.",
        )

    provided_state = (payload.state or "").strip()
    now_ts = time.time()
    with _state_lock:
        _prune_memory_stores(now_ts)
        expected_exp = _google_oauth_states.pop(provided_state, None) if provided_state else None
    if expected_exp is None or expected_exp <= now_ts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.",
        )

    redirect_uri = _resolve_google_redirect_uri(payload.redirect_uri)
    try:
        with httpx.Client(timeout=15.0) as client:
            token_resp = client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": payload.code.strip(),
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
                headers={"Accept": "application/json"},
            )
            if not token_resp.is_success:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Không thể trao đổi mã xác thực Google. Vui lòng thử lại.",
                )
            token_data = token_resp.json()
            google_access_token = str(token_data.get("access_token") or "").strip()
            if not google_access_token:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Không nhận được access token từ Google.",
                )

            profile_resp = client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={
                    "Authorization": f"Bearer {google_access_token}",
                    "Accept": "application/json",
                },
            )
            if not profile_resp.is_success:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Không thể lấy thông tin hồ sơ từ Google.",
                )
            profile = profile_resp.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Google OAuth exchange failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Có lỗi khi kết nối tới Google. Vui lòng thử lại.",
        ) from None

    email = str(profile.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Không lấy được địa chỉ email từ Google.",
        )

    display_name = str(profile.get("name") or profile.get("given_name") or "").strip()
    picture = str(profile.get("picture") or "").strip()[:500] or None

    user = db.scalar(select(User).where(func.lower(User.email) == email))
    is_new_user = False
    if user is not None:
        if user.status != "hoat_dong":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tài khoản của bạn hiện đang bị khóa. Vui lòng liên hệ quản trị viên.",
            )
        if not user.avatar_url and picture:
            user.avatar_url = picture
    else:
        _ensure_customer_role(db)
        unique_username = _resolve_unique_username(db, display_name, email)
        user = User(
            username=unique_username,
            email=email,
            password_hash=hash_password(secrets.token_urlsafe(24)),
            avatar_url=picture,
            role_id=3,
            role="khach_hang",
            status="hoat_dong",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        is_new_user = True

    ip, ua = _extract_client_meta(request)
    token, session_id = create_user_session(db, user, remember_me=True, ip_address=ip, user_agent=ua)
    log_user_activity(
        db,
        user.id,
        "register_google" if is_new_user else "login_google",
        f"Đăng nhập Google ({user.email})",
        request,
    )
    db.commit()
    db.refresh(user)

    return AuthResponse(
        access_token=token,
        token_type="bearer",
        session_id=session_id,
        user=UserOut.model_validate(user),
    )


@router.post("/forgot-password")
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    user = db.scalar(
        select(User).where(
            func.lower(User.email) == payload.email,
            User.status == "hoat_dong",
        )
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email không tồn tại trong hệ thống hoặc tài khoản đang bị khóa.",
        )

    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id, PasswordResetToken.is_used.is_(False))
        .values(is_used=True)
    )

    otp_code = f"{100000 + secrets.randbelow(900000):06d}"
    reset_token_id = str(uuid.uuid4())
    now = utc_now()
    ip, _ = _extract_client_meta(request)

    reset_record = PasswordResetToken(
        id=reset_token_id,
        user_id=user.id,
        otp_hash=sha256_hex(otp_code),
        expires_at=now + timedelta(minutes=10),
        is_used=False,
        ip_address=ip,
    )
    db.add(reset_record)
    db.commit()

    sent = email_service.send_verification_code(user.email, otp_code)
    if not sent:
        reset_record.is_used = True
        db.commit()
        settings = get_settings()
        if not settings.smtp_email.strip() or not settings.smtp_password.strip():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Máy chủ chưa cấu hình SMTP email (SMTP_EMAIL / SMTP_PASSWORD), không thể gửi mã xác nhận.",
            )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Không thể gửi mã xác nhận qua email lúc này. Vui lòng thử lại sau.",
        )

    with _state_lock:
        _reset_verify_attempts[reset_token_id] = 0

    return {
        "ok": True,
        "message": "Mã xác nhận 6 chữ số đã được gửi tới email của bạn.",
        "reset_token_id": reset_token_id,
    }


@router.post("/verify-code")
def verify_code(
    payload: VerifyCodeRequest,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    row = db.execute(
        select(PasswordResetToken, User)
        .join(User, PasswordResetToken.user_id == User.id)
        .where(
            PasswordResetToken.id == payload.reset_token_id,
            func.lower(User.email) == payload.email,
            User.status == "hoat_dong",
        )
    ).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Yêu cầu đặt lại mật khẩu không hợp lệ.",
        )

    reset_token, _user = row

    with _state_lock:
        attempts = _reset_verify_attempts.get(payload.reset_token_id, 0)
        if attempts >= _MAX_VERIFY_ATTEMPTS:
            reset_token.is_used = True
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Bạn đã nhập sai quá 5 lần. Vui lòng yêu cầu mã xác thực mới.",
            )

    if reset_token.is_used or ensure_utc(reset_token.expires_at) <= datetime.now(timezone.utc):
        reset_token.is_used = True
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mã xác thực đã hết hạn hoặc đã được sử dụng. Vui lòng yêu cầu mã mới.",
        )

    provided_hash = sha256_hex(payload.code)
    if not hmac.compare_digest(reset_token.otp_hash, provided_hash):
        with _state_lock:
            attempts = _reset_verify_attempts.get(payload.reset_token_id, 0) + 1
            _reset_verify_attempts[payload.reset_token_id] = attempts
        if attempts >= _MAX_VERIFY_ATTEMPTS:
            reset_token.is_used = True
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Bạn đã nhập sai quá 5 lần. Vui lòng yêu cầu mã xác thực mới.",
            )
        remaining = _MAX_VERIFY_ATTEMPTS - attempts
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Mã xác thực không đúng (còn {remaining} lần thử).",
        )

    expires_at = ensure_utc(reset_token.expires_at)
    verification_token = _issue_reset_verification_token(
        payload.reset_token_id,
        payload.email,
        expires_at,
    )
    with _state_lock:
        _reset_verify_attempts.pop(payload.reset_token_id, None)
        _verified_reset_tokens[payload.reset_token_id] = (
            payload.email,
            expires_at.timestamp(),
        )

    return {"ok": True, "verification_token": verification_token}


@router.post("/reset-password")
def reset_password(
    payload: ResetPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    if len(payload.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mật khẩu mới phải có ít nhất 6 ký tự.",
        )
    if payload.new_password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mật khẩu xác nhận không khớp.",
        )

    if not _check_reset_verified(
        payload.reset_token_id,
        payload.email,
        payload.verification_token,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mã xác nhận chưa được kiểm chứng hoặc đã hết hạn. Vui lòng xác minh lại OTP.",
        )

    row = db.execute(
        select(PasswordResetToken, User)
        .join(User, PasswordResetToken.user_id == User.id)
        .where(
            PasswordResetToken.id == payload.reset_token_id,
            func.lower(User.email) == payload.email,
            User.status == "hoat_dong",
            PasswordResetToken.is_used.is_(False),
        )
    ).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phiên đặt lại mật khẩu đã hết hạn hoặc không hợp lệ.",
        )

    reset_token, user = row
    if ensure_utc(reset_token.expires_at) <= datetime.now(timezone.utc):
        reset_token.is_used = True
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mã đặt lại mật khẩu đã hết hạn. Vui lòng yêu cầu mã mới.",
        )

    user.password_hash = hash_password(payload.new_password)
    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id, PasswordResetToken.is_used.is_(False))
        .values(is_used=True)
    )
    log_user_activity(db, user.id, "reset_password", "Đặt lại mật khẩu qua OTP email", request)
    revoke_all_user_sessions(db, user.id)

    with _state_lock:
        _verified_reset_tokens.pop(payload.reset_token_id, None)
        _reset_verify_attempts.pop(payload.reset_token_id, None)

    return {"ok": True}
