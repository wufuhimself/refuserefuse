import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import uuid4

from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlmodel import select

from database import init_db, engine
from models import Report, User

from sqlmodel import Session

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24 * 7
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
bearer = HTTPBearer()


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
    notes: Optional[str] = None
    duration_minutes: Optional[int] = None
    created_at: datetime


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
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

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


async def save_upload(file: UploadFile) -> str:
    ext = os.path.splitext(file.filename or "")[1]
    filename = f"{uuid4().hex}{ext}"
    dest = os.path.join(UPLOAD_DIR, filename)
    with open(dest, "wb") as f:
        content = await file.read()
        f.write(content)
    return f"/uploads/{filename}"


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
