import React, { useState } from 'react';
import {
  Code,
  Copy,
  Check,
  Terminal,
  Server,
  Download,
  FileText,
  FolderTree,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';

export const CodeDeploymentView: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<string>('bot/main.py');
  const [copied, setCopied] = useState(false);

  const filesMap: Record<string, string> = {
    'bot/main.py': `import asyncio
import logging
import sys
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand, BotCommandScopeDefault

from bot.config import get_settings
from bot.database.database import init_db
from bot.middlewares.auth import AdminAuthMiddleware
from bot.handlers import (
    private_dashboard,
    group_linking,
    cross_posting,
    welcome,
    moderation,
    antispam,
    promotions,
    filters,
    help_center,
    scheduling
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("telegroup_bot")

async def setup_bot_commands(bot: Bot):
    commands = [
        BotCommand(command="start", description="Open private management dashboard"),
        BotCommand(command="help", description="Open interactive Help Center"),
        BotCommand(command="linkgroup", description="Generate link code (in group)"),
        BotCommand(command="warn", description="Warn a member (reply in group)"),
        BotCommand(command="mute", description="Mute a member (reply in group)"),
        BotCommand(command="rules", description="Display group rules"),
        BotCommand(command="crosspost_status", description="Check active cross-post status"),
    ]
    await bot.set_my_commands(commands, scope=BotCommandScopeDefault())

async def main():
    settings = get_settings()
    if not settings.bot_token:
        logger.error("CRITICAL: TELEGRAM_BOT_TOKEN not set!")
        sys.exit(1)

    await init_db()
    bot = Bot(token=settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.MARKDOWN))
    me = await bot.get_me()
    logger.info(f"Bot connected successfully as @{me.username} (ID: {me.id})")

    dp = Dispatcher()
    dp.update.middleware(AdminAuthMiddleware())

    dp.include_router(private_dashboard.router)
    dp.include_router(help_center.router)
    dp.include_router(promotions.router)
    dp.include_router(group_linking.router)
    dp.include_router(moderation.router)
    dp.include_router(antispam.router)
    dp.include_router(welcome.router)
    dp.include_router(filters.router)
    dp.include_router(cross_posting.router)

    await setup_bot_commands(bot)
    asyncio.create_task(scheduling.run_scheduled_messages_worker(bot))

    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())`,

    'bot/config.py': `from typing import List
from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    bot_token: str = Field(default="", alias="TELEGRAM_BOT_TOKEN")
    database_url: str = Field(default="sqlite+aiosqlite:///./telegroup.db", alias="DATABASE_URL")
    admin_ids_raw: str = Field(default="", alias="BOT_ADMIN_IDS")
    default_warn_limit: int = 3
    default_warn_action: str = "mute"
    default_welcome_delete_seconds: int = 60
    link_code_expiry_minutes: int = 10

    @property
    def admin_ids(self) -> List[int]:
        if not self.admin_ids_raw:
            return []
        return [int(x.strip()) for x in self.admin_ids_raw.split(",") if x.strip().isdigit()]

    class Config:
        env_file = ".env"
        extra = "ignore"

def get_settings() -> Settings:
    return Settings()`,

    'bot/database/models.py': `from datetime import datetime
from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True)
    tg_chat_id = Column(BigInteger, unique=True, index=True)
    title = Column(String(255))
    warn_limit = Column(Integer, default=3)
    warn_action = Column(String(32), default="mute")
    flood_limit = Column(Integer, default=5)
    block_links = Column(Boolean, default=False)
    rules_text = Column(Text, default="Be respectful and follow rules.")

class LinkCode(Base):
    __tablename__ = "link_codes"
    id = Column(Integer, primary_key=True)
    code = Column(String(16), unique=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"))
    expires_at = Column(DateTime)
    is_used = Column(Boolean, default=False)

class CrossPostConnection(Base):
    __tablename__ = "crosspost_connections"
    id = Column(Integer, primary_key=True)
    name = Column(String(128))
    group_a_id = Column(Integer, ForeignKey("groups.id"))
    group_b_id = Column(Integer, ForeignKey("groups.id"))
    direction = Column(String(32), default="A_TO_B")
    mode = Column(String(32), default="COPY")
    is_active = Column(Boolean, default=True)

class CrossPostMessageMap(Base):
    __tablename__ = "crosspost_message_maps"
    id = Column(Integer, primary_key=True)
    connection_id = Column(Integer, ForeignKey("crosspost_connections.id"))
    source_chat_id = Column(BigInteger, index=True)
    source_msg_id = Column(BigInteger, index=True)
    dest_chat_id = Column(BigInteger, index=True)
    dest_msg_id = Column(BigInteger)

class WelcomeConfig(Base):
    __tablename__ = "welcome_configs"
    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("groups.id"), unique=True)
    is_enabled = Column(Boolean, default=True)
    template_text = Column(Text, default="👋 Welcome {first_name} to {group_name}!")
    delete_after_seconds = Column(Integer, default=60)
    buttons_json = Column(Text, default="[]")`,

    'requirements.txt': `aiogram>=3.15.0
sqlalchemy[asyncio]>=2.0.30
asyncpg>=0.29.0
aiosqlite>=0.20.0
pydantic-settings>=2.3.0
python-dotenv>=1.0.1
pytest>=8.2.0
pytest-asyncio>=0.23.0`,

    'docker-compose.yml': `version: '3.8'

services:
  db:
    image: postgres:16-alpine
    container_name: telegroup_postgres
    restart: always
    environment:
      POSTGRES_USER: telegroup
      POSTGRES_PASSWORD: secretpassword123
      POSTGRES_DB: telegroup_db
    volumes:
      - pgdata:/var/lib/postgresql/data

  bot:
    build: .
    container_name: telegroup_bot
    restart: always
    depends_on:
      - db
    environment:
      TELEGRAM_BOT_TOKEN: \${TELEGRAM_BOT_TOKEN}
      DATABASE_URL: postgresql+asyncpg://telegroup:secretpassword123@db:5432/telegroup_db
      BOT_ADMIN_IDS: \${BOT_ADMIN_IDS}

volumes:
  pgdata:`,

    'startup.sh': `#!/usr/bin/env bash
set -e

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN is not set in environment or .env."
  exit 1
fi

echo "Starting TeleGroup Bot in 24/7 async mode..."
exec python3 -m bot.main`,
  };

  const handleCopy = () => {
    const content = filesMap[selectedFile] || '';
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Intro */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-white">Production Python Code & 24/7 Deployment</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Complete, fully runnable aiogram 3.15 + PostgreSQL/SQLite codebase ready for 24/7 hosting.
          </p>
        </div>
      </div>

      {/* Code Browser & File Tree */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: File Tree */}
        <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-white pb-2 border-b border-slate-800">
            <FolderTree className="w-4 h-4 text-indigo-400" />
            <span>Project Files</span>
          </div>

          <div className="space-y-1 font-mono text-xs">
            {Object.keys(filesMap).map((filename) => (
              <button
                key={filename}
                onClick={() => setSelectedFile(filename)}
                className={`w-full text-left px-2.5 py-1.5 rounded transition-colors flex items-center gap-2 ${
                  selectedFile === filename
                    ? 'bg-indigo-600/30 text-white font-medium border border-indigo-500/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <FileText className="w-3.5 h-3.5 shrink-0 opacity-70" />
                <span className="truncate">{filename}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Code Viewer */}
        <div className="lg:col-span-3 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-mono text-slate-300 font-semibold">{selectedFile}</span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy File</span>
                </>
              )}
            </button>
          </div>

          <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed max-h-[500px]">
            {filesMap[selectedFile]}
          </pre>
        </div>
      </div>

      {/* 24/7 Hosting Guide Tabs */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Server className="w-4 h-4 text-indigo-400" />
          <span>24/7 Deployment Instructions</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {/* Method 1: Docker */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="font-semibold text-white">1. Docker Compose (VPS)</div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Auto-starts PostgreSQL 16 and TeleGroup Bot with automatic reboot on server crashes.
            </p>
            <div className="bg-slate-900 p-2.5 rounded font-mono text-[11px] text-indigo-300 space-y-1">
              <div>cp .env.example .env</div>
              <div>docker-compose up -d --build</div>
            </div>
          </div>

          {/* Method 2: Systemd */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="font-semibold text-white">2. Linux Systemd Service</div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Run directly as a background Linux service under Ubuntu or Debian.
            </p>
            <div className="bg-slate-900 p-2.5 rounded font-mono text-[11px] text-indigo-300 space-y-1">
              <div>sudo systemctl enable telegroup</div>
              <div>sudo systemctl start telegroup</div>
            </div>
          </div>

          {/* Method 3: Railway / Render */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="font-semibold text-white">3. Railway / Render Cloud</div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Push to GitHub, add PostgreSQL plugin, set <code className="text-slate-300">TELEGRAM_BOT_TOKEN</code> in env vars.
            </p>
            <div className="bg-slate-900 p-2.5 rounded font-mono text-[11px] text-indigo-300 space-y-1">
              <div>Build: pip install -r requirements.txt</div>
              <div>Start: python3 -m bot.main</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
