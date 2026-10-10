# TeleGroup Bot - Advanced Telegram Group Management System

A complete, production-ready Telegram Group Management Bot inspired by Rose Bot, built with **Python 3.12+**, **aiogram 3.15**, **SQLAlchemy 2.0 Async**, and **PostgreSQL** (with **SQLite** local development mode).

Manage multiple Telegram groups entirely from the bot's private chat without having to execute manual commands inside each individual group.

---

## 🌟 Key Features

1. **Private Chat Control Dashboard (`/start`)**
   - 12-button interactive inline navigation: Dashboard, My Groups, Connect Groups, Cross-Posting, Welcome System, Moderation, Promotions, Group Settings, Statistics, Logs, Help & Commands, Bot Status.
   - Clean navigation with breadcrumbs, pagination, Back buttons, and confirmation modals.

2. **Secure Single-Use Group Linking (`/linkgroup` & `/connect`)**
   - Run `/linkgroup` in Group A to generate an alphanumeric 6-character code (e.g., `A7XK92`, 10-minute expiry).
   - Run `/linkgroup` in Group B to generate Code B.
   - In private chat: run `/connect A7XK92 B4MPL8`.
   - Real-time permission verification: verifies administrator privileges of the sender and required bot rights in both groups.
   - Codes are strictly single-use and invalidated immediately upon successful connection.

3. **High-Performance Cross-Posting Engine**
   - Transfer messages between connected groups in real-time.
   - Supported directions: `Group A → Group B`, `Group B → Group A`, or `Bidirectional`.
   - Supported modes: `Clean Copy` (no forward banner) or `Forward` (with original attribution).
   - Handles text, photos, video, audio, voice notes, stickers, captions, and documents.
   - Anti-loop protection: message ID mapping database and deduplication hash prevent self-posting and recursive loops.
   - Commands: `/crosspost_status`, `/crosspost_pause`, `/crosspost_resume`.

4. **Welcome & Goodbye System with Auto-Delete**
   - Automated welcome message on member join with dynamic placeholders: `{first_name}`, `{last_name}`, `{full_name}`, `{username}`, `{group_name}`, `{user_id}`.
   - Inline URL buttons (e.g., rules link, support channel).
   - Optional welcome banner image.
   - **Configurable auto-delete timer**: 10s, 30s, 60s (default), 120s, 300s, or disabled to prevent chat clutter.

5. **Complete Moderation System**
   - Commands: `/warn`, `/warnings`, `/resetwarn`, `/mute`, `/unmute`, `/ban`, `/unban`, `/kick`, `/purge`, `/report`.
   - Configurable warning thresholds (e.g. 3 warnings → auto-mute/ban).
   - Flexible durations (`/mute 15m Spamming`, `/mute 2h`, `/mute 1d`).
   - Admin & owner immunity (cannot accidentally warn/ban fellow administrators).
   - Moderation audit logging.

6. **Anti-Spam & Group Safety**
   - Sliding-window flood protection (e.g. max 5 messages in 5 seconds).
   - Repeated/duplicate message detector.
   - External link filtering (`http://`, `https://`, `t.me`).
   - Custom blocked words and phrases filter.

7. **Promotion & Aesthetic Button Builder**
   - Interactive wizard in private chat to build rich promotional broadcasts.
   - Formatted text, optional image banner, and multi-row inline URL buttons.
   - Realistic preview before publishing to authorized target groups.

8. **Rule-Based Filters & Auto-Replies**
   - Exact and substring keyword auto-responders configured from private chat.

9. **Interactive 11-Topic Help Center (`/help`)**
   - Step-by-step guides for every feature including requirements, syntax, examples, expected output, and common pitfalls.

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- Python 3.12+ (or 3.10+)
- An existing Telegram Bot Token from [@BotFather](https://t.me/BotFather)

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Edit `.env` and insert your BotFather token:
```ini
TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
DATABASE_URL="sqlite+aiosqlite:///./telegroup.db"
BOT_ADMIN_IDS="123456789"
```

### 3. Install Dependencies
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 4. Start the Bot
```bash
bash startup.sh
# or:
python3 -m bot.main
```

---

## 🐳 Production Deployment (24/7 Always-On)

### Option A: Docker & Docker Compose (Recommended for VPS)
1. Ensure Docker and Docker Compose are installed on your Linux VPS.
2. Clone this repository onto your server.
3. Set your `TELEGRAM_BOT_TOKEN` in `.env`.
4. Run:
```bash
docker-compose up -d --build
```
This boots a persistent PostgreSQL 16 container and the TeleGroup bot container with auto-restart on system boot.

### Option B: Systemd Service (Ubuntu / Debian VPS)
Create `/etc/systemd/system/telegroup.service`:
```ini
[Unit]
Description=TeleGroup Management Bot 24/7
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/telegroup-bot
EnvironmentFile=/home/ubuntu/telegroup-bot/.env
ExecStart=/home/ubuntu/telegroup-bot/venv/bin/python3 -m bot.main
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable telegroup
sudo systemctl start telegroup
sudo systemctl status telegroup
```

### Option C: Cloud Hosting (Railway / Render / Fly.io)
1. Push this repository to GitHub or upload it.
2. In Railway or Render:
   - Create a **PostgreSQL Database** service.
   - Create a **Worker / Web Service** from this Dockerfile or Python repository.
   - Set environment variables:
     - `TELEGRAM_BOT_TOKEN`: `<your-token>`
     - `DATABASE_URL`: `${{Postgres.DATABASE_URL}}`
     - `BOT_ADMIN_IDS`: `<your-telegram-id>`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `python3 -m bot.main`

---

## 🔒 Security & Best Practices

1. **BotFather Privacy Mode**:
   To enable cross-posting and keyword filters, open [@BotFather](https://t.me/BotFather) → `/setprivacy` → Select your bot → Select **Disable**. (This allows the bot to receive messages in groups it is an administrator of).
2. **Never Commit Secrets**:
   The `.env` file is excluded in `.gitignore`. Never paste your bot token into public chats or version control.
3. **Revoking a Compromised Token**:
   If your token is ever leaked, immediately visit [@BotFather](https://t.me/BotFather), select `/revoke`, and update `TELEGRAM_BOT_TOKEN` with the new token.

---

## 🧪 Running Automated Tests
```bash
pytest tests/
```
Tests cover connection code generation, welcome templating, duration parsing, anti-spam URL detection, and loop-prevention deduplication.
