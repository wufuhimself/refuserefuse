from typing import Optional
from sqlmodel import SQLModel, Field
from datetime import datetime, timezone


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Report(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[str] = None
    picked_up_by_user_id: Optional[str] = None
    picked_up_at: Optional[datetime] = None
    lat: float
    lng: float
    severity: str = "light"
    photo_path: Optional[str] = None
    picked_up: bool = False
    notes: Optional[str] = None
    duration_minutes: Optional[int] = None
    created_at: datetime = Field(default_factory=_utcnow)
    deleted_at: Optional[datetime] = None


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    display_name: Optional[str] = None
    password_hash: str
    auth_provider: Optional[str] = Field(default=None, index=True)
    auth_subject: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_utcnow)
