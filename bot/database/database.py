"""
Async Database engine and session manager for TeleGroup Bot.
Works with PostgreSQL (asyncpg) or SQLite (aiosqlite).
"""

import logging
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine
)
from bot.config import get_settings
from bot.database.models import Base

logger = logging.getLogger(__name__)

settings = get_settings()

# Normalize database URL
db_url = settings.database_url
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif db_url.startswith("postgresql://") and "+asyncpg" not in db_url:
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
elif db_url.startswith("sqlite:///") and "+aiosqlite" not in db_url:
    db_url = db_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)

# Engine arguments
engine_kwargs = {
    "echo": False,
    "future": True,
}

if "sqlite" not in db_url:
    engine_kwargs.update({
        "pool_size": 10,
        "max_overflow": 20,
        "pool_pre_ping": True,
        "pool_recycle": 1800,
    })

engine = create_async_engine(db_url, **engine_kwargs)

async_session = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)


async def init_db() -> None:
    """Initialize database tables."""
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database schema verified and initialized.")
    except Exception as e:
        logger.error(f"Database initialization error: {e}", exc_info=True)
        raise


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency / generator providing an async database session."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
