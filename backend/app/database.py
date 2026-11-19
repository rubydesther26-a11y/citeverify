from contextlib import contextmanager
import threading
from typing import Generator
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from app.config import get_settings


class Base(DeclarativeBase):
    pass


_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None
_db_initialized: bool = False
_init_lock = threading.Lock()


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        settings = get_settings()
        db_url = settings.normalized_database_url
        if not db_url:
            raise RuntimeError(
                "DATABASE_URL environment variable is not set. "
                "Configure a hosted PostgreSQL connection string in DATABASE_URL."
            )
        _engine = create_engine(
            db_url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
            pool_recycle=300,
        )
        _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    if _SessionLocal is None:
        get_engine()
    assert _SessionLocal is not None
    return _SessionLocal


def init_db() -> None:
    global _db_initialized
    from app import models  # noqa: F401

    with _init_lock:
        engine = get_engine()
        Base.metadata.create_all(bind=engine)
        # Safe additive column migrations for existing PostgreSQL deployments
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE verification_documents "
                    "ADD COLUMN IF NOT EXISTS contradictory_count INTEGER NOT NULL DEFAULT 0"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE verification_documents "
                    "ADD COLUMN IF NOT EXISTS figure_count INTEGER NOT NULL DEFAULT 0"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE verification_documents "
                    "ADD COLUMN IF NOT EXISTS figure_mismatch_count INTEGER NOT NULL DEFAULT 0"
                )
            )
        _db_initialized = True


def ensure_db_initialized() -> None:
    if not _db_initialized:
        init_db()


def check_db_health() -> tuple[bool, str]:
    try:
        ensure_db_initialized()
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, "connected"
    except Exception as exc:
        return False, str(exc.__class__.__name__)


def get_db() -> Generator[Session, None, None]:
    ensure_db_initialized()
    session_factory = get_session_factory()
    db = session_factory()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    ensure_db_initialized()
    session_factory = get_session_factory()
    db = session_factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
