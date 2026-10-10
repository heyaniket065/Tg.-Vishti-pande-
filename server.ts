/**
 * Full-Stack Server for TeleGroup Bot Control Hub & Studio.
 * Runs Express on port 3000 with REAL Telegram Bot API Long-Polling Engine.
 * Supports groups, supergroups, and broadcast channels (channel_post),
 * multi-language support (Hinglish [Default], English, Hindi, Marathi),
 * single-code linking, multi-group cross-posting, persistent database storage,
 * and reliable fresh-message private dashboard navigation.
 */

import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

const CONFIG_FILE = path.resolve(__dirname, '.bot_config.json');
const DB_FILE = path.resolve(__dirname, '.bot_db.json');

// Supported Languages
export type BotLanguage = 'hinglish' | 'english' | 'hindi' | 'marathi';
let defaultBotLanguage: BotLanguage = 'hinglish';
const dbUserLanguages: Map<number, BotLanguage> = new Map();

// Live Telegram Bot State
let activeBotToken: string = process.env.TELEGRAM_BOT_TOKEN || '';
let verifiedBotInfo: any = null;
let isPollingActive = false;
let pollingAbortController: AbortController | null = null;

// Try loading saved token if not in env
if (!activeBotToken && fs.existsSync(CONFIG_FILE)) {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.token) {
      activeBotToken = parsed.token;
      console.log('Loaded saved Telegram bot token from .bot_config.json');
    }
  } catch (e) {
    console.error('Error reading .bot_config.json:', e);
  }
}

// Live activity logs for UI
interface LiveEvent {
  id: string;
  time: string;
  type: 'incoming_message' | 'callback' | 'crosspost' | 'welcome' | 'moderation' | 'system' | 'error';
  chatTitle?: string;
  sender?: string;
  details: string;
}

const liveEvents: LiveEvent[] = [];

function addLiveEvent(
  type: LiveEvent['type'],
  details: string,
  chatTitle?: string,
  sender?: string
) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  liveEvents.unshift({
    id: `ev-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    time,
    type,
    chatTitle,
    sender,
    details,
  });
  if (liveEvents.length > 60) {
    liveEvents.pop();
  }
}

// Persistent Database Interfaces
interface DBGroup {
  id: number;
  tgChatId: number;
  title: string;
  type: 'group' | 'supergroup' | 'channel';
  ownerUserId?: number;
  warnLimit: number;
  warnAction: string;
  rulesText: string;
  welcomeEnabled: boolean;
  welcomeDeleteSeconds: number;
  blockLinks: boolean;
  floodLimit: number;
  createdAt: string;
}

interface DBLinkCode {
  code: string;
  groupId: number;
  groupTitle: string;
  groupType: string;
  generatedByUserId: number;
  expiresAt: number;
  isUsed: boolean;
  usedByUserId: number | null;
}

interface DBCrossPost {
  id: number;
  name: string;
  groupAId: number;
  groupBId: number;
  direction: 'A_TO_B' | 'B_TO_A' | 'BIDIRECTIONAL';
  mode: 'COPY' | 'FORWARD';
  isActive: boolean;
}

interface SimMessage {
  id: string;
  chatType: 'private' | 'group_a' | 'group_b';
  sender: string;
  senderRole: 'admin' | 'member' | 'bot';
  senderId: number;
  text: string;
  timestamp: string;
  inlineButtons?: Array<Array<{ text: string; callbackData?: string; callback_data?: string; url?: string }>>;
}

const dbGroups: Map<number, DBGroup> = new Map();
const dbLinkCodes: DBLinkCode[] = [];
const dbCrossPosts: DBCrossPost[] = [];
const dbWarnings: Map<string, number> = new Map(); // key: "chatId:userId" -> count
const processedMsgMap: Set<string> = new Set(); // anti-loop: "sourceChatId:destChatId:msgId"
const botSentMessageIds: Set<string> = new Set(); // anti-loop: "chatId:messageId"
const simMessages: SimMessage[] = [];

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Seed default simulation data if empty
function ensureDefaultSimData() {
  if (dbGroups.size === 0) {
    dbGroups.set(1, {
      id: 1,
      tgChatId: -1001928374650,
      title: 'Crypto Alpha Community (Group A)',
      type: 'supergroup',
      ownerUserId: 999001,
      warnLimit: 3,
      warnAction: 'mute',
      rulesText: '1. Be respectful to all members\n2. No advertising or referral links\n3. Constructive discussion only.',
      welcomeEnabled: true,
      welcomeDeleteSeconds: 60,
      blockLinks: true,
      floodLimit: 5,
      createdAt: new Date().toISOString(),
    });
    dbGroups.set(2, {
      id: 2,
      tgChatId: -1002847592011,
      title: 'VIP Announcements Channel (Group B)',
      type: 'channel',
      ownerUserId: 999001,
      warnLimit: 3,
      warnAction: 'mute',
      rulesText: 'Official verified announcements and market alerts.',
      welcomeEnabled: false,
      welcomeDeleteSeconds: 60,
      blockLinks: false,
      floodLimit: 10,
      createdAt: new Date().toISOString(),
    });
  }
}

// Load & Save Persistent Database
function loadDatabase() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      if (data.groups) {
        Object.values(data.groups).forEach((g: any) => {
          dbGroups.set(g.id, g);
        });
      }
      if (Array.isArray(data.linkCodes)) {
        dbLinkCodes.push(...data.linkCodes);
      }
      if (Array.isArray(data.crossPosts)) {
        dbCrossPosts.length = 0;
        dbCrossPosts.push(...data.crossPosts);
      }
      if (data.defaultBotLanguage) {
        defaultBotLanguage = data.defaultBotLanguage;
      }
      if (data.userLanguages && typeof data.userLanguages === 'object') {
        Object.entries(data.userLanguages).forEach(([uid, lang]) => {
          dbUserLanguages.set(Number(uid), lang as BotLanguage);
        });
      }
      console.log(`Database loaded: ${dbGroups.size} groups, ${dbCrossPosts.length} pipelines, default language: ${defaultBotLanguage}.`);
    } catch (e) {
      console.error('Error loading .bot_db.json:', e);
    }
  }
  ensureDefaultSimData();
}

function saveDatabase() {
  try {
    const data = {
      defaultBotLanguage,
      userLanguages: Object.fromEntries(dbUserLanguages.entries()),
      groups: Object.fromEntries(dbGroups.entries()),
      linkCodes: dbLinkCodes.slice(-100), // keep recent 100
      crossPosts: dbCrossPosts,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error saving .bot_db.json:', e);
  }
}

loadDatabase();

function getUserLang(userId?: number): BotLanguage {
  if (userId && dbUserLanguages.has(userId)) {
    return dbUserLanguages.get(userId)!;
  }
  return defaultBotLanguage;
}

function setUserLang(userId: number, lang: BotLanguage) {
  dbUserLanguages.set(userId, lang);
  saveDatabase();
  addLiveEvent('system', `User ${userId} language set to ${lang}`);
}

function generateCode(length = 6): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Telegram API Helper Functions
async function tgCall(token: string, method: string, payload: any = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn(`Telegram API error [${method}]:`, data.description || data);
      addLiveEvent('error', `Telegram error [${method}]: ${data.description || 'Unknown error'}`);
    }
    return data;
  } catch (err: any) {
    console.error(`Telegram fetch error [${method}]:`, err.message);
    addLiveEvent('error', `Network error [${method}]: ${err.message}`);
    return { ok: false, description: err.message };
  }
}

// Main Menu Inline Keyboards in 4 Languages
function getMainMenuKeyboard(lang: BotLanguage = 'hinglish') {
  if (lang === 'english') {
    return {
      inline_keyboard: [
        [
          { text: '🏠 Dashboard', callback_data: 'nav_dashboard' },
          { text: '👥 My Groups', callback_data: 'nav_my_groups' },
        ],
        [
          { text: '🔗 Connect Groups', callback_data: 'nav_connect_groups' },
          { text: '🔄 Cross-Posting', callback_data: 'nav_crosspost' },
        ],
        [
          { text: '👋 Welcome System', callback_data: 'nav_welcome' },
          { text: '🛡️ Moderation', callback_data: 'nav_moderation' },
        ],
        [
          { text: '📢 Promotions', callback_data: 'nav_promotions' },
          { text: '⚙️ Group Settings', callback_data: 'nav_settings' },
        ],
        [
          { text: '📊 Statistics', callback_data: 'nav_stats' },
          { text: '📋 Logs', callback_data: 'nav_logs' },
        ],
        [
          { text: '🌐 Change Language', callback_data: 'nav_language' },
          { text: '📚 Help & Commands', callback_data: 'nav_help' },
        ],
        [
          { text: '🔍 Bot Status', callback_data: 'nav_status' },
        ],
      ],
    };
  }

  if (lang === 'hindi') {
    return {
      inline_keyboard: [
        [
          { text: '🏠 डैशबोर्ड', callback_data: 'nav_dashboard' },
          { text: '👥 मेरे ग्रुप्स', callback_data: 'nav_my_groups' },
        ],
        [
          { text: '🔗 ग्रुप जोड़ें', callback_data: 'nav_connect_groups' },
          { text: '🔄 क्रॉस-पोस्टिंग', callback_data: 'nav_crosspost' },
        ],
        [
          { text: '👋 वेलकम सिस्टम', callback_data: 'nav_welcome' },
          { text: '🛡️ मॉडरेशन', callback_data: 'nav_moderation' },
        ],
        [
          { text: '📢 प्रमोशन्स', callback_data: 'nav_promotions' },
          { text: '⚙️ ग्रुप सेटिंग्स', callback_data: 'nav_settings' },
        ],
        [
          { text: '📊 आंकड़े', callback_data: 'nav_stats' },
          { text: '📋 लॉग्स', callback_data: 'nav_logs' },
        ],
        [
          { text: '🌐 भाषा बदलें', callback_data: 'nav_language' },
          { text: '📚 सहायता एवं कमांड्स', callback_data: 'nav_help' },
        ],
        [
          { text: '🔍 बॉट स्थिति', callback_data: 'nav_status' },
        ],
      ],
    };
  }

  if (lang === 'marathi') {
    return {
      inline_keyboard: [
        [
          { text: '🏠 डॅशबोर्ड', callback_data: 'nav_dashboard' },
          { text: '👥 माझे ग्रुप्स', callback_data: 'nav_my_groups' },
        ],
        [
          { text: '🔗 ग्रुप जोडा', callback_data: 'nav_connect_groups' },
          { text: '🔄 क्रॉस-पोस्टिंग', callback_data: 'nav_crosspost' },
        ],
        [
          { text: '👋 वेलकम सिस्टीम', callback_data: 'nav_welcome' },
          { text: '🛡️ मॉडरेशन', callback_data: 'nav_moderation' },
        ],
        [
          { text: '📢 प्रमोशन्स', callback_data: 'nav_promotions' },
          { text: '⚙️ ग्रुप सेटिंग्स', callback_data: 'nav_settings' },
        ],
        [
          { text: '📊 आकडेवारी', callback_data: 'nav_stats' },
          { text: '📋 लॉग्स', callback_data: 'nav_logs' },
        ],
        [
          { text: '🌐 भाषा बदला', callback_data: 'nav_language' },
          { text: '📚 मदत आणि कमांड्स', callback_data: 'nav_help' },
        ],
        [
          { text: '🔍 बॉट स्थिती', callback_data: 'nav_status' },
        ],
      ],
    };
  }

  // Default: Hinglish
  return {
    inline_keyboard: [
      [
        { text: '🏠 Dashboard', callback_data: 'nav_dashboard' },
        { text: '👥 Mere Groups', callback_data: 'nav_my_groups' },
      ],
      [
        { text: '🔗 Connect Groups', callback_data: 'nav_connect_groups' },
        { text: '🔄 Cross-Posting', callback_data: 'nav_crosspost' },
      ],
      [
        { text: '👋 Welcome System', callback_data: 'nav_welcome' },
        { text: '🛡️ Moderation', callback_data: 'nav_moderation' },
      ],
      [
        { text: '📢 Promotions', callback_data: 'nav_promotions' },
        { text: '⚙️ Group Settings', callback_data: 'nav_settings' },
      ],
      [
        { text: '📊 Statistics', callback_data: 'nav_stats' },
        { text: '📋 Logs', callback_data: 'nav_logs' },
      ],
      [
        { text: '🌐 Language / भाषा', callback_data: 'nav_language' },
        { text: '📚 Help & Commands', callback_data: 'nav_help' },
      ],
      [
        { text: '🔍 Bot Status', callback_data: 'nav_status' },
      ],
    ],
  };
}

// Language Picker Keyboard
function getLanguageKeyboard(currentLang: BotLanguage) {
  return {
    inline_keyboard: [
      [
        {
          text: `${currentLang === 'hinglish' ? '✅ ' : ''}🇮🇳 Hinglish (Aap aisa karo)`,
          callback_data: 'set_lang_hinglish',
        },
      ],
      [
        {
          text: `${currentLang === 'english' ? '✅ ' : ''}🇬🇧 English`,
          callback_data: 'set_lang_english',
        },
      ],
      [
        {
          text: `${currentLang === 'hindi' ? '✅ ' : ''}🇮🇳 हिन्दी (Hindi)`,
          callback_data: 'set_lang_hindi',
        },
      ],
      [
        {
          text: `${currentLang === 'marathi' ? '✅ ' : ''}🚩 मराठी (Marathi)`,
          callback_data: 'set_lang_marathi',
        },
      ],
      [
        { text: '« Back to Main Menu', callback_data: 'nav_main_menu' },
      ],
    ],
  };
}

function getBackKeyboard(lang: BotLanguage = 'hinglish') {
  const label =
    lang === 'english'
      ? '« Back to Main Menu'
      : lang === 'hindi'
      ? '« मुख्य मेन्यू में वापस जाएं'
      : lang === 'marathi'
      ? '« मुख्य मेन्यूवर परत जा'
      : '« Main Menu me wapas jaiye';
  return {
    inline_keyboard: [[{ text: label, callback_data: 'nav_main_menu' }]],
  };
}

// REAL TELEGRAM LONG-POLLING ENGINE
async function runTelegramPoller(token: string) {
  if (isPollingActive) {
    console.log('Telegram poller is already active.');
    return;
  }

  isPollingActive = true;
  pollingAbortController = new AbortController();

  console.log('Initiating Telegram Bot connection...');
  addLiveEvent('system', 'Validating bot credentials with Telegram API...');

  // 1. Verify getMe
  const meRes = await tgCall(token, 'getMe');
  if (!meRes.ok || !meRes.result) {
    console.error('Failed to validate bot token:', meRes);
    addLiveEvent('error', `Bot validation failed: ${meRes.description || 'Invalid token'}`);
    isPollingActive = false;
    return;
  }

  verifiedBotInfo = meRes.result;
  console.log(`Telegram Bot verified as @${verifiedBotInfo.username} (ID: ${verifiedBotInfo.id})`);
  addLiveEvent('system', `Connected as @${verifiedBotInfo.username} (${verifiedBotInfo.first_name})`);

  // 2. Clear webhook to allow long-polling
  await tgCall(token, 'deleteWebhook', { drop_pending_updates: false });
  addLiveEvent('system', 'Webhook cleared. Starting continuous Long-Polling (24/7)...');

  let offset = 0;

  while (isPollingActive) {
    try {
      // Allowed updates includes channels and supergroups
      const res = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20&allowed_updates=["message","edited_message","channel_post","edited_channel_post","callback_query","chat_member","my_chat_member"]`,
        { signal: pollingAbortController?.signal }
      );

      const data = await res.json();
      if (!data.ok || !Array.isArray(data.result)) {
        if (data.error_code === 409) {
          console.warn('Telegram polling conflict. Retrying in 5s...');
          await new Promise((r) => setTimeout(r, 5000));
        } else {
          console.warn('getUpdates returned non-ok:', data);
          await new Promise((r) => setTimeout(r, 3000));
        }
        continue;
      }

      for (const update of data.result) {
        offset = update.update_id + 1;
        handleTelegramUpdate(token, update).catch((err) => {
          console.error('Error handling Telegram update:', err);
        });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Telegram polling loop aborted.');
        break;
      }
      console.error('Polling network error:', err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  isPollingActive = false;
  console.log('Telegram polling stopped.');
}

// Dedicated robust Welcome Event Handler with HTML escaping & auto-delete
async function handleNewMemberWelcome(token: string, chat: any, newMember: any) {
  if (!newMember || newMember.id === verifiedBotInfo?.id || newMember.is_bot) return;

  const grp = dbGroups.get(chat.id);
  if (grp && !grp.welcomeEnabled) {
    return;
  }

  const deleteSeconds = grp?.welcomeDeleteSeconds || 60;
  const memberName = escapeHtml(newMember.first_name || newMember.username || 'Member');
  const chatTitle = escapeHtml(chat.title || 'the group');
  const userMention = `<a href="tg://user?id=${newMember.id}">${memberName}</a>`;

  const welcomeHtml = `👋 <b>Welcome to ${chatTitle}, ${userMention}!</b>\n\n🎉 Glad to have you in our community! Please follow group rules and enjoy your stay.\n\n<i>⏱️ (Auto-deleting in ${deleteSeconds}s to keep chat clean)</i>`;

  const sent = await tgCall(token, 'sendMessage', {
    chat_id: chat.id,
    text: welcomeHtml,
    parse_mode: 'HTML',
  });

  if (sent.ok && sent.result?.message_id) {
    const sentMsgId = sent.result.message_id;
    botSentMessageIds.add(`${chat.id}:${sentMsgId}`);
    addLiveEvent('welcome', `Welcomed ${newMember.first_name || 'Member'} to "${chat.title || chat.id}" (auto-delete in ${deleteSeconds}s)`);

    setTimeout(async () => {
      const delRes = await tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: sentMsgId });
      if (delRes.ok) {
        addLiveEvent('welcome', `🧹 Auto-deleted welcome message in "${chat.title || chat.id}" after ${deleteSeconds}s`);
      }
    }, deleteSeconds * 1000);
  } else {
    addLiveEvent('error', `Failed to send welcome message in "${chat.title || chat.id}": ${sent.description || 'Unknown error'}`);
  }
}

// Telegram Update Dispatcher
async function handleTelegramUpdate(token: string, update: any) {
  const botUsername = verifiedBotInfo?.username || 'Its_Vrishti_bot';

  // 0. Handle my_chat_member (Bot added to group or channel, or promoted to admin)
  if (update.my_chat_member) {
    const mcm = update.my_chat_member;
    const chat = mcm.chat;
    const newStatus = mcm.new_chat_member?.status;

    if (newStatus === 'administrator' || newStatus === 'member') {
      const gType = chat.type === 'channel' ? 'channel' : chat.type === 'supergroup' ? 'supergroup' : 'group';
      const existing = dbGroups.get(chat.id);
      dbGroups.set(chat.id, {
        id: chat.id,
        tgChatId: chat.id,
        title: chat.title || `Chat ${chat.id}`,
        type: gType,
        ownerUserId: existing?.ownerUserId,
        warnLimit: 3,
        warnAction: 'mute',
        rulesText: '1. Be respectful\n2. No spam\n3. Constructive discussions only.',
        welcomeEnabled: true,
        welcomeDeleteSeconds: 60,
        blockLinks: false,
        floodLimit: 5,
        createdAt: existing?.createdAt || new Date().toISOString(),
      });
      saveDatabase();

      addLiveEvent('system', `Bot status in "${chat.title}": ${newStatus}`);

      // Conversational Hinglish greeting in group
      const groupAddText = `🛡️ **TeleGroup Bot is connected in ${chat.title || 'this chat'}!**\n\n👉 **Aap aisa karo:** Is group ko apne private dashboard se connect karne ke liye ye command send karein:\n\`/linkgroup\`\n(Ya \`/linkgroup@${botUsername}\`)`;

      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: groupAddText,
        parse_mode: 'Markdown',
      });
    }
    return;
  }

  // 0.5. Handle chat_member updates (Telegram Supergroup/Channel Join Event)
  if (update.chat_member) {
    const cm = update.chat_member;
    const chat = cm.chat;
    const newMember = cm.new_chat_member?.user;
    const oldStatus = cm.old_chat_member?.status;
    const newStatus = cm.new_chat_member?.status;

    if (
      newMember &&
      !newMember.is_bot &&
      (newStatus === 'member' || newStatus === 'restricted') &&
      (oldStatus === 'left' || oldStatus === 'kicked' || !oldStatus)
    ) {
      await handleNewMemberWelcome(token, chat, newMember);
      return;
    }
  }

  // 1. Handle Inline Keyboards (Callback Queries)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat?.id;
    const data = cb.data;
    const user = cb.from;
    const userLang = getUserLang(user.id);

    addLiveEvent('callback', `Button clicked: "${data}" by @${user.username || user.first_name}`);

    // Answer callback query immediately to stop spinner
    await tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id });

    // Handle Language Switching Callbacks
    if (data?.startsWith('set_lang_')) {
      const chosenLang = data.replace('set_lang_', '') as BotLanguage;
      if (['hinglish', 'english', 'hindi', 'marathi'].includes(chosenLang)) {
        setUserLang(user.id, chosenLang);
        const confirmationText =
          chosenLang === 'english'
            ? `✅ **Language Updated to English!**\n\nThe bot will now reply in English. Select an option below to continue:`
            : chosenLang === 'hindi'
            ? `✅ **भाषा हिन्दी में सेट कर दी गई है!**\n\nअब बॉट आपको हिन्दी में जवाब देगा। नीचे दिए गए मेन्यू से शुरू करें:`
            : chosenLang === 'marathi'
            ? `✅ **भाषा मराठीमध्ये सेट झाली आहे!**\n\nआता बॉट तुम्हाला मराठीत उत्तर देईल. खालील पर्यायांमधून सुरू करा:`
            : `✅ **Language Hinglish me set ho gayi hai!**\n\nAb se bot aapko friendly Hinglish ("Aap aisa karo, connect karo...") me reply karega. Niche diye gaye menu se shuru karein:`;

        await tgCall(token, 'sendMessage', {
          chat_id: chatId,
          text: confirmationText,
          parse_mode: 'Markdown',
          reply_markup: getMainMenuKeyboard(chosenLang),
        });
        return;
      }
    }

    // Handle Language Menu
    if (data === 'nav_language') {
      const langPrompt =
        userLang === 'english'
          ? `🌐 **Language Selection:**\n\nCurrent language: **🇬🇧 English**\n\nPlease select your preferred language:`
          : userLang === 'hindi'
          ? `🌐 **भाषा चयन:**\n\nवर्तमान भाषा: **🇮🇳 हिन्दी**\n\nअपनी पसंदीदा भाषा चुनें:`
          : userLang === 'marathi'
          ? `🌐 **भाषा निवडा:**\n\nसध्याची भाषा: **🚩 मराठी**\n\nकृपया तुमची भाषा निवडा:`
          : `🌐 **Language Settings / अपनी भाषा चुनें:**\n\nCurrent language: **🇮🇳 Hinglish**\n\n👉 **Aap aisa karo:** Apni pasandida bhasha choose karein:`;

      await tgCall(token, 'sendMessage', {
        chat_id: chatId,
        text: langPrompt,
        parse_mode: 'Markdown',
        reply_markup: getLanguageKeyboard(userLang),
      });
      return;
    }

    let responseText = '';
    let replyMarkup: any = getBackKeyboard(userLang);

    if (data === 'nav_main_menu') {
      responseText =
        userLang === 'english'
          ? `🏠 **TeleGroup Main Dashboard**\n\nSelect a module below to inspect or configure your groups:`
          : userLang === 'hindi'
          ? `🏠 **TeleGroup मुख्य डैशबोर्ड**\n\nअपने ग्रुप्स को प्रबंधित या कॉन्फ़िगर करने के लिए नीचे दिए गए विकल्प चुनें:`
          : userLang === 'marathi'
          ? `🏠 **TeleGroup मुख्य डॅशबोर्ड**\n\nतुमचे ग्रुप्स व्यवस्थापित करण्यासाठी खालील पर्याय निवडा:`
          : `🏠 **TeleGroup Main Dashboard**\n\n👉 **Aap aisa karo:** Niche diye gaye options me se select karein aur apne groups ko manage karein:`;
      replyMarkup = getMainMenuKeyboard(userLang);
    } else if (data === 'nav_dashboard') {
      const userGroups = Array.from(dbGroups.values()).filter((g) => g.ownerUserId === user.id);
      const activePipelines = dbCrossPosts.filter((c) => c.isActive).length;

      if (userLang === 'english') {
        responseText = `🏠 **Dashboard Overview**\n\n• **Your Managed Groups:** \`${userGroups.length}\`\n• **Total in Database:** \`${dbGroups.size}\`\n• **Active Cross-Post Pipelines:** \`${activePipelines}\`\n• **Bot Engine:** \`aiogram 3.15 + Long-Polling (24/7)\`\n• **Anti-Loop Protection:** 🟢 \`Active\`\n\nChoose an action below:`;
      } else if (userLang === 'hindi') {
        responseText = `🏠 **डैशबोर्ड ओवरव्यू**\n\n• **आपके ग्रुप्स:** \`${userGroups.length}\`\n• **डेटाबेस में कुल ग्रुप्स:** \`${dbGroups.size}\`\n• **सक्रिय क्रॉस-पोस्ट पाइपलाइन्स:** \`${activePipelines}\`\n• **बॉट इंजन:** \`24/7 सक्रिय\`\n• **एंटी-लूप सुरक्षा:** 🟢 \`सक्रिय\`\n\nनीचे दिए गए विकल्पों में से चुनें:`;
      } else if (userLang === 'marathi') {
        responseText = `🏠 **डॅशबोर्ड माहिती**\n\n• **तुमचे ग्रुप्स:** \`${userGroups.length}\`\n• **एकूण ग्रुप्स:** \`${dbGroups.size}\`\n• **सक्रिय क्रॉस-पोस्टिंग:** \`${activePipelines}\`\n• **बॉट इंजिन:** \`24/7 सुरू\`\n• **अँटी-लूप सुरक्षा:** 🟢 \`सक्रिय\`\n\nखालील पर्याय निवडा:`;
      } else {
        responseText = `🏠 **Dashboard Overview**\n\n• **Aapke Managed Groups:** \`${userGroups.length}\`\n• **Total Connected in Database:** \`${dbGroups.size}\`\n• **Active Cross-Post Pipelines:** \`${activePipelines}\`\n• **Bot Engine:** \`24/7 Long-Polling Active\`\n• **Anti-Loop Protection:** 🟢 \`Active\`\n\n👉 **Aap aisa karo:** Niche se action choose karein:`;
      }

      replyMarkup = {
        inline_keyboard: [
          [{ text: '👥 My Groups', callback_data: 'nav_my_groups' }, { text: '🔄 Cross-Posting', callback_data: 'nav_crosspost' }],
          [{ text: '🔗 Connect New Group', callback_data: 'nav_connect_groups' }],
          [{ text: '🌐 Change Language', callback_data: 'nav_language' }],
          [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
        ],
      };
    } else if (data === 'nav_my_groups') {
      const userGroups = Array.from(dbGroups.values()).filter(
        (g) => g.ownerUserId === user.id || !g.ownerUserId
      );

      if (userGroups.length === 0) {
        if (userLang === 'english') {
          responseText = `👥 **My Managed Groups (0)**\n\nNo groups or channels connected yet!\n\n**How to Connect:**\n1. Go to your Telegram group or channel.\n2. Promote @${botUsername} to **Administrator**.\n3. Send this command in that chat:\n   \`/linkgroup\`\n4. Copy and send the 6-digit code here in private chat!`;
        } else if (userLang === 'hindi') {
          responseText = `👥 **मेरे ग्रुप्स (0)**\n\nअभी तक कोई भी ग्रुप या चैनल कनेक्ट नहीं हुआ है!\n\n👉 **ग्रुप कैसे जोड़ें (आप ऐसा करें):**\n1. अपने टेलीग्राम ग्रुप या चैनल में जाएं।\n2. वहां @${botUsername} को **Administrator** बनाएं।\n3. उस ग्रुप में यह मैसेज भेजें: \`/linkgroup\`\n4. मिला हुआ 6-अक्षरों का कोड यहाँ प्राइवेट चैट में भेजें!`;
        } else if (userLang === 'marathi') {
          responseText = `👥 **माझे ग्रुप्स (0)**\n\nअजून कोणताही ग्रुप किंवा चॅनेल जोडलेला नाही!\n\n👉 **ग्रुप कसा जोडावा:**\n1. तुमच्या Telegram ग्रुप किंवा चॅनेलमध्ये जा.\n2. तेथे @${botUsername} ला **Administrator** बनवा.\n3. त्या चॅटमध्ये \`/linkgroup\` पाठवा.\n4. मिळालेला 6-अक्षरी कोड येथे खाजगी चॅटमध्ये पाठवा!`;
        } else {
          // Hinglish
          responseText = `👥 **Mere Groups (0)**\n\nAbhi tak koi bhi group ya channel connect nahi hua hai!\n\n👉 **Group Connect Kaise Karein (Aap aisa karo):**\n1. Apne Telegram group ya channel me jaiye.\n2. Wahan @${botUsername} ko **Administrator** banayein.\n3. Us group me ye message send karein:\n   \`/linkgroup\`\n4. Bot wahan ek 6-digit code dega (jaise \`A7XK92\`).\n5. Wo code copy karke yahan private chat me bhej dijiye!\n\nAapka group turant yahan show hone lagega.`;
        }

        replyMarkup = {
          inline_keyboard: [
            [{ text: '🔗 Connect Groups Guide', callback_data: 'nav_connect_groups' }],
            [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
          ],
        };
      } else {
        responseText =
          userLang === 'english'
            ? `👥 **My Managed Groups (${userGroups.length}):**\n\nSelect a group to manage its welcome flows, moderation, rules, or cross-posting:`
            : userLang === 'hindi'
            ? `👥 **मेरे प्रबंधित ग्रुप्स (${userGroups.length}):**\n\nकिसी ग्रुप की सेटिंग्स प्रबंधित करने के लिए नीचे क्लिक करें:`
            : userLang === 'marathi'
            ? `👥 **माझे ग्रुप्स (${userGroups.length}):**\n\nग्रुप व्यवस्थापित करण्यासाठी खाली क्लिक करा:`
            : `👥 **Mere Managed Groups (${userGroups.length}):**\n\n👉 **Aap aisa karo:** Jis group ko manage karna hai, niche us par click karein:`;

        const groupBtns = userGroups.map((g) => [
          { text: `🟢 ${g.title} (${g.type})`, callback_data: `grp_view_${g.id}` },
        ]);
        replyMarkup = {
          inline_keyboard: [
            ...groupBtns,
            [{ text: '🔗 Connect Another Group', callback_data: 'nav_connect_groups' }],
            [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
          ],
        };
      }
    } else if (data?.startsWith('grp_view_')) {
      const gId = Number(data.replace('grp_view_', ''));
      const grp = dbGroups.get(gId);
      if (!grp) {
        responseText = `⚠️ Group not found or removed.`;
        replyMarkup = { inline_keyboard: [[{ text: '« Back to My Groups', callback_data: 'nav_my_groups' }]] };
      } else {
        responseText = `⚙️ **Group Management: ${grp.title}**\n\n• **Chat ID:** \`${grp.tgChatId}\`\n• **Type:** \`${grp.type}\`\n• **Status:** 🟢 \`Active & Authorized\`\n• **Warn Threshold:** \`${grp.warnLimit}\` (${grp.warnAction})\n• **Flood Limit:** \`${grp.floodLimit}\` msgs / 5s\n• **Welcome Flow:** \`${grp.welcomeEnabled ? 'Enabled (60s auto-delete)' : 'Disabled'}\`\n\nSelect an option to customize:`;
        replyMarkup = {
          inline_keyboard: [
            [{ text: '👋 Welcome Message Settings', callback_data: `grp_welcome_${grp.id}` }],
            [{ text: '📜 View & Edit Rules', callback_data: `grp_rules_${grp.id}` }],
            [{ text: '🔄 Cross-Posting Setup', callback_data: 'nav_crosspost' }],
            [{ text: '❌ Unlink This Group', callback_data: `grp_unlink_${grp.id}` }],
            [{ text: '« Back to My Groups', callback_data: 'nav_my_groups' }],
          ],
        };
      }
    } else if (data?.startsWith('grp_rules_')) {
      const gId = Number(data.replace('grp_rules_', ''));
      const grp = dbGroups.get(gId);
      responseText = `📜 **Rules for ${grp?.title || 'Group'}:**\n\n${grp?.rulesText || 'Be respectful and follow community guidelines.'}`;
      replyMarkup = {
        inline_keyboard: [[{ text: '« Back to Group', callback_data: `grp_view_${gId}` }]],
      };
    } else if (data?.startsWith('grp_welcome_')) {
      const gId = Number(data.replace('grp_welcome_', ''));
      const grp = dbGroups.get(gId);
      responseText = `👋 **Welcome System: ${grp?.title || 'Group'}**\n\n• Status: \`${grp?.welcomeEnabled ? '🟢 Enabled' : '🔴 Disabled'}\`\n• Auto-Delete Timer: \`${grp?.welcomeDeleteSeconds || 60} seconds\`\n\nNaye members aane par automated welcome greeting send hogi aur chat clean rakhne ke liye delay ke baad delete ho jayegi.`;
      replyMarkup = {
        inline_keyboard: [[{ text: '« Back to Group', callback_data: `grp_view_${gId}` }]],
      };
    } else if (data?.startsWith('grp_unlink_')) {
      const gId = Number(data.replace('grp_unlink_', ''));
      const grp = dbGroups.get(gId);
      if (grp) {
        grp.ownerUserId = undefined;
        saveDatabase();
      }
      responseText = `✅ Group **${grp?.title}** has been unlinked from your dashboard.`;
      replyMarkup = {
        inline_keyboard: [[{ text: '« Back to My Groups', callback_data: 'nav_my_groups' }]],
      };
    } else if (data === 'nav_connect_groups') {
      if (userLang === 'english') {
        responseText = `🔗 **Secure Group Connection Guide**\n\n**Step 1:** Add @${botUsername} to your Telegram group or channel as an **Administrator**.\n\n**Step 2:** In that group/channel, send this command:\n\`/linkgroup\`\n\n**Step 3:** The bot will generate a 6-character code (e.g. \`A7XK92\`).\n\n**Step 4:** Send that code here in private chat:\nE.g. \`A7XK92\` or \`/connect A7XK92\`\n\nYour group will be linked immediately!`;
      } else if (userLang === 'hindi') {
        responseText = `🔗 **सुरक्षित ग्रुप कनेक्शन गाइड (ग्रुप कैसे जोड़ें)**\n\n👉 **आप ऐसा करें:**\n**स्टेप 1:** अपने ग्रुप या चैनल में @${botUsername} को **एडमिन** बनाएं।\n\n**स्टेप 2:** उस ग्रुप में यह कमांड भेजें:\n\`/linkgroup\`\n\n**स्टेप 3:** बॉट 6-अक्षरों का कोड देगा (जैसे \`A7XK92\`)।\n\n**स्टेप 4:** वह कोड यहाँ प्राइवेट चैट में भेजें:\nजैसे: \`A7XK92\` या \`/connect A7XK92\`\n\nग्रुप तुरंत आपके डैशबोर्ड में जुड़ जाएगा!`;
      } else if (userLang === 'marathi') {
        responseText = `🔗 **सुरक्षित ग्रुप कनेक्शन मार्गदर्शक (ग्रुप कसा जोडावा)**\n\n👉 **तुम्ही असे करा:**\n**पायरी 1:** ग्रुप किंवा चॅनेलमध्ये @${botUsername} ला **ॲडमिन** बनवा.\n\n**पायरी 2:** त्या ग्रुपमध्ये हा कमांड पाठवा:\n\`/linkgroup\`\n\n**पायरी 3:** बॉट 6-अक्षरी कोड देईल (उदा. \`A7XK92\`).\n\n**पायरी 4:** तो कोड येथे खाजगी चॅटमध्ये पाठवा:\nउदा. \`A7XK92\` किंवा \`/connect A7XK92\`\n\nग्रुप तात्काळ तुमच्या डॅशबोर्डमध्ये जोडला जाईल!`;
      } else {
        // Hinglish
        responseText = `🔗 **Secure Group Connection Guide (Group Kaise Connect Karein)**\n\n👉 **Aap aisa karo:**\n**Step 1:** Apne Telegram group ya channel me @${botUsername} ko **Administrator** banayein.\n\n**Step 2:** Us group me ye message send karein:\n\`/linkgroup\`\n\n**Step 3:** Bot wahan ek 6-digit code dega (jaise \`A7XK92\`).\n\n**Step 4:** Wo code yahan private chat me send kijiye:\nJaise: \`A7XK92\` ya \`/connect A7XK92\`\n\nGroup turant aapke **My Groups** me add ho jayega!`;
      }

      replyMarkup = {
        inline_keyboard: [
          [{ text: '👥 View My Groups', callback_data: 'nav_my_groups' }],
          [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
        ],
      };
    } else if (data === 'nav_crosspost') {
      const allGroups = Array.from(dbGroups.values());
      if (dbCrossPosts.length === 0) {
        if (allGroups.length >= 2) {
          const gA = allGroups[0];
          const gB = allGroups[1];
          responseText =
            `🔄 **Cross-Posting Management**\n\nNo active cross-posting pipelines configured yet.\n\n` +
            `🔵 **Group A:** **${gA.title}** (\`${gA.id}\`)\n` +
            `🟢 **Group B:** **${gB.title}** (\`${gB.id}\`)\n\n` +
            `👉 **Aap aisa karo:** Niche diye gaye 1-click button par click karein aur in donon groups ke beech cross-posting turant activate karein:`;
          replyMarkup = {
            inline_keyboard: [
              [{ text: `⚡ 1-Click Connect: ${gA.title} ➔ ${gB.title}`, callback_data: `cp_connect_${gA.id}_${gB.id}` }],
              [{ text: `⚡ 1-Click Bidirectional: ${gA.title} ⇄ ${gB.title}`, callback_data: `cp_biconnect_${gA.id}_${gB.id}` }],
              [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
            ],
          };
        } else {
          responseText =
            `🔄 **Cross-Posting Management**\n\n` +
            `Abhi tak koi cross-posting pipeline active nahi hai.\n\n` +
            `👉 **Do Groups Ko Connect Karne Ke Liye (Aap aisa karo):**\n` +
            `1. Pehle Group A me \`/linkgroup\` bhejkar code lein.\n` +
            `2. Phir Group B me \`/linkgroup\` bhejkar code lein.\n` +
            `3. Donon groups connect hote hi cross-posting activate ho jayegi!`;
          replyMarkup = {
            inline_keyboard: [
              [{ text: '🔗 Connect Group Guide', callback_data: 'nav_connect_groups' }],
              [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
            ],
          };
        }
      } else {
        const pipelineList = dbCrossPosts
          .map((cp, idx) => {
            const gA = dbGroups.get(cp.groupAId)?.title || `Chat ${cp.groupAId}`;
            const gB = dbGroups.get(cp.groupBId)?.title || `Chat ${cp.groupBId}`;
            const dirSymbol = cp.direction === 'BIDIRECTIONAL' ? '⇄' : cp.direction === 'A_TO_B' ? '➔' : '⬅️';
            return `**#${idx + 1} Pipeline:**\n• **Route:** **${gA}** ${dirSymbol} **${gB}**\n• **Status:** ${
              cp.isActive ? '🟢 `ACTIVE & RUNNING`' : '⏸️ `PAUSED`'
            }\n• **Direction:** \`${cp.direction}\`\n• **Mode:** \`${
              cp.mode === 'COPY' ? 'Clean Copy' : 'Forward Header'
            }\``;
          })
          .join('\n\n');

        responseText =
          `🔄 **Active Cross-Posting Pipelines (${dbCrossPosts.length}):**\n\n${pipelineList}\n\n` +
          `👉 **Controls:** Niche diye gaye buttons se pipeline pause/resume karein, direction change karein, ya live test karein:`;

        const cpButtons: any[] = [];
        dbCrossPosts.forEach((cp) => {
          const dirLabel =
            cp.direction === 'BIDIRECTIONAL' ? '⇄ Bidirectional' : cp.direction === 'A_TO_B' ? '➔ A to B' : '⬅️ B to A';
          cpButtons.push([
            { text: cp.isActive ? '⏸️ Pause Pipeline' : '▶️ Resume Pipeline', callback_data: `cp_toggle_${cp.id}` },
            { text: `Direction: ${dirLabel}`, callback_data: `cp_dir_${cp.id}` },
          ]);
          cpButtons.push([
            { text: `Mode: ${cp.mode === 'COPY' ? 'Clean Copy' : 'Forward'}`, callback_data: `cp_mode_${cp.id}` },
            { text: '🧪 Send Test Cross-Post', callback_data: `cp_test_${cp.id}` },
          ]);
          cpButtons.push([
            { text: '🗑️ Delete Pipeline', callback_data: `cp_del_${cp.id}` },
          ]);
        });

        if (allGroups.length >= 2) {
          const gA = allGroups[0];
          const gB = allGroups[1];
          const alreadyLinked = dbCrossPosts.some(
            (c) => (c.groupAId === gA.id && c.groupBId === gB.id) || (c.groupAId === gB.id && c.groupBId === gA.id)
          );
          if (!alreadyLinked) {
            cpButtons.push([
              { text: `➕ Connect: ${gA.title} ⇄ ${gB.title}`, callback_data: `cp_biconnect_${gA.id}_${gB.id}` },
            ]);
          }
        }

        cpButtons.push([{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }]);
        replyMarkup = { inline_keyboard: cpButtons };
      }
    } else if (data?.startsWith('cp_toggle_')) {
      const cpId = Number(data.replace('cp_toggle_', ''));
      const cp = dbCrossPosts.find((c) => c.id === cpId);
      if (cp) {
        cp.isActive = !cp.isActive;
        saveDatabase();
        addLiveEvent('crosspost', `Cross-post pipeline "${cp.name}" ${cp.isActive ? 'resumed' : 'paused'}`);
        responseText = cp.isActive
          ? `▶️ **Pipeline Resumed:** \`${cp.name}\` is now ACTIVE.`
          : `⏸️ **Pipeline Paused:** \`${cp.name}\` is now PAUSED.`;
        replyMarkup = {
          inline_keyboard: [[{ text: '« Back to Cross-Posting', callback_data: 'nav_crosspost' }]],
        };
      }
    } else if (data?.startsWith('cp_dir_')) {
      const cpId = Number(data.replace('cp_dir_', ''));
      const cp = dbCrossPosts.find((c) => c.id === cpId);
      if (cp) {
        const nextDir =
          cp.direction === 'A_TO_B' ? 'BIDIRECTIONAL' : cp.direction === 'BIDIRECTIONAL' ? 'B_TO_A' : 'A_TO_B';
        cp.direction = nextDir;
        saveDatabase();
        addLiveEvent('crosspost', `Pipeline "${cp.name}" direction switched to ${nextDir}`);
        responseText = `🔄 **Direction Updated to:** \`${nextDir}\`\n\nPipeline **${cp.name}** routing direction updated successfully!`;
        replyMarkup = {
          inline_keyboard: [[{ text: '« Back to Cross-Posting', callback_data: 'nav_crosspost' }]],
        };
      }
    } else if (data?.startsWith('cp_mode_')) {
      const cpId = Number(data.replace('cp_mode_', ''));
      const cp = dbCrossPosts.find((c) => c.id === cpId);
      if (cp) {
        cp.mode = cp.mode === 'COPY' ? 'FORWARD' : 'COPY';
        saveDatabase();
        responseText = `🔄 **Mode Updated to:** \`${cp.mode === 'COPY' ? 'Clean Copy' : 'Forward Header'}\`\n\nPipeline **${cp.name}** transfer mode updated!`;
        replyMarkup = {
          inline_keyboard: [[{ text: '« Back to Cross-Posting', callback_data: 'nav_crosspost' }]],
        };
      }
    } else if (data?.startsWith('cp_del_')) {
      const cpId = Number(data.replace('cp_del_', ''));
      const idx = dbCrossPosts.findIndex((c) => c.id === cpId);
      if (idx !== -1) {
        const removed = dbCrossPosts.splice(idx, 1)[0];
        saveDatabase();
        addLiveEvent('crosspost', `Deleted pipeline "${removed.name}"`);
        responseText = `🗑️ **Pipeline Disconnected:** \`${removed.name}\` has been removed.`;
        replyMarkup = {
          inline_keyboard: [[{ text: '« Back to Cross-Posting', callback_data: 'nav_crosspost' }]],
        };
      }
    } else if (data?.startsWith('cp_test_')) {
      const cpId = Number(data.replace('cp_test_', ''));
      const cp = dbCrossPosts.find((c) => c.id === cpId);
      if (cp) {
        const srcId = cp.groupAId;
        const destId = cp.groupBId;
        const srcName = dbGroups.get(srcId)?.title || `Group A (${srcId})`;
        const destName = dbGroups.get(destId)?.title || `Group B (${destId})`;

        const testRes = await tgCall(token, 'sendMessage', {
          chat_id: srcId,
          text: `🧪 <b>[Cross-Post Test]</b> Hello from ${escapeHtml(srcName)}! Testing pipeline to ${escapeHtml(destName)}...`,
          parse_mode: 'HTML',
        });

        if (testRes.ok && testRes.result?.message_id) {
          const sentMsgId = testRes.result.message_id;
          botSentMessageIds.add(`${srcId}:${sentMsgId}`);

          const copyRes = await tgCall(token, 'copyMessage', {
            chat_id: destId,
            from_chat_id: srcId,
            message_id: sentMsgId,
          });

          if (copyRes.ok && copyRes.result?.message_id) {
            botSentMessageIds.add(`${destId}:${copyRes.result.message_id}`);
            addLiveEvent('crosspost', `🧪 Test cross-post verified: ${srcName} ➔ ${destName}`);
            responseText = `✅ **Cross-Post Test Succeeded!**\n\n• **Source:** **${srcName}**\n• **Destination:** **${destName}**\n• **Status:** Delivered & verified in Telegram!\n\nBoth groups are communicating properly.`;
          } else {
            addLiveEvent('error', `Test copy failed to ${destName}: ${copyRes.description}`);
            responseText = `⚠️ **Test message posted in Source, but copy to Destination failed:**\n\nError: \`${copyRes.description || 'Unknown error'}\`\n\n👉 **Tip:** Ensure @${botUsername} is an **Administrator** with "Post Messages" permission in **${destName}**!`;
          }
        } else {
          responseText = `⚠️ Could not post test message in Source group (**${srcName}**):\n\`${testRes.description || 'Permission error'}\`\n\nEnsure the bot has permission to post in that chat.`;
        }
        replyMarkup = {
          inline_keyboard: [[{ text: '« Back to Cross-Posting', callback_data: 'nav_crosspost' }]],
        };
      }
    } else if (data?.startsWith('cp_connect_') || data?.startsWith('cp_biconnect_')) {
      const isBi = data.startsWith('cp_biconnect_');
      const parts = data.replace(isBi ? 'cp_biconnect_' : 'cp_connect_', '').split('_');
      const g1Id = Number(parts[0]);
      const g2Id = Number(parts[1]);

      const gA = dbGroups.get(g1Id);
      const gB = dbGroups.get(g2Id);

      if (gA && gB && gA.id !== gB.id) {
        const existing = dbCrossPosts.find(
          (c) => (c.groupAId === gA.id && c.groupBId === gB.id) || (c.groupAId === gB.id && c.groupBId === gA.id)
        );
        if (existing) {
          existing.isActive = true;
          existing.direction = isBi ? 'BIDIRECTIONAL' : 'A_TO_B';
        } else {
          dbCrossPosts.push({
            id: Date.now(),
            name: `${gA.title} ⇄ ${gB.title}`,
            groupAId: gA.id,
            groupBId: gB.id,
            direction: isBi ? 'BIDIRECTIONAL' : 'A_TO_B',
            mode: 'COPY',
            isActive: true,
          });
        }
        saveDatabase();
        addLiveEvent('crosspost', `Connected ${gA.title} ⇄ ${gB.title} for cross-posting`);
        responseText = `✅ **Groups Connected for Cross-Posting!**\n\n• **Group A:** **${gA.title}**\n• **Group B:** **${gB.title}**\n• **Direction:** \`${isBi ? 'Bidirectional (A ⇄ B)' : 'A ➔ B'}\`\n• **Mode:** \`Clean Copy\`\n\n🎉 Pipeline is now ACTIVE and running with loop protection!`;
        replyMarkup = {
          inline_keyboard: [
            [{ text: '🔄 View Cross-Posting Menu', callback_data: 'nav_crosspost' }],
            [{ text: '🏠 Main Dashboard', callback_data: 'nav_main_menu' }],
          ],
        };
      }
    } else if (data === 'nav_welcome') {
      responseText =
        userLang === 'english'
          ? `👋 **Welcome & Goodbye System**\n\n• Automated greeting upon new member arrivals\n• Customizable tags: \`{first_name}\` & \`{group_name}\`\n• Configurable **auto-delete timer** (default 60s)\n• Custom clickable inline URL buttons\n\nConfigure welcome flows per group under **My Groups**.`
          : userLang === 'hindi'
          ? `👋 **वेलकम एवं अलविदा सिस्टम**\n\n• नए सदस्यों के जुड़ने पर स्वचालित स्वागत संदेश\n• कस्टम टैग्स: \`{first_name}\` एवं \`{group_name}\`\n• **ऑटो-डिलीट टाइमर:** 60 सेकंड\n• कस्टम इनलाइन यूआरएल बटन\n\nअपने ग्रुप के लिए वेलकम सेटिंग्स **My Groups** में सेट करें।`
          : userLang === 'marathi'
          ? `👋 **वेलकम सिस्टीम**\n\n• नवीन सदस्य आल्यावर आपोआप स्वागत मेसेज\n• टॅग्ज: \`{first_name}\` आणि \`{group_name}\`\n• **ऑटो-डिलीट टाइमर:** 60 सेकंद\n• कस्टम इनलाइन यूआरएल बटणे\n\nग्रुपच्या वेलकम सेटिंग्स **माझे ग्रुप्स** मध्ये बदला.`
          : `👋 **Welcome & Goodbye System**\n\n• Naye member aane par automated welcome message\n• Dynamic tags: \`{first_name}\`, \`{group_name}\`\n• **Auto-delete timer:** 60 seconds (chat clean rakhne ke liye)\n• Clickable custom URL buttons\n\nApne group ka welcome flow customize karne ke liye **My Groups** me jaiye.`;
      replyMarkup = {
        inline_keyboard: [
          [{ text: '👥 Open My Groups', callback_data: 'nav_my_groups' }],
          [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
        ],
      };
    } else if (data === 'nav_moderation') {
      responseText =
        userLang === 'english'
          ? `🛡️ **Group Moderation & Safety**\n\n**Available Group Commands:**\n• \`/warn [reason]\` — Warn replied user\n• \`/warnings\` — Check strike count\n• \`/resetwarn\` — Reset member warnings\n• \`/mute [10m|1h]\` — Mute user\n• \`/unmute\` — Restore chat privileges\n• \`/ban\` / \`/unban\` / \`/kick\`\n• \`/purge\` — Batch delete messages\n• \`/rules\` — Show group rules\n\nAdministrators and bot owners are automatically protected.`
          : userLang === 'hindi'
          ? `🛡️ **ग्रुप मॉडरेशन एवं सुरक्षा**\n\n**उपलब्ध कमांड्स:**\n• \`/warn [कारण]\` — यूजर को चेतावनी दें\n• \`/warnings\` — चेतावनी संख्या देखें\n• \`/resetwarn\` — चेतावनियाँ रीसेट करें\n• \`/mute [10m|1h]\` — यूजर को म्यूट करें\n• \`/unmute\` — बोलने की अनुमति दें\n• \`/ban\` / \`/unban\` / \`/kick\`\n• \`/rules\` — ग्रुप के नियम दिखाएं`
          : userLang === 'marathi'
          ? `🛡️ **ग्रुप मॉडरेशन व सुरक्षा**\n\n**उपलब्ध कमांड्स:**\n• \`/warn [कारण]\` — सदस्याला वॉर्निंग द्या\n• \`/warnings\` — वॉर्निंग संख्या तपासा\n• \`/resetwarn\` — वॉर्निंग रीसेट करा\n• \`/mute [10m|1h]\` — सदस्याला म्यूट करा\n• \`/unmute\` — म्यूट काढा\n• \`/ban\` / \`/unban\` / \`/kick\`\n• \`/rules\` — ग्रुपचे नियम दाखवा`
          : `🛡️ **Group Moderation & Safety**\n\n**Group me use hone wale commands:**\n• \`/warn [reason]\` — Member ko warning dein\n• \`/warnings\` — Strike count check karein\n• \`/resetwarn\` — Warnings reset karein\n• \`/mute [10m|1h]\` — Member ko mute karein\n• \`/unmute\` — Chat privileges wapas dein\n• \`/ban\` / \`/unban\` / \`/kick\`\n• \`/purge\` — Reply se purane messages delete karein\n• \`/rules\` — Group ke niyam dikhayein\n\nAdmin aur Bot Owner par ye actions apply nahi hote.`;
      replyMarkup = getBackKeyboard(userLang);
    } else if (data === 'nav_promotions') {
      responseText = `📢 **Promotion & Aesthetic Button Builder**\n\nCraft announcements with custom inline URL buttons and broadcast to your connected groups.\n\nType \`/promote\` in private chat to compose a broadcast post.`;
      replyMarkup = getBackKeyboard(userLang);
    } else if (data === 'nav_settings') {
      responseText = `⚙️ **Group Settings & Rules**\n\nManage flood limits, link protection, warning limits, and custom rules for each connected group.\n\nOpen **My Groups** to edit specific group settings.`;
      replyMarkup = {
        inline_keyboard: [
          [{ text: '👥 Open My Groups', callback_data: 'nav_my_groups' }],
          [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
        ],
      };
    } else if (data === 'nav_stats') {
      responseText = `📊 **Global Bot Statistics**\n\n• **Connected Groups/Channels:** \`${dbGroups.size}\`\n• **Active Cross-Post Pipelines:** \`${dbCrossPosts.filter((c) => c.isActive).length}\`\n• **Default Language:** \`${defaultBotLanguage}\`\n• **System Uptime:** \`Operational (24/7)\`\n• **Persistence Engine:** \`Active (.bot_db.json)\``;
      replyMarkup = getBackKeyboard(userLang);
    } else if (data === 'nav_logs') {
      responseText = `📋 **Recent Bot Activity Log**\n\n` + (liveEvents.slice(0, 6).map((e) => `• [${e.time}] ${e.details}`).join('\n') || 'No events yet.');
      replyMarkup = getBackKeyboard(userLang);
    } else if (data === 'nav_help') {
      responseText =
        userLang === 'english'
          ? `📚 **Help & Documentation Center**\n\n• \`/start\` — Open private dashboard\n• \`/language\` — Change language (Hinglish, English, Hindi, Marathi)\n• \`/linkgroup\` — Generate connection code (run in group/channel)\n• \`/connect <CODE>\` — Connect group in private chat\n• \`/connect <CODE_A> <CODE_B>\` — Connect 2 groups for cross-posting\n• \`/warn\` & \`/mute\` — Moderation commands\n• \`/rules\` — Display group rules`
          : userLang === 'hindi'
          ? `📚 **सहायता एवं कमांड सेंटर**\n\n• \`/start\` — प्राइवेट डैशबोर्ड खोलें\n• \`/language\` — भाषा बदलें\n• \`/linkgroup\` — ग्रुप/चैनल में कोड बनाएं\n• \`/connect <CODE>\` — प्राइवेट चैट में ग्रुप जोड़ें\n• \`/connect <CODE_A> <CODE_B>\` — क्रॉस-पोस्टिंग के लिए 2 ग्रुप्स जोड़ें\n• \`/warn\` एवं \`/mute\` — मॉडरेशन कमांड्स\n• \`/rules\` — ग्रुप नियम देखें`
          : userLang === 'marathi'
          ? `📚 **मदत आणि कमांड्स**\n\n• \`/start\` — खाजगी डॅशबोर्ड उघडा\n• \`/language\` — भाषा निवडा\n• \`/linkgroup\` — ग्रुप/चॅनेलमध्ये कोड तयार करा\n• \`/connect <CODE>\` — खाजगी चॅटमध्ये ग्रुप जोडा\n• \`/connect <CODE_A> <CODE_B>\` — क्रॉस-पोस्टिंगसाठी 2 ग्रुप्स जोडा\n• \`/warn\` आणि \`/mute\` — मॉडरेशन कमांड्स\n• \`/rules\` — ग्रुप नियम दाखवा`
          : `📚 **TeleGroup Help & Commands Center**\n\n• \`/start\` — Private dashboard open karein\n• \`/language\` — Bhasha change karein (Hinglish, English, हिन्दी, मराठी)\n• \`/linkgroup\` — Connection code generate karein (group/channel me run karein)\n• \`/connect <CODE>\` — Private chat me group link karein\n• \`/connect <CODE_A> <CODE_B>\` — Do groups ko cross-posting ke liye jodein\n• \`/warn\` & \`/mute\` — Moderation commands\n• \`/rules\` — Group rules show karein`;
      replyMarkup = getBackKeyboard(userLang);
    } else if (data === 'nav_status') {
      responseText = `🔍 **Bot Health & Status**\n\n• **Bot Username:** @${botUsername}\n• **Status:** 🟢 \`Operational (24/7)\`\n• **Groups in DB:** \`${dbGroups.size}\`\n• **Language Mode:** \`${userLang}\`\n• **Loop Guard:** 🟢 \`Active\`\n• **Channel Support:** 🟢 \`Active (channel_post)\``;
      replyMarkup = {
        inline_keyboard: [
          [{ text: '🔄 Refresh Status', callback_data: 'nav_status' }],
          [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
        ],
      };
    }

    // Always send a fresh message so user gets fresh screens with working Back button
    if (chatId) {
      await tgCall(token, 'sendMessage', {
        chat_id: chatId,
        text: responseText,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup,
      });
    }
    return;
  }

  // 2. Handle Messages & Channel Posts
  const msg = update.message || update.channel_post || update.edited_message || update.edited_channel_post;
  if (!msg) return;

  const chat = msg.chat;

  // Anti-loop safeguard: Ignore messages posted by the bot itself!
  if (botSentMessageIds.has(`${chat.id}:${msg.message_id}`)) {
    return;
  }
  if (msg.from?.id === verifiedBotInfo?.id) {
    return;
  }

  // In channels, msg.from is undefined! Fallback safely to sender_chat or chat info:
  const user = msg.from || {
    id: msg.sender_chat?.id || chat.id,
    first_name: chat.title || 'Admin',
    username: chat.username || '',
  };

  const text = (msg.text || msg.caption || '').trim();
  const isPrivate = chat.type === 'private';
  const isGroupOrChannel = chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel';
  const userLang = getUserLang(user.id);

  // A. Handle New Members Joining Group (Welcome Flow)
  if (msg.new_chat_members && msg.new_chat_members.length > 0) {
    const botJoined = msg.new_chat_members.some((m: any) => m.id === verifiedBotInfo?.id);
    if (botJoined) {
      dbGroups.set(chat.id, {
        id: chat.id,
        tgChatId: chat.id,
        title: chat.title || `Chat ${chat.id}`,
        type: chat.type,
        warnLimit: 3,
        warnAction: 'mute',
        rulesText: '1. Be respectful\n2. No spam\n3. Constructive discussions only.',
        welcomeEnabled: true,
        welcomeDeleteSeconds: 60,
        blockLinks: false,
        floodLimit: 5,
        createdAt: new Date().toISOString(),
      });
      saveDatabase();
      addLiveEvent('system', `Bot added to: "${chat.title}"`);

      const joinText = `🎉 **TeleGroup Bot Successfully Added to ${chat.title || 'this chat'}!**\n\n👉 **Aap aisa karo (How to connect):**\n1. Bot ko is group me **Administrator** banayein.\n2. Ye command send karein:\n\`/linkgroup\`\n\nBot turant 6-digit code dega jo aap private chat me submit kar sakte hain!`;

      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: joinText,
        parse_mode: 'Markdown',
      });
      return;
    }

    for (const newMember of msg.new_chat_members) {
      if (newMember.id === verifiedBotInfo?.id || newMember.is_bot) continue;
      await handleNewMemberWelcome(token, chat, newMember);
    }
    return;
  }

  // B. Handle Private Chat Messages
  if (isPrivate) {
    addLiveEvent('incoming_message', `Private: "${text}" from @${user.username || user.first_name}`);

    // Command: /language or /lang
    if (text.startsWith('/language') || text.startsWith('/lang')) {
      const langPrompt = `🌐 **Language Settings / अपनी भाषा चुनें:**\n\nCurrent language: **${userLang.toUpperCase()}**\n\n👉 **Aap aisa karo:** Apni pasandida bhasha choose karein:`;
      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: langPrompt,
        parse_mode: 'Markdown',
        reply_markup: getLanguageKeyboard(userLang),
      });
      return;
    }

    // Command: /start (supports deep-linking /start connect_CODE)
    if (text.startsWith('/start')) {
      const startParam = text.split(/\s+/)[1];

      // Deep-linked connection code: /start connect_A7XK92
      if (startParam && startParam.startsWith('connect_')) {
        const rawCode = startParam.replace('connect_', '').trim().toUpperCase();
        const codeRecord = dbLinkCodes.find((c) => c.code === rawCode && !c.isUsed && c.expiresAt > Date.now());

        if (codeRecord) {
          codeRecord.isUsed = true;
          codeRecord.usedByUserId = user.id;

          const grp = dbGroups.get(codeRecord.groupId);
          if (grp) {
            grp.ownerUserId = user.id;
          }
          saveDatabase();

          addLiveEvent('system', `Group "${codeRecord.groupTitle}" connected to @${user.username || user.first_name}`);

          const successText =
            userLang === 'english'
              ? `✅ **Group Connected Successfully!**\n\n• **Title:** **${codeRecord.groupTitle}**\n• **Chat ID:** \`${codeRecord.groupId}\`\n• **Type:** \`${codeRecord.groupType}\`\n• **Authorized Admin:** @${user.username || user.first_name}\n\nThis group is now added to your **My Groups** dashboard!`
              : userLang === 'hindi'
              ? `✅ **ग्रुप सफलतापूर्वक कनेक्ट हो गया!**\n\n• **नाम:** **${codeRecord.groupTitle}**\n• **चैट ID:** \`${codeRecord.groupId}\`\n• **प्रकार:** \`${codeRecord.groupType}\`\n• **प्रशासक:** @${user.username || user.first_name}\n\nयह ग्रुप अब आपके **My Groups** डैशबोर्ड में जुड़ गया है!`
              : userLang === 'marathi'
              ? `✅ **ग्रुप यशस्वीरीत्या जोडला गेला!**\n\n• **नाव:** **${codeRecord.groupTitle}**\n• **चॅट ID:** \`${codeRecord.groupId}\`\n• **प्रकार:** \`${codeRecord.groupType}\`\n• **प्रशासक:** @${user.username || user.first_name}\n\nहा ग्रुप आता तुमच्या **माझे ग्रुप्स** डॅशबोर्डमध्ये जोडला गेला आहे!`
              : `✅ **Group Successfully Connect Ho Gaya!**\n\n• **Title:** **${codeRecord.groupTitle}**\n• **Chat ID:** \`${codeRecord.groupId}\`\n• **Type:** \`${codeRecord.groupType}\`\n• **Authorized Admin:** @${user.username || user.first_name}\n\n🎉 Ye group ab aapke **My Groups** dashboard me add ho gaya hai!`;

          await tgCall(token, 'sendMessage', {
            chat_id: chat.id,
            text: successText,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '👥 Open My Groups', callback_data: 'nav_my_groups' }],
                [{ text: '🏠 Main Dashboard', callback_data: 'nav_main_menu' }],
              ],
            },
          });
          return;
        }
      }

      // Normal /start welcome in chosen language (Default: Hinglish)
      let welcomeText = '';
      if (userLang === 'english') {
        welcomeText = `👋 **Welcome, ${user.first_name}!**\n\n**TeleGroup Studio & Bot Control Hub**\nManage multiple Telegram groups securely from this private chat without executing manual commands in each group.\n\n✨ **Key Features:**\n• 🔗 **Connect Groups:** Link groups using single-use 6-digit codes\n• 🔄 **Cross-Posting:** Mirror messages between groups with anti-loop guards\n• 👋 **Welcome System:** Auto greeting with 60s auto-delete timer\n• 🛡️ **Moderation:** /warn, /mute, /ban and anti-flood filters\n• 🌐 **Multi-Language:** Hinglish, English, Hindi, Marathi\n\nChoose an option below to get started:`;
      } else if (userLang === 'hindi') {
        welcomeText = `👋 **नमस्ते, ${user.first_name}!**\n\n**TeleGroup Studio & Bot Control Hub**\nग्रुप में बार-बार कमांड चलाए बिना, इस प्राइवेट चैट से अपने सभी ग्रुप्स को आसानी से मैनेज करें!\n\n✨ **मुख्य फीचर्स:**\n• 🔗 **ग्रुप जोड़ें:** सिंगल-यूज कोड से आसानी से ग्रुप लिंक करें\n• 🔄 **क्रॉस-पोस्टिंग:** एक ग्रुप से दूसरे ग्रुप में मैसेज ऑटो-कॉपी करें\n• 👋 **वेलकम सिस्टम:** नए मेंबर्स का स्वागत और 60s ऑटो-डिलीट टाइमर\n• 🛡️ **मॉडरेशन:** चेतावनी, म्यूट, बैन और स्पैम प्रोटेक्शन\n• 🌐 **भाषा विकल्प:** हिंग्लिश, इंग्लिश, हिन्दी, मराठी\n\nशुरू करने के लिए नीचे दिए गए बटन पर क्लिक करें:`;
      } else if (userLang === 'marathi') {
        welcomeText = `👋 **नमस्कार, ${user.first_name}!**\n\n**TeleGroup Studio & Bot Control Hub**\nप्रत्येक ग्रुपमध्ये कमांड न टाकता या खाजगी चॅटमधून सर्व ग्रुप्सचे नियंत्रण आणि क्रॉस-पोस्टिंग करा!\n\n✨ **प्रमुख वैशिष्ट्ये:**\n• 🔗 **ग्रुप जोडा:** सिंगल-यूज कोडने ग्रुप लिंक करा\n• 🔄 **क्रॉस-पोस्टिंग:** एका ग्रुपमधील मेसेज दुसऱ्या ग्रुपमध्ये आपोआप पाठवा\n• 👋 **वेलकम सिस्टीम:** नवीन सदस्यांचे स्वागत व 60 सेकंदात मेसेज डिलीट\n• 🛡️ **मॉडरेशन:** वॉर्निंग, म्यूट, बॅन व स्पॅम नियंत्रण\n• 🌐 **भाषा पर्याय:** हिंग्लिश, इंग्रजी, हिंदी, मराठी\n\nसुरू करण्यासाठी खालील बटणांवर क्लिक करा:`;
      } else {
        // Hinglish: "Aap aisa karo, connect karo..."
        welcomeText = `👋 **Namaste, ${user.first_name}!**\n\n**TeleGroup Studio & Bot Control Hub**\nAap yahan private chat se apne saare Telegram groups aur channels ko manage aur cross-post kar sakte hain, bina group me commands run kiye!\n\n✨ **Main Features:**\n• 🔗 **Connect Groups:** Single-use code se group link karo\n• 🔄 **Cross-Posting:** Group A ka message Group B me auto-copy/forward\n• 👋 **Welcome Message:** Naye members ka custom swagat + 60s auto-delete\n• 🛡️ **Moderation:** Warnings, mute, ban aur anti-spam protection\n• 🌐 **Language:** Hinglish, English, हिन्दी, मराठी support\n\n👉 **Aap aisa karo:** Niche diye gaye menu buttons me se koi bhi option choose karein:`;
      }

      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: welcomeText,
        parse_mode: 'Markdown',
        reply_markup: getMainMenuKeyboard(userLang),
      });
      return;
    }

    // Helper: If user types /linkgroup in private chat, give exact guidance in Hinglish
    if (text.startsWith('/linkgroup') || text.toLowerCase().trim() === 'linkgroup') {
      const linkgroupNotice =
        userLang === 'english'
          ? `⚠️ **Important Notice:**\n\nThe \`/linkgroup\` command must be run inside your **Telegram Group or Channel**, not in this private chat!\n\n**How to connect:**\n1. Go to your Telegram group or channel.\n2. Add @${botUsername} as an **Administrator**.\n3. Send this command in that chat:\n   \`/linkgroup\`\n4. The bot will generate a 6-character code (e.g. \`A7XK92\`).\n5. Copy and send that code here in private chat!`
          : userLang === 'hindi'
          ? `⚠️ **ध्यान दें:**\n\n\`/linkgroup\` कमांड आपको अपने **Telegram Group या Channel** में भेजनी है, यहाँ प्राइवेट चैट में नहीं!\n\n👉 **ग्रुप कैसे जोड़ें:**\n1. अपने टेलीग्राम ग्रुप या चैनल में जाएं।\n2. वहां @${botUsername} को **Administrator** बनाएं।\n3. उस ग्रुप में यह मैसेज भेजें: \`/linkgroup\`\n4. बॉट वहां एक 6-अक्षरों का कोड देगा (जैसे \`A7XK92\`)।\n5. वह कोड कॉपी करके यहाँ प्राइवेट चैट में भेजें!`
          : userLang === 'marathi'
          ? `⚠️ **महत्त्वाची सूचना:**\n\n\`/linkgroup\` हा कमांड तुम्हाला तुमच्या **Telegram Group किंवा Channel** मध्ये पाठवायचा आहे, येथे खाजगी चॅटमध्ये नाही!\n\n👉 **कसे जोडावे:**\n1. तुमच्या Telegram ग्रुप किंवा चॅनेलमध्ये जा.\n2. तेथे @${botUsername} ला **Administrator** बनवा.\n3. त्या चॅटमध्ये हा मेसेज पाठवा: \`/linkgroup\`\n4. बॉट तेथे लगेच 6-अक्षरी कोड देईल (उदा. \`A7XK92\`).\n5. तो कोड कॉपी करून येथे खाजगी चॅटमध्ये पाठवा!`
          : `⚠️ **Dhyan dein (Important Note):**\n\n\`/linkgroup\` command aapko apne **Telegram Group ya Channel** me bhejni hoti hai, yahan private chat me nahi!\n\n👉 **Aap aisa karo:**\n1. Apne Telegram group ya channel me jaiye.\n2. Wahan @${botUsername} ko **Administrator** banayein.\n3. Us group me message send karein:\n   \`/linkgroup\`\n4. Bot wahan ek 6-digit code dega (jaise \`A7XK92\`).\n5. Wo code copy karke yahan private chat me bhej dijiye!`;

      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: linkgroupNotice,
        parse_mode: 'Markdown',
        reply_markup: getBackKeyboard(userLang),
      });
      return;
    }

    if (text.startsWith('/help')) {
      const helpText =
        userLang === 'english'
          ? `📚 **TeleGroup Interactive Help Center**\n\nSelect a topic below for detailed instructions, commands, syntax, and troubleshooting:`
          : userLang === 'hindi'
          ? `📚 **TeleGroup सहायता एवं कमांड सेंटर**\n\nविस्तृत जानकारी के लिए नीचे दिए गए विकल्प चुनें:`
          : userLang === 'marathi'
          ? `📚 **TeleGroup मदत आणि माहिती**\n\nमाहितीसाठी खालील पर्याय निवडा:`
          : `📚 **TeleGroup Help Center (Aap aisa karo)**\n\nNiche diye gaye topic par click karein aur guides check karein:`;

      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: helpText,
        parse_mode: 'Markdown',
        reply_markup: getMainMenuKeyboard(userLang),
      });
      return;
    }

    // Checking Connection Code(s)
    const upperText = text.toUpperCase().trim();
    let codeParts: string[] = [];

    if (text.startsWith('/connect') || text.startsWith('/link')) {
      codeParts = text.split(/\s+/).slice(1).map((s: string) => s.trim().toUpperCase());
    } else if (/^[A-Z0-9]{5,8}$/.test(upperText)) {
      // Direct raw code!
      codeParts = [upperText];
    }

    if ((text.startsWith('/connect') || text.startsWith('/link')) && codeParts.length === 0) {
      if (dbCrossPosts.length > 0) {
        const cp = dbCrossPosts[0];
        await tgCall(token, 'sendMessage', {
          chat_id: chat.id,
          text: `✅ **Already Connected**\n\nBoth groups are already connected for cross-posting:\n• **Pipeline:** **${cp.name}**\n• **Status:** ${cp.isActive ? '🟢 Active' : '⏸️ Paused'}\n• **Direction:** \`${cp.direction}\`\n\nYou can manage or disconnect this connection from the dashboard:`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Manage Cross-Posting', callback_data: 'nav_crosspost' }],
              [{ text: '🏠 Main Dashboard', callback_data: 'nav_main_menu' }],
            ],
          },
        });
        return;
      }

      const allGrps = Array.from(dbGroups.values());
      if (allGrps.length >= 2) {
        const gA = allGrps[0];
        const gB = allGrps[1];
        await tgCall(token, 'sendMessage', {
          chat_id: chat.id,
          text: `🔗 **Connect Groups for Cross-Posting**\n\nFound 2 registered groups in your account:\n🔵 **Group A:** **${gA.title}**\n🟢 **Group B:** **${gB.title}**\n\n👉 **Aap aisa karo:** Niche diye gaye button par click karke cross-posting connect karein:`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `⚡ Connect: ${gA.title} ⇄ ${gB.title}`, callback_data: `cp_biconnect_${gA.id}_${gB.id}` }],
              [{ text: '« Back to Dashboard', callback_data: 'nav_main_menu' }],
            ],
          },
        });
        return;
      }
    }

    if (codeParts.length === 1) {
      const code = codeParts[0];
      const match = dbLinkCodes.find((c) => c.code === code && !c.isUsed && c.expiresAt > Date.now());

      if (!match) {
        const invalidText =
          userLang === 'english'
            ? `❌ **Invalid or Expired Code (\`${code}\`)**\n\nThis connection code is invalid, expired, or already used.\n\nGenerate a fresh single-use code by typing \`/linkgroup\` in your group/channel.`
            : userLang === 'hindi'
            ? `❌ **अमान्य या समाप्त कोड (\`${code}\`)**\n\nयह कोड अमान्य है, समाप्त हो चुका है, या पहले ही उपयोग किया जा चुका है।\n\n👉 **आप ऐसा करें:** ग्रुप में दोबारा \`/linkgroup\` भेजें और नया कोड यहाँ दर्ज करें।`
            : userLang === 'marathi'
            ? `❌ **अवैध किंवा कालबाह्य कोड (\`${code}\`)**\n\nहा कोड अवैध, कालबाह्य झाला आहे किंवा आधीच वापरला गेला आहे.\n\n👉 **पुढील कृती:** ग्रुपमध्ये पुन्हा \`/linkgroup\` पाठवून नवीन कोड मिळवा.`
            : `❌ **Invalid ya Expired Code (\`${code}\`)**\n\nYe code galat hai, expire ho chuka hai, ya pehle se use ho chuka hai.\n\n👉 **Aap aisa karo:** Apne group me jaakar dobara \`/linkgroup\` run karein aur naya code yahan bhejein.`;

        await tgCall(token, 'sendMessage', {
          chat_id: chat.id,
          text: invalidText,
          parse_mode: 'Markdown',
        });
        return;
      }

      match.isUsed = true;
      match.usedByUserId = user.id;

      const grp = dbGroups.get(match.groupId);
      if (grp) {
        grp.ownerUserId = user.id;
      }
      saveDatabase();

      addLiveEvent('system', `Group "${match.groupTitle}" connected by @${user.username || user.first_name}`);

      const connSuccessText =
        userLang === 'english'
          ? `✅ **Group Connected Successfully!**\n\n• **Title:** **${match.groupTitle}**\n• **Chat ID:** \`${match.groupId}\`\n• **Type:** \`${match.groupType}\`\n• **Authorized Admin:** @${user.username || user.first_name}\n\nThis group is now linked to your **My Groups** dashboard!`
          : userLang === 'hindi'
          ? `✅ **ग्रुप सफलतापूर्वक कनेक्ट हो गया!**\n\n• **नाम:** **${match.groupTitle}**\n• **चैट ID:** \`${match.groupId}\`\n• **प्रकार:** \`${match.groupType}\`\n• **प्रशासक:** @${user.username || user.first_name}\n\nयह ग्रुप अब आपके **My Groups** डैशबोर्ड में जुड़ गया है!`
          : userLang === 'marathi'
          ? `✅ **ग्रुप यशस्वीरीत्या जोडला गेला!**\n\n• **नाव:** **${match.groupTitle}**\n• **चॅट ID:** \`${match.groupId}\`\n• **प्रकार:** \`${match.groupType}\`\n• **प्रशासक:** @${user.username || user.first_name}\n\nहा ग्रुप आता तुमच्या **माझे ग्रुप्स** डॅशबोर्डमध्ये जोडला गेला आहे!`
          : `✅ **Group Successfully Connect Ho Gaya!**\n\n• **Title:** **${match.groupTitle}**\n• **Chat ID:** \`${match.groupId}\`\n• **Type:** \`${match.groupType}\`\n• **Authorized Admin:** @${user.username || user.first_name}\n\n🎉 Ye group ab aapke **My Groups** dashboard me add ho gaya hai! Aap yahan se iski saari settings control kar sakte hain.`;

      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: connSuccessText,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👥 Open My Groups', callback_data: 'nav_my_groups' }],
            [{ text: '🔄 Connect Another for Cross-Posting', callback_data: 'nav_connect_groups' }],
            [{ text: '🏠 Main Dashboard', callback_data: 'nav_main_menu' }],
          ],
        },
      });
      return;
    }

    if (codeParts.length >= 2) {
      const codeA = codeParts[0];
      const codeB = codeParts[1];

      const matchA = dbLinkCodes.find((c) => c.code === codeA && !c.isUsed && c.expiresAt > Date.now());
      const matchB = dbLinkCodes.find((c) => c.code === codeB && !c.isUsed && c.expiresAt > Date.now());

      if (!matchA || !matchB) {
        await tgCall(token, 'sendMessage', {
          chat_id: chat.id,
          text: `❌ One or both codes (\`${codeA}\`, \`${codeB}\`) are invalid, expired, or already used.\n\nGenerate fresh single-use codes by typing \`/linkgroup\` in both groups.`,
          parse_mode: 'Markdown',
        });
        return;
      }

      if (matchA.groupId === matchB.groupId) {
        await tgCall(token, 'sendMessage', {
          chat_id: chat.id,
          text: `⚠️ Cannot connect a group to itself! Please select two distinct groups.`,
          parse_mode: 'Markdown',
        });
        return;
      }

      matchA.isUsed = true;
      matchA.usedByUserId = user.id;
      matchB.isUsed = true;
      matchB.usedByUserId = user.id;

      const grpA = dbGroups.get(matchA.groupId);
      if (grpA) grpA.ownerUserId = user.id;
      const grpB = dbGroups.get(matchB.groupId);
      if (grpB) grpB.ownerUserId = user.id;

      const newConn: DBCrossPost = {
        id: Date.now(),
        name: `${matchA.groupTitle} ⇄ ${matchB.groupTitle}`,
        groupAId: matchA.groupId,
        groupBId: matchB.groupId,
        direction: 'A_TO_B',
        mode: 'COPY',
        isActive: true,
      };
      dbCrossPosts.push(newConn);
      saveDatabase();

      addLiveEvent('system', `Groups linked for cross-posting: "${matchA.groupTitle}" ⇄ "${matchB.groupTitle}"`);

      const crossSuccessText =
        userLang === 'english'
          ? `✅ **Groups Connected for Cross-Posting!**\n\n• **Source (A):** \`${matchA.groupTitle}\`\n• **Destination (B):** \`${matchB.groupTitle}\`\n• **Direction:** \`Group A → Group B\`\n• **Mode:** \`Clean Copy\`\n\nCodes \`${codeA}\` and \`${codeB}\` have been verified. Cross-posting is now active!`
          : userLang === 'hindi'
          ? `✅ **क्रॉस-पोस्टिंग के लिए ग्रुप्स कनेक्ट हो गए!**\n\n• **सोर्स (A):** \`${matchA.groupTitle}\`\n• **डेस्टिनेशन (B):** \`${matchB.groupTitle}\`\n• **दिशा:** \`Group A → Group B\`\n• **मोड:** \`Clean Copy\`\n\nअब ग्रुप A का संदेश अपने-आप ग्रुप B में क्रॉस-पोस्ट होगा!`
          : userLang === 'marathi'
          ? `✅ **क्रॉस-पोस्टिंगसाठी ग्रुप्स जोडले गेले!**\n\n• **सोर्स (A):** \`${matchA.groupTitle}\`\n• **डेस्टिनेशन (B):** \`${matchB.groupTitle}\`\n• **दिशा:** \`Group A → Group B\`\n• **मोड:** \`Clean Copy\`\n\nदोन्ही ग्रुप्स जोडले गेले असून क्रॉस-पोस्टिंग सुरू झाले आहे!`
          : `✅ **Cross-Posting Ke Liye Groups Connect Ho Gaye!**\n\n• **Source Group (A):** \`${matchA.groupTitle}\`\n• **Destination Group (B):** \`${matchB.groupTitle}\`\n• **Direction:** \`Group A → Group B\`\n• **Mode:** \`Clean Copy (No forward label)\`\n\n🎉 Ab Group A ka koi bhi message automatically Group B me post hoga anti-loop protection ke saath!`;

      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: crossSuccessText,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Configure Cross-Posting', callback_data: 'nav_crosspost' }],
            [{ text: '👥 Open My Groups', callback_data: 'nav_my_groups' }],
            [{ text: '« Back to Dashboard', callback_data: 'nav_main_menu' }],
          ],
        },
      });
      return;
    }

    // Default private chat fallback
    await tgCall(token, 'sendMessage', {
      chat_id: chat.id,
      text: `🤖 Command received: "${text}"\n\n👉 **Aap aisa karo:** Niche diye gaye menu buttons se apne groups manage karein:`,
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard(userLang),
    });
    return;
  }

  // C. Handle Group & Channel Messages
  if (isGroupOrChannel) {
    addLiveEvent('incoming_message', `${chat.type} "${chat.title || chat.id}": "${text}" from @${user.username || user.first_name || 'Admin'}`);

    // Register or update group/channel in database
    if (!dbGroups.has(chat.id)) {
      const gType = chat.type === 'channel' ? 'channel' : chat.type === 'supergroup' ? 'supergroup' : 'group';
      dbGroups.set(chat.id, {
        id: chat.id,
        tgChatId: chat.id,
        title: chat.title || `Chat ${chat.id}`,
        type: gType,
        warnLimit: 3,
        warnAction: 'mute',
        rulesText: '1. Be respectful\n2. No spam\n3. Constructive discussions only.',
        welcomeEnabled: true,
        welcomeDeleteSeconds: 60,
        blockLinks: false,
        floodLimit: 5,
        createdAt: new Date().toISOString(),
      });
      saveDatabase();
    }

    const lowerText = text.toLowerCase().trim();
    const firstWord = lowerText.split(/\s+/)[0];
    const isLinkGroupCmd =
      firstWord.startsWith('/linkgroup') ||
      firstWord.startsWith('/link') ||
      lowerText === 'linkgroup' ||
      lowerText === 'link group';

    // 1. /linkgroup command in group or channel
    if (isLinkGroupCmd) {
      const code = generateCode(6);
      dbLinkCodes.push({
        code,
        groupId: chat.id,
        groupTitle: chat.title || 'Chat',
        groupType: chat.type,
        generatedByUserId: user.id,
        expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes expiry
        isUsed: false,
        usedByUserId: null,
      });
      saveDatabase();

      addLiveEvent('system', `Code ${code} generated for "${chat.title}"`);

      // Conversational Hinglish response with clear next steps: "Aap aisa karo..."
      const replyText = `🔐 **Connection Code Generated! (Code Generate Ho Gaya)**\n\nCode: \`${code}\`\nChat: **${chat.title}**\nValid for: \`15 minutes\` (Single-use)\n\n👉 **Aap aisa karo (Next Steps):**\n1. Bot ke private chat me jaiye: @${botUsername}\n2. Wahan ye code send karein:\n\`${code}\`\n(Ya click karein: /connect ${code})\n\nAapka group turant private dashboard me add ho jayega!`;

      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: replyText,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Open Bot Private Chat (प्राइवेट चैट खोलो) ↗️', url: `https://t.me/${botUsername}?start=connect_${code}` }],
          ],
        },
      });
      return;
    }

    // 1.5. /testwelcome command (Test welcome message + 60s auto-delete timer)
    if (firstWord.startsWith('/testwelcome') || lowerText === 'testwelcome') {
      const deleteSeconds = dbGroups.get(chat.id)?.welcomeDeleteSeconds || 60;
      const testName = escapeHtml(user.first_name || 'Member');
      const testChatTitle = escapeHtml(chat.title || 'Group');
      const testMsg = `👋 <b>Welcome to ${testChatTitle}, <a href="tg://user?id=${user.id}">${testName}</a>!</b>\n\n🎉 <i>[Welcome System Active Test]</i>\nWelcome to our community! Please follow group rules.\n\n<i>⏱️ (Auto-deleting in ${deleteSeconds}s to keep chat clean)</i>`;
      const sent = await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: testMsg,
        parse_mode: 'HTML',
      });
      if (sent.ok && sent.result?.message_id) {
        const sentId = sent.result.message_id;
        botSentMessageIds.add(`${chat.id}:${sentId}`);
        addLiveEvent('welcome', `🧪 Test welcome message sent in "${chat.title}" (auto-delete in ${deleteSeconds}s)`);
        setTimeout(async () => {
          const delRes = await tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: sentId });
          if (delRes.ok) {
            addLiveEvent('welcome', `🧹 Auto-deleted test welcome message in "${chat.title}"`);
          }
        }, deleteSeconds * 1000);
      }
      return;
    }

    // 2. /rules command
    if (firstWord.startsWith('/rules') || lowerText === 'rules') {
      const g = dbGroups.get(chat.id);
      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: `📜 **Rules for ${chat.title}:**\n\n${g?.rulesText || 'Be respectful and follow community guidelines.'}`,
        parse_mode: 'Markdown',
      });
      return;
    }

    // 3. /warn command (groups only)
    if (firstWord.startsWith('/warn')) {
      const replyTarget = msg.reply_to_message?.from;
      if (!replyTarget) {
        await tgCall(token, 'sendMessage', {
          chat_id: chat.id,
          text: `⚠️ Please reply to the user's message that you wish to warn.\nExample: Reply with \`/warn Spamming\``,
          parse_mode: 'Markdown',
        });
        return;
      }

      const warnKey = `${chat.id}:${replyTarget.id}`;
      const currentWarns = (dbWarnings.get(warnKey) || 0) + 1;
      dbWarnings.set(warnKey, currentWarns);

      const reason = text.split(/\s+/).slice(1).join(' ') || 'Rule violation';
      const limit = 3;

      addLiveEvent('moderation', `Warned ${replyTarget.first_name} (${currentWarns}/${limit}) in ${chat.title}`);

      if (currentWarns >= limit) {
        const until = Math.floor(Date.now() / 1000) + 3600;
        await tgCall(token, 'restrictChatMember', {
          chat_id: chat.id,
          user_id: replyTarget.id,
          permissions: { can_send_messages: false },
          until_date: until,
        });
        dbWarnings.delete(warnKey);

        await tgCall(token, 'sendMessage', {
          chat_id: chat.id,
          text: `⚠️ **Warning Issued (${currentWarns}/${limit})**\n\n• **User:** [${replyTarget.first_name}](tg://user?id=${replyTarget.id})\n• **Reason:** ${reason}\n• **Threshold Reached:** Member has been temporarily **MUTED** for 1 hour.`,
          parse_mode: 'Markdown',
        });
      } else {
        await tgCall(token, 'sendMessage', {
          chat_id: chat.id,
          text: `⚠️ **Warning Issued (${currentWarns}/${limit})**\n\n• **User:** [${replyTarget.first_name}](tg://user?id=${replyTarget.id})\n• **Reason:** ${reason}\n• \`${limit - currentWarns}\` more warning(s) until punishment.`,
          parse_mode: 'Markdown',
        });
      }
      return;
    }

    // 4. /mute command
    if (firstWord.startsWith('/mute')) {
      const replyTarget = msg.reply_to_message?.from;
      if (!replyTarget) {
        await tgCall(token, 'sendMessage', {
          chat_id: chat.id,
          text: `⚠️ Reply to a member's message with \`/mute\` to restrict them.`,
          parse_mode: 'Markdown',
        });
        return;
      }

      const until = Math.floor(Date.now() / 1000) + 3600;
      await tgCall(token, 'restrictChatMember', {
        chat_id: chat.id,
        user_id: replyTarget.id,
        permissions: { can_send_messages: false },
        until_date: until,
      });

      addLiveEvent('moderation', `Muted ${replyTarget.first_name} in ${chat.title}`);

      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: `🤐 [${replyTarget.first_name}](tg://user?id=${replyTarget.id}) has been muted for 60 minutes.`,
        parse_mode: 'Markdown',
      });
      return;
    }

    // 5. Cross-Posting Engine (For all eligible non-command messages)
    if (!text.startsWith('/')) {
      const sourceChatId = chat.id;
      const msgId = msg.message_id;

      const matchingConns = dbCrossPosts.filter((cp) => {
        if (!cp.isActive) return false;
        if (String(sourceChatId) === String(cp.groupAId) && (cp.direction === 'A_TO_B' || cp.direction === 'BIDIRECTIONAL')) return true;
        if (String(sourceChatId) === String(cp.groupBId) && (cp.direction === 'B_TO_A' || cp.direction === 'BIDIRECTIONAL')) return true;
        return false;
      });

      for (const conn of matchingConns) {
        const destChatId = String(sourceChatId) === String(conn.groupAId) ? conn.groupBId : conn.groupAId;
        const dedupKey = `${sourceChatId}:${destChatId}:${msgId}`;

        if (processedMsgMap.has(dedupKey)) continue;
        processedMsgMap.add(dedupKey);

        const destTitle = dbGroups.get(destChatId)?.title || `Chat ${destChatId}`;

        try {
          let res: any;
          if (conn.mode === 'COPY') {
            res = await tgCall(token, 'copyMessage', {
              chat_id: destChatId,
              from_chat_id: sourceChatId,
              message_id: msgId,
            });
            if (!res.ok) {
              console.warn(`copyMessage failed (${res.description}), attempting forwardMessage fallback...`);
              res = await tgCall(token, 'forwardMessage', {
                chat_id: destChatId,
                from_chat_id: sourceChatId,
                message_id: msgId,
              });
            }
          } else {
            res = await tgCall(token, 'forwardMessage', {
              chat_id: destChatId,
              from_chat_id: sourceChatId,
              message_id: msgId,
            });
            if (!res.ok) {
              res = await tgCall(token, 'copyMessage', {
                chat_id: destChatId,
                from_chat_id: sourceChatId,
                message_id: msgId,
              });
            }
          }

          if (res.ok && res.result?.message_id) {
            const newMsgId = res.result.message_id;
            botSentMessageIds.add(`${destChatId}:${newMsgId}`);
            processedMsgMap.add(`${destChatId}:${sourceChatId}:${newMsgId}`);
            addLiveEvent('crosspost', `✅ Cross-posted message #${msgId} from "${chat.title || sourceChatId}" to "${destTitle}"`);
          } else {
            addLiveEvent('error', `❌ Cross-post to "${destTitle}" failed: ${res.description || 'Unknown error'}`);
          }
        } catch (e: any) {
          console.error('Failed to cross-post message:', e.message);
          addLiveEvent('error', `❌ Cross-post exception: ${e.message}`);
        }
      }
    }
  }
}

// Auto-start polling if token is already configured
if (activeBotToken) {
  runTelegramPoller(activeBotToken).catch((err) => {
    console.error('Initial Telegram poller failed:', err);
  });
}

// REST API ENDPOINTS

// 1. Activate Bot with Token
app.post('/api/telegram/activate', async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    res.status(400).json({ ok: false, error: 'Token is required' });
    return;
  }

  const cleanToken = token.trim();
  const tokenRegex = /^\d{8,11}:[a-zA-Z0-9_-]{35}$/;
  if (!tokenRegex.test(cleanToken)) {
    res.status(400).json({
      ok: false,
      error: 'Invalid token format. A Telegram Bot token looks like: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
    });
    return;
  }

  // Test getMe API
  const testRes = await tgCall(cleanToken, 'getMe');
  if (!testRes.ok || !testRes.result) {
    res.status(401).json({
      ok: false,
      error: testRes.description || 'Telegram rejected this token. Check if the token was revoked in @BotFather.',
    });
    return;
  }

  // Save token persistently
  activeBotToken = cleanToken;
  verifiedBotInfo = testRes.result;
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ token: cleanToken, bot: testRes.result }, null, 2));
  } catch (e) {
    console.error('Could not save .bot_config.json:', e);
  }

  // Stop old poller if running and start new poller
  if (pollingAbortController) {
    pollingAbortController.abort();
    isPollingActive = false;
  }

  runTelegramPoller(cleanToken).catch((err) => {
    console.error('Failed to run poller:', err);
  });

  res.json({
    ok: true,
    message: `Bot @${testRes.result.username} successfully connected and is now LIVE on Telegram!`,
    bot: testRes.result,
  });
});

// 2. Validate token only (preview)
app.post('/api/telegram/validate-token', async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) {
    res.status(400).json({ ok: false, error: 'Token is required' });
    return;
  }
  const clean = token.trim();
  const testRes = await tgCall(clean, 'getMe');
  if (testRes.ok && testRes.result) {
    res.json({ ok: true, bot: testRes.result });
  } else {
    res.status(401).json({ ok: false, error: testRes.description || 'Invalid token' });
  }
});

// 3. Get Status & Live Logs
app.get('/api/telegram/status', (_req: Request, res: Response) => {
  let maskedToken = '';
  if (activeBotToken) {
    const parts = activeBotToken.split(':');
    maskedToken = `${parts[0]}:••••••••${parts[1]?.slice(-4) || ''}`;
  }

  res.json({
    configured: Boolean(activeBotToken),
    isPolling: isPollingActive,
    maskedToken,
    botInfo: verifiedBotInfo,
    liveEvents,
    defaultLanguage: defaultBotLanguage,
    activeGroupsCount: dbGroups.size,
    activePipelinesCount: dbCrossPosts.filter((c) => c.isActive).length,
  });
});

// 4. Language Management Endpoints
app.get('/api/telegram/language', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    defaultLanguage: defaultBotLanguage,
    supportedLanguages: ['hinglish', 'english', 'hindi', 'marathi'],
  });
});

app.post('/api/telegram/language', (req: Request, res: Response) => {
  const { language } = req.body;
  if (language && ['hinglish', 'english', 'hindi', 'marathi'].includes(language)) {
    defaultBotLanguage = language as BotLanguage;
    saveDatabase();
    addLiveEvent('system', `Default bot language updated to: ${language}`);
    res.json({ ok: true, language: defaultBotLanguage });
  } else {
    res.status(400).json({ ok: false, error: 'Invalid language option' });
  }
});

// Cross-Post Endpoints
app.post('/api/crosspost/toggle', (req: Request, res: Response) => {
  const { id } = req.body;
  const cp = dbCrossPosts.find((c) => c.id === Number(id));
  if (cp) {
    cp.isActive = !cp.isActive;
    saveDatabase();
    addLiveEvent('crosspost', `Pipeline "${cp.name}" ${cp.isActive ? 'resumed' : 'paused'}`);
    res.json({ ok: true, crossPost: cp });
  } else {
    res.status(404).json({ ok: false, error: 'Pipeline not found' });
  }
});

app.post('/api/crosspost/direction', (req: Request, res: Response) => {
  const { id, direction } = req.body;
  const cp = dbCrossPosts.find((c) => c.id === Number(id));
  if (cp && ['A_TO_B', 'B_TO_A', 'BIDIRECTIONAL'].includes(direction)) {
    cp.direction = direction;
    saveDatabase();
    addLiveEvent('crosspost', `Pipeline "${cp.name}" direction set to ${direction}`);
    res.json({ ok: true, crossPost: cp });
  } else {
    res.status(400).json({ ok: false, error: 'Invalid parameters' });
  }
});

app.post('/api/crosspost/mode', (req: Request, res: Response) => {
  const { id, mode } = req.body;
  const cp = dbCrossPosts.find((c) => c.id === Number(id));
  if (cp && ['COPY', 'FORWARD'].includes(mode)) {
    cp.mode = mode;
    saveDatabase();
    addLiveEvent('crosspost', `Pipeline "${cp.name}" mode set to ${mode}`);
    res.json({ ok: true, crossPost: cp });
  } else {
    res.status(400).json({ ok: false, error: 'Invalid parameters' });
  }
});

app.post('/api/crosspost/create', (req: Request, res: Response) => {
  const { groupAId, groupBId, direction = 'BIDIRECTIONAL', mode = 'COPY' } = req.body;
  const gA = dbGroups.get(Number(groupAId));
  const gB = dbGroups.get(Number(groupBId));
  if (!gA || !gB || gA.id === gB.id) {
    res.status(400).json({ ok: false, error: 'Select two distinct valid groups' });
    return;
  }
  const existing = dbCrossPosts.find(
    (c) => (c.groupAId === gA.id && c.groupBId === gB.id) || (c.groupAId === gB.id && c.groupBId === gA.id)
  );
  if (existing) {
    existing.isActive = true;
    existing.direction = direction;
    existing.mode = mode;
    saveDatabase();
    res.json({ ok: true, crossPost: existing, message: 'Already connected, updated settings' });
    return;
  }
  const newCp: DBCrossPost = {
    id: Date.now(),
    name: `${gA.title} ⇄ ${gB.title}`,
    groupAId: gA.id,
    groupBId: gB.id,
    direction,
    mode,
    isActive: true,
  };
  dbCrossPosts.push(newCp);
  saveDatabase();
  addLiveEvent('crosspost', `Created pipeline "${newCp.name}" (${direction})`);
  res.json({ ok: true, crossPost: newCp });
});

app.post('/api/crosspost/delete', (req: Request, res: Response) => {
  const { id } = req.body;
  const idx = dbCrossPosts.findIndex((c) => c.id === Number(id));
  if (idx !== -1) {
    const removed = dbCrossPosts.splice(idx, 1)[0];
    saveDatabase();
    addLiveEvent('crosspost', `Deleted pipeline "${removed.name}"`);
    res.json({ ok: true });
  } else {
    res.status(404).json({ ok: false, error: 'Pipeline not found' });
  }
});

app.post('/api/welcome/update', (req: Request, res: Response) => {
  const { groupId, welcomeEnabled, welcomeDeleteSeconds } = req.body;
  const grp = dbGroups.get(Number(groupId));
  if (grp) {
    if (typeof welcomeEnabled === 'boolean') grp.welcomeEnabled = welcomeEnabled;
    if (typeof welcomeDeleteSeconds === 'number') grp.welcomeDeleteSeconds = welcomeDeleteSeconds;
    saveDatabase();
    addLiveEvent('welcome', `Updated welcome settings for "${grp.title}"`);
    res.json({ ok: true, group: grp });
  } else {
    res.status(404).json({ ok: false, error: 'Group not found' });
  }
});

// 5. State for web app dashboard & simulator
app.get('/api/simulation/state', (_req: Request, res: Response) => {
  res.json({
    groups: Array.from(dbGroups.values()),
    linkCodes: dbLinkCodes,
    crossPosts: dbCrossPosts,
    liveEvents,
    messages: simMessages,
    welcomeConfigs: {},
    warnings: [],
    modLogs: [],
    defaultLanguage: defaultBotLanguage,
  });
});

// 6. Simulator Action Dispatcher
app.post('/api/simulation/dispatch', async (req: Request, res: Response) => {
  const { action, payload } = req.body;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (action === 'send_private_message') {
    const text: string = payload.text || '';
    const userId = 999001; // simulation user
    const lang = getUserLang(userId);

    // Record user message
    simMessages.push({
      id: `msg-${Date.now()}-u`,
      chatType: 'private',
      sender: 'Alex (You)',
      senderRole: 'admin',
      senderId: userId,
      text,
      timestamp: time,
    });

    if (text.startsWith('/language') || text.startsWith('/lang')) {
      const prompt = `🌐 **Language Settings / अपनी भाषा चुनें:**\n\nCurrent language: **${lang.toUpperCase()}**\n\n👉 **Aap aisa karo:** Apni pasandida bhasha select karein:`;
      simMessages.push({
        id: `msg-${Date.now()}-b`,
        chatType: 'private',
        sender: 'TeleGroup Bot',
        senderRole: 'bot',
        senderId: 0,
        text: prompt,
        timestamp: time,
        inlineButtons: [
          [{ text: '🇮🇳 Hinglish (Aap aisa karo)', callbackData: 'set_lang_hinglish' }],
          [{ text: '🇬🇧 English', callbackData: 'set_lang_english' }],
          [{ text: '🇮🇳 हिन्दी (Hindi)', callbackData: 'set_lang_hindi' }],
          [{ text: '🚩 मराठी (Marathi)', callbackData: 'set_lang_marathi' }],
          [{ text: '« Back to Main Menu', callbackData: 'nav_main_menu' }],
        ],
      });
    } else if (text.startsWith('/start')) {
      const welcome =
        lang === 'english'
          ? `👋 **Welcome, Alex!**\n\n**TeleGroup Studio & Bot Control Hub**\nManage multiple Telegram groups securely from this private chat.`
          : lang === 'hindi'
          ? `👋 **नमस्ते, Alex!**\n\n**TeleGroup Studio & Bot Control Hub**\nअपने सभी ग्रुप्स को इस प्राइवेट चैट से आसानी से मैनेज करें!`
          : lang === 'marathi'
          ? `👋 **नमस्कार, Alex!**\n\n**TeleGroup Studio & Bot Control Hub**\nया खाजगी चॅटमधून सर्व ग्रुप्स नियंत्रित करा!`
          : `👋 **Namaste, Alex!**\n\n**TeleGroup Studio & Bot Control Hub**\nAap yahan private chat se apne saare Telegram groups ko easily manage aur cross-post kar sakte hain!\n\n👉 **Aap aisa karo:** Niche diye gaye menu buttons se koi bhi option choose karein:`;

      simMessages.push({
        id: `msg-${Date.now()}-b`,
        chatType: 'private',
        sender: 'TeleGroup Bot',
        senderRole: 'bot',
        senderId: 0,
        text: welcome,
        timestamp: time,
        inlineButtons: getMainMenuKeyboard(lang).inline_keyboard,
      });
    } else if (text.startsWith('/linkgroup')) {
      simMessages.push({
        id: `msg-${Date.now()}-b`,
        chatType: 'private',
        sender: 'TeleGroup Bot',
        senderRole: 'bot',
        senderId: 0,
        text: `⚠️ **Dhyan dein:** \`/linkgroup\` command aapko apne **Group ya Channel** me bhejni hoti hai, yahan private chat me nahi!\n\n👉 **Aap aisa karo:** Group me bot ko Admin banayein aur wahan \`/linkgroup\` send karein.`,
        timestamp: time,
        inlineButtons: [[{ text: '« Back to Main Menu', callbackData: 'nav_main_menu' }]],
      });
    } else if (text.startsWith('/connect')) {
      const parts = text.split(/\s+/).slice(1).map((s: string) => s.toUpperCase());
      if (parts.length === 1) {
        simMessages.push({
          id: `msg-${Date.now()}-b`,
          chatType: 'private',
          sender: 'TeleGroup Bot',
          senderRole: 'bot',
          senderId: 0,
          text: `✅ **Group Connected Successfully!**\n\nGroup code \`${parts[0]}\` verify ho gaya hai. Aapka group **My Groups** me add ho gaya hai!`,
          timestamp: time,
          inlineButtons: [
            [{ text: '👥 My Groups', callbackData: 'nav_my_groups' }],
            [{ text: '« Back to Main Menu', callbackData: 'nav_main_menu' }],
          ],
        });
      } else if (parts.length >= 2) {
        simMessages.push({
          id: `msg-${Date.now()}-b`,
          chatType: 'private',
          sender: 'TeleGroup Bot',
          senderRole: 'bot',
          senderId: 0,
          text: `✅ **Cross-Posting Active!**\n\nCodes \`${parts[0]}\` aur \`${parts[1]}\` link ho gaye hain. Ab Group A ke messages Group B me auto post honge!`,
          timestamp: time,
          inlineButtons: [
            [{ text: '🔄 Cross-Posting', callbackData: 'nav_crosspost' }],
            [{ text: '« Back to Main Menu', callbackData: 'nav_main_menu' }],
          ],
        });
      }
    } else {
      simMessages.push({
        id: `msg-${Date.now()}-b`,
        chatType: 'private',
        sender: 'TeleGroup Bot',
        senderRole: 'bot',
        senderId: 0,
        text: `🤖 Message received: "${text}"\n\n👉 **Aap aisa karo:** Niche diye gaye menu buttons se navigate karein:`,
        timestamp: time,
        inlineButtons: getMainMenuKeyboard(lang).inline_keyboard,
      });
    }
  } else if (action === 'click_inline_button') {
    const cbData = payload.callbackData;
    const userId = 999001;

    if (cbData?.startsWith('set_lang_')) {
      const chosen = cbData.replace('set_lang_', '') as BotLanguage;
      setUserLang(userId, chosen);
      simMessages.push({
        id: `msg-${Date.now()}-b`,
        chatType: 'private',
        sender: 'TeleGroup Bot',
        senderRole: 'bot',
        senderId: 0,
        text: `✅ **Language Updated!** Language has been changed to **${chosen.toUpperCase()}**.\n\nAb se bot aapko is language me reply karega:`,
        timestamp: time,
        inlineButtons: getMainMenuKeyboard(chosen).inline_keyboard,
      });
      res.json({ ok: true });
      return;
    }

    const lang = getUserLang(userId);
    let textReply = 'Module overview:';

    if (cbData === 'nav_main_menu') {
      textReply = `🏠 **Main Dashboard**\n\nSelect an option below:`;
    } else if (cbData === 'nav_language') {
      textReply = `🌐 **Select Your Language / अपनी भाषा चुनें:**`;
      simMessages.push({
        id: `msg-${Date.now()}-b`,
        chatType: 'private',
        sender: 'TeleGroup Bot',
        senderRole: 'bot',
        senderId: 0,
        text: textReply,
        timestamp: time,
        inlineButtons: getLanguageKeyboard(lang).inline_keyboard,
      });
      res.json({ ok: true });
      return;
    } else if (cbData === 'nav_my_groups') {
      textReply = `👥 **My Managed Groups (2)**\n\n• 🟢 Crypto Alpha Community (Supergroup)\n• 🟢 VIP Announcements Channel (Channel)`;
    } else if (cbData === 'nav_crosspost') {
      textReply = `🔄 **Cross-Posting Pipelines**\n\n• 🟢 Crypto Alpha ⇄ VIP Announcements (Direction: A → B, Mode: Clean Copy)`;
    } else if (cbData === 'nav_connect_groups') {
      textReply = `🔗 **Connect Groups Guide (Aap aisa karo):**\n1. Group me bot ko Admin banayein\n2. Group me \`/linkgroup\` send karein\n3. Mila hua code yahan private chat me bhejiye!`;
    }

    simMessages.push({
      id: `msg-${Date.now()}-b`,
      chatType: 'private',
      sender: 'TeleGroup Bot',
      senderRole: 'bot',
      senderId: 0,
      text: textReply,
      timestamp: time,
      inlineButtons: getMainMenuKeyboard(lang).inline_keyboard,
    });
  } else if (action === 'send_group_message') {
    const text: string = payload.text || '';
    const targetGroup = payload.targetGroup === 2 ? 'group_b' : 'group_a';
    const sender = payload.sender || 'Alex (Admin)';

    simMessages.push({
      id: `msg-${Date.now()}-g`,
      chatType: targetGroup,
      sender,
      senderRole: payload.senderRole || 'admin',
      senderId: 999001,
      text,
      timestamp: time,
    });

    if (text.startsWith('/linkgroup')) {
      const code = generateCode(6);
      dbLinkCodes.push({
        code,
        groupId: payload.targetGroup || 1,
        groupTitle: payload.targetGroup === 2 ? 'VIP Announcements (Group B)' : 'Crypto Alpha (Group A)',
        groupType: 'supergroup',
        generatedByUserId: 999001,
        expiresAt: Date.now() + 15 * 60 * 1000,
        isUsed: false,
        usedByUserId: null,
      });

      simMessages.push({
        id: `msg-${Date.now()}-gb`,
        chatType: targetGroup,
        sender: 'TeleGroup Bot',
        senderRole: 'bot',
        senderId: 0,
        text: `🔐 **Connection Code Generated!**\n\nCode: \`${code}\`\nValid for: \`15 minutes\`\n\n👉 **Aap aisa karo:** Bot ke private chat me ye code send karein:\n\`${code}\` (Ya /connect ${code})`,
        timestamp: time,
      });
    }
  } else if (action === 'simulate_member_join') {
    const targetGroup = payload.targetGroup === 2 ? 'group_b' : 'group_a';
    const memberName = payload.newMemberName || 'Sarah Connor';
    simMessages.push({
      id: `msg-${Date.now()}-w`,
      chatType: targetGroup,
      sender: 'TeleGroup Bot',
      senderRole: 'bot',
      senderId: 0,
      text: `👋 **Welcome, ${memberName}!**\n\nPlease check group rules and enjoy your stay. (Auto-delete in 60s active)`,
      timestamp: time,
    });
  }

  res.json({ ok: true });
});

app.post('/api/simulation/reset', (_req: Request, res: Response) => {
  dbLinkCodes.length = 0;
  dbCrossPosts.length = 0;
  simMessages.length = 0;
  saveDatabase();
  res.json({ ok: true });
});

// Serve Vite in development or static build in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TeleGroup Server & Studio running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
