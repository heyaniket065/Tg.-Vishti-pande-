"""
TeleGroup Bot - Main Production Entry Point.
Initializes aiogram 3 Dispatcher, database connections, routers,
middleware, background tasks, and starts 24/7 async polling.
"""

import asyncio
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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("telegroup_bot")


async def setup_bot_commands(bot: Bot):
    """Register menu commands with Telegram Bot API."""
    commands = [
        BotCommand(command="start", description="Open private management dashboard"),
        BotCommand(command="help", description="Open interactive Help Center"),
        BotCommand(command="linkgroup", description="Generate link code (in group)"),
        BotCommand(command="warn", description="Warn a member (reply in group)"),
        BotCommand(command="mute", description="Mute a member (reply in group)"),
        BotCommand(command="rules", description="Display group rules"),
        BotCommand(command="crosspost_status", description="Check active cross-post status"),
    ]
    try:
        await bot.set_my_commands(commands, scope=BotCommandScopeDefault())
        logger.info("Bot commands registered successfully with Telegram API.")
    except Exception as e:
        logger.warning(f"Could not register bot commands: {e}")


async def main():
    settings = get_settings()

    if not settings.bot_token:
        logger.error(
            "CRITICAL: TELEGRAM_BOT_TOKEN is not set in environment or .env file! "
            "Please configure your existing BotFather token and restart."
        )
        sys.exit(1)

    logger.info("Initializing database connection...")
    await init_db()

    logger.info("Connecting to Telegram Bot API with configured token...")
    bot = Bot(
        token=settings.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.MARKDOWN)
    )

    try:
        me = await bot.get_me()
        logger.info(f"Bot connected successfully as @{me.username} (ID: {me.id}, Name: {me.first_name})")
    except Exception as e:
        logger.error(f"Failed to validate bot token with Telegram getMe API: {e}")
        sys.exit(1)

    dp = Dispatcher()

    # Register Middlewares
    dp.update.middleware(AdminAuthMiddleware())

    # Register Routers in specific sequence
    # 1. Private chat commands & dashboard
    dp.include_router(private_dashboard.router)
    dp.include_router(help_center.router)
    dp.include_router(promotions.router)

    # 2. Group linking & verification
    dp.include_router(group_linking.router)

    # 3. Moderation & Anti-Spam
    dp.include_router(moderation.router)
    dp.include_router(antispam.router)

    # 4. Keyword Filters & Welcome
    dp.include_router(welcome.router)
    dp.include_router(filters.router)

    # 5. Cross-Posting Engine (handles general group messages)
    dp.include_router(cross_posting.router)

    await setup_bot_commands(bot)

    # Start scheduled message background worker
    asyncio.create_task(scheduling.run_scheduled_messages_worker(bot))

    logger.info("Starting Telegram Bot long-polling (24/7 mode)...")
    try:
        # Drop pending updates so old messages are not reprocessed
        await bot.delete_webhook(drop_pending_updates=True)
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        logger.info("Shutting down bot session...")
        await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("TeleGroup Bot stopped gracefully.")
