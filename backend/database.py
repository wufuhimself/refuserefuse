from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import text

DATABASE_URL = "sqlite:///./dev.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def _ensure_schema_compatibility() -> None:
    with engine.begin() as conn:
        cols = conn.execute(text("PRAGMA table_info(report)")).all()
        col_names = {row[1] for row in cols}
        if "picked_up_by_user_id" not in col_names:
            conn.execute(text("ALTER TABLE report ADD COLUMN picked_up_by_user_id VARCHAR"))
        if "deleted_at" not in col_names:
            conn.execute(text("ALTER TABLE report ADD COLUMN deleted_at DATETIME"))


def init_db():
    SQLModel.metadata.create_all(engine)
    _ensure_schema_compatibility()


def get_session():
    with Session(engine) as session:
        yield session
