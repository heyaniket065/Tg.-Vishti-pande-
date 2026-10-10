"""
Configuration settings for TeleGroup Management Bot.
Reads securely from environment variables / .env file.
"""

from typing import List, Optional
import os
from pydantic_settings import BaseSettings
from pydantic import Field, field_validator


class Settings(BaseSettings):
    # Telegram Bot Token from @BotFather (e.g. 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)
    bot_token: str = Field(default="", alias="TELEGRAM_BOT_TOKEN")

    # Database URL: PostgreSQL in production, SQLite in local development
    # Examples:
    #   postgresql+asyncpg://user:pass@localhost:5432/telegroup_bot
    #   sqlite+aiosqlite:///./telegroup.db
    database_url: str = Field(
        default="sqlite+aiosqlite:///./telegroup.db",
        alias="DATABASE_URL"
    )

    # Master bot administrators (Telegram User IDs)
    admin_ids_raw: str = Field(default="", alias="BOT_ADMIN_IDS")

    # Default moderation thresholds
    default_warn_limit: int = 3
    default_warn_action: str = "mute"  # mute, kick, ban
    default_mute_duration_minutes: int = 60

    # Welcome system defaults
    default_welcome_delete_seconds: int = 60

    # Connection code expiry in minutes
    link_code_expiry_minutes: int = 10

    # Logging level
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    @property
    def admin_ids(self) -> List[int]:
        if not self.admin_ids_raw:
            return []
        ids = []
        for item in self.admin_ids_raw.split(","):
            cleaned = item.strip()
            if cleaned.isdigit():
                ids.append(int(cleaned))
        return ids

    @property
    def is_sqlite(self) -> bool:
        return "sqlite" in self.database_url.lower()

    @field_validator("bot_token")
    @classmethod
    def validate_token_format(cls, v: str) -> str:
        cleaned = v.strip()
        # Allow empty during early config validation in dev, but warn when running
        return cleaned

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


# Cached singleton instance
_settings: Optional[Settings] = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
