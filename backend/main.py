import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from urllib.error import URLError

from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError
import jwt as pyjwt
from jwt import PyJWKClient
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlmodel import select

from database import init_db, engine
from models import Report, User
from storage import LocalStorageBackend, create_storage_backend

from sqlmodel import Session

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24 * 7
GOOGLE_CLIENT_IDS = [cid.strip() for cid in os.getenv("GOOGLE_CLIENT_IDS", "").split(",") if cid.strip()]
APPLE_AUDIENCES = [aud.strip() for aud in os.getenv("APPLE_AUDIENCES", "").split(",") if aud.strip()]
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
bearer = HTTPBearer()
google_jwks_client = PyJWKClient("https://www.googleapis.com/oauth2/v3/certs")
apple_jwks_client = PyJWKClient("https://appleid.apple.com/auth/keys")


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class OAuthLoginRequest(BaseModel):
    id_token: str
    display_name: Optional[str] = None


class UserPublic(BaseModel):
    id: int
    email: str
    display_name: Optional[str] = None


class ReportPublic(BaseModel):
    id: int
    user_id: Optional[str] = None
    picked_up_by_user_id: Optional[str] = None
    reporter_display_name: Optional[str] = None
    picked_up_by_display_name: Optional[str] = None
    lat: float
    lng: float
    severity: str
    photo_path: Optional[str] = None
    picked_up: bool
    picked_up_at: Optional[datetime] = None
    notes: Optional[str] = None
    duration_minutes: Optional[int] = None
    created_at: datetime


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    return pwd_context.verify(password, password_hash)


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "exp": now + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS),
        "iat": now,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _choose_display_name(explicit_name: Optional[str], fallback_name: Optional[str], fallback_email: Optional[str]) -> Optional[str]:
    if explicit_name and explicit_name.strip():
        return explicit_name.strip()
    if fallback_name and fallback_name.strip():
        return fallback_name.strip()
    if fallback_email:
        return fallback_email.split("@")[0]
    return None


def _find_or_create_oauth_user(
    session: Session,
    *,
    provider: str,
    subject: str,
    email: Optional[str],
    display_name: Optional[str],
) -> User:
    """
    Find or create an OAuth-linked user.
    
    Rules:
    1. If (provider, subject) already linked: update display_name if needed and return.
    2. If email exists but has a DIFFERENT provider linked: reject (409 Conflict).
    3. If email exists with NO provider linked: link the new provider to it.
    4. Otherwise: create a new account.
    """
    linked_user = session.exec(
        select(User).where(User.auth_provider == provider, User.auth_subject == subject)
    ).first()
    if linked_user:
        if display_name and linked_user.display_name != display_name:
            linked_user.display_name = display_name
            session.add(linked_user)
            session.commit()
            session.refresh(linked_user)
        return linked_user

    user = None
    if email:
        user = session.exec(select(User).where(User.email == email)).first()

    if user:
        if user.auth_provider and user.auth_provider != provider:
            raise HTTPException(
                status_code=409,
                detail=f"This email is already linked to {user.auth_provider}. "
                       f"To use a different provider, create a separate account with a different email.",
            )
        if not user.auth_provider:
            user.auth_provider = provider
        if not user.auth_subject:
            user.auth_subject = subject
        if display_name and not user.display_name:
            user.display_name = display_name
        session.add(user)
        session.commit()
        session.refresh(user)
        return user

    stable_email = email or f"{provider}-{subject}@noemail.refuserefuse.local"
    fresh_user = User(
        email=stable_email,
        display_name=display_name,
        password_hash=hash_password(f"oauth::{provider}::{subject}"),
        auth_provider=provider,
        auth_subject=subject,
    )
    session.add(fresh_user)
    session.commit()
    session.refresh(fresh_user)
    return fresh_user


def _verify_google_id_token(id_token: str) -> dict:
    if not GOOGLE_CLIENT_IDS:
        raise HTTPException(status_code=500, detail="Google auth is not configured on the server")

    try:
        signing_key = google_jwks_client.get_signing_key_from_jwt(id_token)
        payload = pyjwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=GOOGLE_CLIENT_IDS,
            issuer=["accounts.google.com", "https://accounts.google.com"],
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid Google token") from exc

    if not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Google token missing subject")
    if not payload.get("email"):
        raise HTTPException(status_code=401, detail="Google account has no email")
    if payload.get("email_verified") is not True:
        raise HTTPException(status_code=401, detail="Google email is not verified")

    return payload


def _verify_apple_id_token(id_token: str) -> dict:
    if not APPLE_AUDIENCES:
        raise HTTPException(status_code=500, detail="Apple auth is not configured on the server")

    try:
        signing_key = apple_jwks_client.get_signing_key_from_jwt(id_token)
        payload = pyjwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=APPLE_AUDIENCES,
            issuer="https://appleid.apple.com",
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid Apple token") from exc

    if not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Apple token missing subject")

    return payload


def _resolve_user_label(session: Session, user_id: Optional[str]) -> Optional[str]:
    if not user_id:
        return None
    try:
        uid = int(user_id)
    except ValueError:
        return None

    found = session.get(User, uid)
    if not found:
        return None
    return found.display_name or found.email


def _serialize_report(session: Session, report: Report) -> ReportPublic:
    return ReportPublic(
        id=report.id,
        user_id=report.user_id,
        picked_up_by_user_id=report.picked_up_by_user_id,
        reporter_display_name=_resolve_user_label(session, report.user_id),
        picked_up_by_display_name=_resolve_user_label(session, report.picked_up_by_user_id),
        lat=report.lat,
        lng=report.lng,
        severity=report.severity,
        photo_path=report.photo_path,
        picked_up=report.picked_up,
        picked_up_at=report.picked_up_at,
        notes=report.notes,
        duration_minutes=report.duration_minutes,
        created_at=report.created_at,
    )


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    with Session(engine) as session:
        user = session.get(User, int(user_id))
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

storage_backend = create_storage_backend(base_dir=os.path.dirname(__file__))
if isinstance(storage_backend, LocalStorageBackend):
    app.mount("/uploads", StaticFiles(directory=storage_backend.upload_dir), name="uploads")

async def save_upload(file: UploadFile) -> str:
    return await storage_backend.save_upload(file)


@app.post("/auth/register", response_model=AuthResponse)
def register(payload: RegisterRequest):
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    with Session(engine) as session:
        existing = session.exec(select(User).where(User.email == payload.email)).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")

        user = User(
            email=payload.email,
            display_name=payload.display_name,
            password_hash=hash_password(payload.password),
        )
        session.add(user)
        session.commit()
        session.refresh(user)

    token = create_access_token(user)
    return AuthResponse(access_token=token)


@app.post("/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest):
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == payload.email)).first()
        if not user or not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(user)
    return AuthResponse(access_token=token)


@app.post("/auth/oauth/google", response_model=AuthResponse)
def oauth_google(payload: OAuthLoginRequest):
    verified = _verify_google_id_token(payload.id_token)
    email = verified.get("email")
    display_name = _choose_display_name(payload.display_name, verified.get("name"), email)

    with Session(engine) as session:
        user = _find_or_create_oauth_user(
            session,
            provider="google",
            subject=str(verified["sub"]),
            email=email,
            display_name=display_name,
        )

    token = create_access_token(user)
    return AuthResponse(access_token=token)


@app.post("/auth/oauth/apple", response_model=AuthResponse)
def oauth_apple(payload: OAuthLoginRequest):
    verified = _verify_apple_id_token(payload.id_token)
    email = verified.get("email")
    display_name = _choose_display_name(payload.display_name, None, email)

    with Session(engine) as session:
        user = _find_or_create_oauth_user(
            session,
            provider="apple",
            subject=str(verified["sub"]),
            email=email,
            display_name=display_name,
        )

    token = create_access_token(user)
    return AuthResponse(access_token=token)


@app.get("/auth/me", response_model=UserPublic)
def auth_me(user: User = Depends(get_current_user)):
    return UserPublic(id=user.id, email=user.email, display_name=user.display_name)


@app.get("/reports", response_model=List[ReportPublic])
def list_reports():
    with Session(engine) as session:
        results = session.exec(
            select(Report)
            .where(Report.deleted_at == None)
            .order_by(Report.created_at.desc())
        ).all()
        return [_serialize_report(session, r) for r in results]


@app.patch("/reports/{report_id}", response_model=ReportPublic)
def update_report(
    report_id: int,
    picked_up: bool = Form(...),
    user: User = Depends(get_current_user),
):
    with Session(engine) as session:
        report = session.get(Report, report_id)
        if not report or report.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Report not found")
        report.picked_up = picked_up
        report.picked_up_by_user_id = str(user.id) if picked_up else None
        report.picked_up_at = datetime.now(timezone.utc) if picked_up else None
        session.add(report)
        session.commit()
        session.refresh(report)
        return _serialize_report(session, report)


@app.patch("/reports/{report_id}/photo", response_model=ReportPublic)
async def update_report_photo(
    report_id: int,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    with Session(engine) as session:
        report = session.get(Report, report_id)
        if not report or report.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Report not found")
        if report.user_id != str(user.id):
            raise HTTPException(status_code=403, detail="Only the original reporter can add a photo")

        report.photo_path = await save_upload(file)
        session.add(report)
        session.commit()
        session.refresh(report)
        return _serialize_report(session, report)


@app.delete("/reports/{report_id}")
def delete_report(
    report_id: int,
    user: User = Depends(get_current_user),
):
    with Session(engine) as session:
        report = session.get(Report, report_id)
        if not report or report.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Report not found")
        if report.user_id != str(user.id):
            raise HTTPException(status_code=403, detail="Only the original reporter can delete this report")

        report.deleted_at = datetime.now(timezone.utc)
        session.add(report)
        session.commit()
        return {"ok": True, "soft_deleted": True}


@app.post("/reports", response_model=ReportPublic)
async def create_report(
    lat: float = Form(...),
    lng: float = Form(...),
    severity: str = Form("light"),
    notes: str = Form(None),
    picked_up: bool = Form(False),
    duration_minutes: int = Form(None),
    file: UploadFile = File(None),
    user: User = Depends(get_current_user),
):
    photo_path = await save_upload(file) if file else None

    report = Report(
        lat=lat,
        lng=lng,
        severity=severity,
        notes=notes,
        picked_up=picked_up,
        picked_up_at=datetime.now(timezone.utc) if picked_up else None,
        duration_minutes=duration_minutes,
        photo_path=photo_path,
        user_id=str(user.id),
        picked_up_by_user_id=str(user.id) if picked_up else None,
    )
    with Session(engine) as session:
        session.add(report)
        session.commit()
        session.refresh(report)
        return _serialize_report(session, report)
