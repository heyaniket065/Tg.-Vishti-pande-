"""
Scheduled Broadcasts & Recurring Messages for TeleGroup Bot.
Allows scheduling periodic reminders and alerts to connected groups.
"""

import asyncio
from datetime import datetime, timedelta
import logging
from typing import List

from aiogram import Router, Bot
from sqlalchemy import select

from bot.database.database import async_session
from bot.database.models import ScheduledMessage, Group

logger = logging.getLogger(__name__)
router = Router(name="scheduling")


async def run_scheduled_messages_worker(bot: Bot):
    """Background worker periodically checking for due scheduled messages."""
    logger.info("Scheduled messages background worker started.")
    while True:
        try:
            now = datetime.utcnow()
            async with async_session() as session:
                stmt = select(ScheduledMessage).where(
                    ScheduledMessage.is_active == True,
                    ScheduledMessage.next_run_at <= now
                )
                res = await session.execute(stmt)
                due_messages = res.scalars().all()

                for item in due_messages:
                    group = await session.get(Group, item.group_id)
                    if group and group.is_active:
                        try:
                            await bot.send_message(
                                chat_id=group.tg_chat_id,
                                text=item.text,
                                parse_mode="Markdown"
                            )
                            logger.info(f"Delivered scheduled message #{item.id} to {group.title}")
                        except Exception as e:
                            logger.error(f"Failed to deliver scheduled message #{item.id}: {e}")

                    # Update next run time
                    item.next_run_at = now + timedelta(minutes=item.interval_minutes)

                await session.commit()

        except Exception as e:
            logger.error(f"Error in scheduled messages worker: {e}", exc_info=True)

        await asyncio.sleep(60)  # Check every 60 seconds
