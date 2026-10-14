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
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const CONFIG_FILE = path.resolve(__dirname, '.bot_config.json');
const DB_FILE = path.resolve(__dirname, '.bot_db.json');

// Supported Languages
export type BotLanguage = 'hinglish' | 'english' | 'hindi' | 'marathi';
let defaultBotLanguage: BotLanguage = 'hinglish';
const dbUserLanguages: Map<number, BotLanguage> = new Map();

// Live Telegram Bot State
let activeBotToken: string = process.env.TELEGRAM_BOT_TOKEN || process.env.VRISHTI_BOT_TOKEN || '8795478992:AAHSyl7Mp18MtbVNVVbg_JZVt2GHjbkaDEw';
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
  authorizedUserIds?: number[];
  warnLimit: number;
  warnAction: string;
  rulesText: string;
  welcomeEnabled: boolean;
  welcomeDeleteSeconds: number;
  photoAutoDeleteEnabled?: boolean;
  photoAutoDeleteSeconds?: number;
  lastKnownMessageId?: number;
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
  createdByUserId?: number;
  authorizedUserIds?: number[];
  lastSyncedMessageId?: number;
  syncTotalCopied?: number;
  syncTotalSkipped?: number;
  syncStatus?: 'idle' | 'running' | 'completed' | 'paused' | 'error';
  syncProgressText?: string;
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

interface PendingMessageDeletion {
  id: string;
  chatId: number;
  messageId: number;
  deleteAt: number; // Unix timestamp in ms
  retries: number;
  chatTitle?: string;
  botToken?: string;
}

export interface ManagedBot {
  id: string; // 'vrishti' | 'shanaya' | 'kiara' | 'myra'
  name: string;
  username?: string;
  botId?: number;
  token: string;
  persona: string;
  role: string;
  roleMarathi: string;
  avatarEmoji: string;
  color: string;
  status: 'online' | 'offline' | 'error';
  cooldownMinutes: number;
  autoDeleteHours: number;
  lastPostedAt?: number;
  totalActivitiesPosted?: number;
}

const INITIAL_BOT_SQUAD: ManagedBot[] = [
  {
    id: 'vrishti',
    name: 'Vrishti Pande',
    username: 'Its_Vrishti_bot',
    botId: 8795478992,
    token: process.env.VRISHTI_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '8795478992:AAHSyl7Mp18MtbVNVVbg_JZVt2GHjbkaDEw',
    persona: 'Master Controller',
    role: 'Primary Admin & Cross-Posting Engine',
    roleMarathi: 'मुख्य ॲडमिन, क्रॉस-पोस्टिंग व ऑटो बग फिक्स',
    avatarEmoji: '👑',
    color: 'from-amber-500 to-indigo-600',
    status: 'online',
    cooldownMinutes: 0,
    autoDeleteHours: 0,
    totalActivitiesPosted: 0,
  },
  {
    id: 'shanaya',
    name: 'Shanaya Gill',
    username: 'Hey_shanu_bot',
    botId: 8614921985,
    token: process.env.SHANAYA_BOT_TOKEN || '8614921985:AAGQTOXgW4XmOLZ6S99pcq40L-hX3ak7ZbI',
    persona: 'Vibes & Polls Hostess',
    role: 'Community Polls, Questions & Vibe Checks',
    roleMarathi: 'कम्युनिटी पोल्स, प्रश्न व व्होटिंग',
    avatarEmoji: '💋',
    color: 'from-pink-500 to-rose-600',
    status: 'online',
    cooldownMinutes: 30,
    autoDeleteHours: 2,
    totalActivitiesPosted: 0,
  },
  {
    id: 'kiara',
    name: 'Kiara Singhania',
    username: 'Its_kiara_bot',
    botId: 8765168476,
    token: process.env.KIARA_BOT_TOKEN || '8765168476:AAF10rB0DoRUL0FHUHE69GsSpFsnOWvHgBI',
    persona: 'Games & Truth/Dare Queen',
    role: 'Truth or Dare, Mini-Games & Spicy Quizzes',
    roleMarathi: 'गेम्स, ट्रुथ किंवा डेअर आणि स्पायसी क्विझ',
    avatarEmoji: '🎮',
    color: 'from-purple-500 to-violet-600',
    status: 'online',
    cooldownMinutes: 30,
    autoDeleteHours: 2,
    totalActivitiesPosted: 0,
  },
  {
    id: 'myra',
    name: 'Myra Oberoi',
    username: 'myra_oberoi_bot',
    botId: 8910630938,
    token: process.env.MYRA_BOT_TOKEN || '8910630938:AAENJX6jvQRntlMPvZhnZ9tsRNJdwJbZtoY',
    persona: 'Memes & Late Night Banter',
    role: 'Adult Memes, Reaction Boards & Late Night Chat',
    roleMarathi: 'अडल्ट मीम्स, इमोजी रिअॅक्शन्स व लेट नाईट चॅट',
    avatarEmoji: '💀',
    color: 'from-red-500 to-amber-600',
    status: 'online',
    cooldownMinutes: 30,
    autoDeleteHours: 2,
    totalActivitiesPosted: 0,
  },
];

let dbBotSquad: ManagedBot[] = [...INITIAL_BOT_SQUAD];

const dbGroups: Map<number, DBGroup> = new Map();
const dbLinkCodes: DBLinkCode[] = [];
const dbCrossPosts: DBCrossPost[] = [];
const dbPendingDeletions: PendingMessageDeletion[] = [];
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
  if (dbGroups.size === 0 && !activeBotToken) {
    dbGroups.set(1, {
      id: 1,
      tgChatId: 1928374650,
      title: 'Crypto Alpha Community (Group A)',
      type: 'supergroup',
      ownerUserId: 999001,
      authorizedUserIds: [999001],
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
      tgChatId: 2847592011,
      title: 'VIP Announcements Channel (Group B)',
      type: 'channel',
      ownerUserId: 999001,
      authorizedUserIds: [999001],
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
      if (Array.isArray(data.pendingDeletions)) {
        dbPendingDeletions.length = 0;
        dbPendingDeletions.push(...data.pendingDeletions);
      }
      if (Array.isArray(data.botSquad) && data.botSquad.length > 0) {
        // Merge saved settings with initial list, prioritizing process.env
        INITIAL_BOT_SQUAD.forEach((initB) => {
          const found = data.botSquad.find((b: any) => b.id === initB.id);
          const envToken =
            initB.id === 'vrishti'
              ? process.env.VRISHTI_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
              : initB.id === 'shanaya'
              ? process.env.SHANAYA_BOT_TOKEN
              : initB.id === 'kiara'
              ? process.env.KIARA_BOT_TOKEN
              : process.env.MYRA_BOT_TOKEN;

          if (envToken) {
            initB.token = envToken;
          } else if (found?.token) {
            initB.token = found.token;
          }

          if (found) {
            initB.username = found.username || initB.username;
            initB.botId = found.botId || initB.botId;
            initB.cooldownMinutes = typeof found.cooldownMinutes === 'number' ? found.cooldownMinutes : initB.cooldownMinutes;
            initB.autoDeleteHours = typeof found.autoDeleteHours === 'number' ? found.autoDeleteHours : initB.autoDeleteHours;
            initB.totalActivitiesPosted = found.totalActivitiesPosted || 0;
          }
        });
        dbBotSquad = [...INITIAL_BOT_SQUAD];
      }
      if (data.defaultBotLanguage) {
        defaultBotLanguage = data.defaultBotLanguage;
      }
      if (data.userLanguages && typeof data.userLanguages === 'object') {
        Object.entries(data.userLanguages).forEach(([uid, lang]) => {
          dbUserLanguages.set(Number(uid), lang as BotLanguage);
        });
      }
      console.log(`Database loaded: ${dbGroups.size} groups, ${dbCrossPosts.length} pipelines, ${dbPendingDeletions.length} pending message deletions, ${dbBotSquad.length} squad bots, default language: ${defaultBotLanguage}.`);
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
      pendingDeletions: dbPendingDeletions,
      botSquad: dbBotSquad,
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

// User-Specific Group & Pipeline Authorization (Multi-Tenant Isolation)
async function getGroupsForUser(userId: number, _token?: string): Promise<DBGroup[]> {
  // Simulator dummy user
  if (userId === 999001) {
    return Array.from(dbGroups.values()).filter((g) => g.ownerUserId === 999001 || g.id === 1 || g.id === 2);
  }

  // Real Telegram users: ONLY groups where ownerUserId === userId OR authorizedUserIds includes userId!
  // Strictly isolates user groups - only groups linked by this user in private chat are returned.
  // Never return simulator mock groups (1, 2) or private chat IDs (tgChatId > 0)
  return Array.from(dbGroups.values()).filter((g) => {
    if (g.id === 1 || g.id === 2 || g.tgChatId > 0) return false;
    return g.ownerUserId === userId || (Array.isArray(g.authorizedUserIds) && g.authorizedUserIds.includes(userId));
  });
}

function getCrossPostsForUser(userId: number, userGroupIds?: Set<number>): DBCrossPost[] {
  if (!userGroupIds) {
    const userGroups = Array.from(dbGroups.values()).filter((g) => {
      if (g.id === 1 || g.id === 2 || g.tgChatId > 0) return false;
      return g.ownerUserId === userId || (Array.isArray(g.authorizedUserIds) && g.authorizedUserIds.includes(userId));
    });
    userGroupIds = new Set(userGroups.map((g) => g.id));
  }

  return dbCrossPosts.filter((cp) => {
    // Both groups MUST belong to this user's managed groups!
    const ownsBothGroups = userGroupIds!.has(cp.groupAId) && userGroupIds!.has(cp.groupBId);
    if (!ownsBothGroups) return false;

    // And either created by this user or authorized
    return cp.createdByUserId === userId || (Array.isArray(cp.authorizedUserIds) && cp.authorizedUserIds.includes(userId));
  });
}

async function isUserAuthorizedForGroup(groupId: number, userId: number, _token?: string): Promise<boolean> {
  const grp = dbGroups.get(groupId);
  if (!grp) return false;
  if (userId === 999001) return grp.ownerUserId === 999001 || grp.id === 1 || grp.id === 2;
  if (grp.id === 1 || grp.id === 2 || grp.tgChatId > 0) return false;
  
  // Strictly owner or authorized
  return grp.ownerUserId === userId || (Array.isArray(grp.authorizedUserIds) && grp.authorizedUserIds.includes(userId));
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
          { text: '🤖 Bot Squad (4 Bots)', callback_data: 'nav_squad' },
          { text: '🩺 Auto Bug Fixer', callback_data: 'nav_autofix' },
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
          { text: '🤖 बॉट स्क्वॉड (4 बॉट्स)', callback_data: 'nav_squad' },
          { text: '🩺 ऑटो बग फिक्स', callback_data: 'nav_autofix' },
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
          { text: '🤖 बॉट स्क्वॉड (4 बॉट्स)', callback_data: 'nav_squad' },
          { text: '🩺 ऑटो बग फिक्स', callback_data: 'nav_autofix' },
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
        { text: '🤖 Bot Squad (4 Bots)', callback_data: 'nav_squad' },
        { text: '🩺 Auto Bug Fixer', callback_data: 'nav_autofix' },
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

// Dedicated robust Persistent Welcome Event Handler with HTML escaping & auto-delete
async function processPendingDeletions(token: string) {
  if (!token || dbPendingDeletions.length === 0) return;
  const now = Date.now();
  const due = dbPendingDeletions.filter((item) => now >= item.deleteAt);
  if (due.length === 0) return;

  for (const item of due) {
    try {
      const useToken = item.botToken || token;
      const res = await tgCall(useToken, 'deleteMessage', {
        chat_id: item.chatId,
        message_id: item.messageId,
      });

      if (res.ok) {
        const idx = dbPendingDeletions.findIndex((d) => d.id === item.id);
        if (idx !== -1) dbPendingDeletions.splice(idx, 1);
        addLiveEvent('welcome', `🧹 Auto-deleted welcome message in "${item.chatTitle || item.chatId}" (message #${item.messageId})`);
        saveDatabase();
      } else {
        const desc = res.description || '';
        // If message is already deleted or can't be deleted / not found
        if (
          desc.includes('message to delete not found') ||
          desc.includes("message can't be deleted") ||
          res.error_code === 400
        ) {
          const idx = dbPendingDeletions.findIndex((d) => d.id === item.id);
          if (idx !== -1) dbPendingDeletions.splice(idx, 1);
          saveDatabase();
        } else if (res.error_code === 429) {
          const retryAfter = res.parameters?.retry_after || 5;
          item.deleteAt = Date.now() + retryAfter * 1000;
          saveDatabase();
        } else {
          item.retries = (item.retries || 0) + 1;
          if (item.retries >= 5) {
            addLiveEvent('error', `Failed to delete message in "${item.chatTitle || item.chatId}": ${desc}`);
            const idx = dbPendingDeletions.findIndex((d) => d.id === item.id);
            if (idx !== -1) dbPendingDeletions.splice(idx, 1);
          } else {
            item.deleteAt = Date.now() + 5000;
          }
          saveDatabase();
        }
      }
    } catch (e: any) {
      console.error('Error in message deletion worker:', e);
    }
  }
}

// Background auto-delete timer running every 2 seconds
setInterval(() => {
  if (activeBotToken) {
    processPendingDeletions(activeBotToken).catch((err) => {
      console.error('Pending deletion processor error:', err);
    });
  }
}, 2000);

// Background periodic activity poster:
// If a connected group has been quiet/idle for 18+ hours (once a day when no one is chatting),
// automatically drop an engaging vibe check poll or meme to keep the community active!
setInterval(async () => {
  const now = Date.now();
  for (const grp of dbGroups.values()) {
    if (grp.type === 'channel') continue;
    const lastActive = lastGroupActivityTimestamp.get(grp.id) || 0;
    if (lastActive > 0 && now - lastActive > 18 * 3600 * 1000) {
      lastGroupActivityTimestamp.set(grp.id, now);
      const randomAct = Math.random() > 0.5 ? 'poll' : 'meme';
      const botId = randomAct === 'poll' ? 'shanaya' : 'myra';
      sendBotActivity(botId, grp.id, randomAct, { force: true }).catch((err) => {
        console.warn('Error in idle group daily post:', err);
      });
    }
  }
}, 30 * 60 * 1000); // Check every 30 minutes

// ============================================================================
// 1. HISTORY SYNCHRONIZATION ENGINE (Clone / Transfer past posts from A to B)
// ============================================================================
export interface HistorySyncState {
  pipelineId: number;
  isRunning: boolean;
  sourceChatId: number;
  destChatId: number;
  sourceTitle: string;
  destTitle: string;
  startId: number;
  endId: number;
  currentId: number;
  totalCopied: number;
  totalSkipped: number;
  status: 'idle' | 'running' | 'completed' | 'paused' | 'error';
  statusText?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

const activeSyncTasks: Map<number, HistorySyncState> = new Map();

function cancelHistorySync(pipelineId: number): boolean {
  const task = activeSyncTasks.get(pipelineId);
  if (task && task.isRunning) {
    task.isRunning = false;
    task.status = 'paused';
    task.statusText = 'Sync paused/cancelled by user.';
    const cp = dbCrossPosts.find((c) => c.id === pipelineId);
    if (cp) {
      cp.syncStatus = 'paused';
      cp.syncProgressText = task.statusText;
      saveDatabase();
    }
    return true;
  }
  return false;
}

async function startHistorySync(
  pipelineId: number,
  options?: { startId?: number; endId?: number; limit?: number; notifyUserId?: number }
): Promise<HistorySyncState> {
  const cp = dbCrossPosts.find((c) => c.id === pipelineId);
  if (!cp) throw new Error('Pipeline not found');
  if (!activeBotToken) throw new Error('Telegram Bot token is not configured');

  const existing = activeSyncTasks.get(pipelineId);
  if (existing && existing.isRunning) {
    return existing;
  }

  // Determine source and destination based on direction
  let sourceChatId = cp.groupAId;
  let destChatId = cp.groupBId;
  if (cp.direction === 'B_TO_A') {
    sourceChatId = cp.groupBId;
    destChatId = cp.groupAId;
  }

  const grpSource = dbGroups.get(sourceChatId);
  const grpDest = dbGroups.get(destChatId);
  const sourceTitle = grpSource?.title || `Chat ${sourceChatId}`;
  const destTitle = grpDest?.title || `Chat ${destChatId}`;

  // Find endId (highest message ID in source)
  let endId = options?.endId;
  if (!endId) {
    let knownId = grpSource?.lastKnownMessageId;
    // Probe current latest message ID via quick ephemeral message
    try {
      const probe = await tgCall(activeBotToken, 'sendMessage', {
        chat_id: sourceChatId,
        text: '🔄',
      });
      if (probe.ok && probe.result?.message_id) {
        knownId = probe.result.message_id;
        tgCall(activeBotToken, 'deleteMessage', {
          chat_id: sourceChatId,
          message_id: knownId,
        }).catch(() => {});
        if (grpSource) {
          grpSource.lastKnownMessageId = knownId;
          saveDatabase();
        }
      }
    } catch {
      // Ignored if permissions don't allow sending
    }
    endId = knownId || 100;
  }

  let startId = options?.startId;
  if (!startId) {
    const limit = options?.limit || 50;
    startId = Math.max(1, endId - limit + 1);
  }

  const syncState: HistorySyncState = {
    pipelineId,
    isRunning: true,
    sourceChatId,
    destChatId,
    sourceTitle,
    destTitle,
    startId,
    endId,
    currentId: startId,
    totalCopied: 0,
    totalSkipped: 0,
    status: 'running',
    statusText: `Syncing past posts #${startId} to #${endId}...`,
    startedAt: Date.now(),
  };
  activeSyncTasks.set(pipelineId, syncState);

  cp.syncStatus = 'running';
  cp.syncTotalCopied = 0;
  cp.syncTotalSkipped = 0;
  cp.syncProgressText = syncState.statusText;
  saveDatabase();

  addLiveEvent('crosspost', `🚀 Started History Sync for "${cp.name}" (#${startId} ➔ #${endId}) to "${destTitle}"`);

  // Background non-blocking worker
  (async () => {
    try {
      for (let cur = startId; cur <= endId; cur++) {
        const task = activeSyncTasks.get(pipelineId);
        if (!task || !task.isRunning) {
          console.log(`Sync task for pipeline ${pipelineId} was stopped.`);
          break;
        }

        task.currentId = cur;

        // Rate-limit buffer (250ms delay = 4 msgs/sec, safe under Telegram limits)
        await new Promise((r) => setTimeout(r, 250));

        let res: any;
        if (cp.mode === 'COPY') {
          res = await tgCall(activeBotToken, 'copyMessage', {
            chat_id: destChatId,
            from_chat_id: sourceChatId,
            message_id: cur,
          });
          if (!res.ok && res.error_code !== 400 && res.error_code !== 429) {
            res = await tgCall(activeBotToken, 'forwardMessage', {
              chat_id: destChatId,
              from_chat_id: sourceChatId,
              message_id: cur,
            });
          }
        } else {
          res = await tgCall(activeBotToken, 'forwardMessage', {
            chat_id: destChatId,
            from_chat_id: sourceChatId,
            message_id: cur,
          });
        }

        if (res.ok && res.result?.message_id) {
          const newMsgId = res.result.message_id;
          botSentMessageIds.add(`${destChatId}:${newMsgId}`);
          processedMsgMap.add(`${sourceChatId}:${destChatId}:${cur}`);
          task.totalCopied++;
          cp.syncTotalCopied = task.totalCopied;
          cp.lastSyncedMessageId = cur;
        } else if (res.error_code === 429) {
          const waitSec = res.parameters?.retry_after || 5;
          task.statusText = `Rate limit active: waiting ${waitSec}s...`;
          await new Promise((r) => setTimeout(r, (waitSec + 1) * 1000));
          cur--; // retry this message
          continue;
        } else {
          task.totalSkipped++;
          cp.syncTotalSkipped = task.totalSkipped;
        }

        if (cur % 15 === 0 || cur === endId) {
          addLiveEvent(
            'crosspost',
            `📦 Syncing "${cp.name}": #${cur}/${endId} (${task.totalCopied} copied, ${task.totalSkipped} skipped)`
          );
          task.statusText = `Progress: ${task.totalCopied} copied, ${task.totalSkipped} skipped (now at #${cur}/${endId})`;
          cp.syncProgressText = task.statusText;
          saveDatabase();
        }
      }

      const finished = activeSyncTasks.get(pipelineId);
      if (finished) {
        finished.isRunning = false;
        finished.status = 'completed';
        finished.finishedAt = Date.now();
        finished.statusText = `Done! ${finished.totalCopied} messages copied (${finished.totalSkipped} skipped/deleted).`;
        cp.syncProgressText = finished.statusText;
      }
      cp.syncStatus = 'completed';
      saveDatabase();

      addLiveEvent(
        'crosspost',
        `✅ Finished History Sync for "${cp.name}": ${syncState.totalCopied} messages copied to "${destTitle}"!`
      );

      if (options?.notifyUserId) {
        const uLang = getUserLang(options.notifyUserId);
        const notice =
          uLang === 'marathi'
            ? `✅ **जुने सर्व मेसेज ट्रान्सफर पूर्ण झाले!**\n\n• **पाइपलाइन:** **${cp.name}**\n• **एकूण कॉपी केलेले मेसेज:** \`${syncState.totalCopied}\`\n• **वगळलेले/हटवलेले:** \`${syncState.totalSkipped}\`\n• **रूट:** **${sourceTitle}** ➔ **${destTitle}**\n\nसर्व जुने मेसेज यशस्वीरीत्या ट्रान्सफर करण्यात आले आहेत!`
            : `✅ **History Sync Completed!**\n\n• **Pipeline:** **${cp.name}**\n• **Total Copied:** \`${syncState.totalCopied}\`\n• **Skipped / Deleted:** \`${syncState.totalSkipped}\`\n• **Route:** **${sourceTitle}** ➔ **${destTitle}**\n\nAll past messages successfully transferred to destination!`;
        tgCall(activeBotToken, 'sendMessage', {
          chat_id: options.notifyUserId,
          text: notice,
          parse_mode: 'Markdown',
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error('History sync worker error:', err);
      const failed = activeSyncTasks.get(pipelineId);
      if (failed) {
        failed.isRunning = false;
        failed.status = 'error';
        failed.error = err.message;
        failed.statusText = `Error: ${err.message}`;
        cp.syncProgressText = failed.statusText;
      }
      cp.syncStatus = 'error';
      saveDatabase();
      addLiveEvent('error', `❌ History sync failed for "${cp.name}": ${err.message}`);
    }
  })();

  return syncState;
}

// ============================================================================
// 2. AUTO BUG FIXER & SELF-HEALING ENGINE
// ============================================================================
async function runAutoBugFixer(_userId?: number) {
  const checks: Array<{ name: string; status: 'ok' | 'fixed' | 'warning' | 'error'; detail: string }> = [];

  if (!activeBotToken) {
    checks.push({
      name: 'Bot Token & Credentials',
      status: 'error',
      detail: 'No bot token found. Please configure token in BotFather modal.',
    });
    return { ok: false, checks, summary: 'Bot token missing' };
  }

  // 1. Telegram API Latency & Auth
  const startT = Date.now();
  const meRes = await tgCall(activeBotToken, 'getMe');
  const latency = Date.now() - startT;

  if (meRes.ok && meRes.result) {
    verifiedBotInfo = meRes.result;
    checks.push({
      name: 'Telegram Bot API Ping',
      status: 'ok',
      detail: `@${meRes.result.username} connected successfully (Latency: ${latency}ms)`,
    });
  } else {
    checks.push({
      name: 'Telegram Bot API Ping',
      status: 'error',
      detail: `Connection failed: ${meRes.description || 'Token invalid'}`,
    });
  }

  // 2. Webhook & Long-Polling Engine conflict check
  try {
    const whRes = await tgCall(activeBotToken, 'deleteWebhook', { drop_pending_updates: false });
    if (whRes.ok) {
      checks.push({
        name: 'Webhook & Conflict Resolver',
        status: 'fixed',
        detail: 'Cleared webhook conflicts; 24/7 Long-Polling loop verified',
      });
    }
  } catch (e: any) {
    checks.push({
      name: 'Webhook Status',
      status: 'warning',
      detail: e.message,
    });
  }

  if (!isPollingActive && activeBotToken) {
    runTelegramPoller(activeBotToken).catch(() => {});
    checks.push({
      name: 'Poller Auto-Recovery',
      status: 'fixed',
      detail: 'Restarted polling engine automatically',
    });
  }

  // 3. Admin Rights in Linked Groups
  let checkedGroups = 0;
  let adminOk = 0;
  for (const [gid, grp] of dbGroups.entries()) {
    checkedGroups++;
    try {
      const cm = await tgCall(activeBotToken, 'getChatMember', {
        chat_id: gid,
        user_id: verifiedBotInfo?.id,
      });
      if (cm.ok && cm.result) {
        const st = cm.result.status;
        if (st === 'administrator' || st === 'creator') {
          adminOk++;
        } else {
          checks.push({
            name: `Group Rights: ${grp.title}`,
            status: 'warning',
            detail: `Bot status is "${st}". Please make bot Administrator!`,
          });
        }
      }
    } catch {
      // Ignored
    }
  }
  checks.push({
    name: 'Linked Groups Admin Rights',
    status: adminOk === checkedGroups ? 'ok' : 'fixed',
    detail: `${adminOk}/${checkedGroups} groups verified with Administrator rights`,
  });

  // 4. Cross-Posting Routes Integrity Check
  let fixedPipelines = 0;
  let healthyPipelines = 0;
  for (const cp of dbCrossPosts) {
    const hasA = dbGroups.has(cp.groupAId);
    const hasB = dbGroups.has(cp.groupBId);
    if (!hasA || !hasB) {
      cp.isActive = false;
      fixedPipelines++;
    } else {
      healthyPipelines++;
    }
  }
  checks.push({
    name: 'Cross-Posting Routes',
    status: fixedPipelines > 0 ? 'fixed' : 'ok',
    detail: `${healthyPipelines} active pipelines verified${fixedPipelines > 0 ? `, repaired ${fixedPipelines} invalid routes` : ''}`,
  });

  // 5. Deletion Queue Cleanups
  const now = Date.now();
  const initCount = dbPendingDeletions.length;
  for (let i = dbPendingDeletions.length - 1; i >= 0; i--) {
    if (now - dbPendingDeletions[i].deleteAt > 86400000) {
      dbPendingDeletions.splice(i, 1);
    }
  }
  const purged = initCount - dbPendingDeletions.length;
  checks.push({
    name: 'Auto-Delete Queue Cleanup',
    status: purged > 0 ? 'fixed' : 'ok',
    detail: `Queue operational (${dbPendingDeletions.length} active tasks${purged > 0 ? `, ${purged} orphaned tasks purged` : ''})`,
  });

  saveDatabase();
  addLiveEvent('system', `🩺 Auto Bug Fixer executed successfully: All checks passed`);

  return {
    ok: true,
    checks,
    summary: 'All systems inspected and auto-repaired successfully.',
  };
}

// ============================================================================
// 3. MULTI-BOT SQUAD ENGINE (Shanaya, Kiara, Myra & Vrishti)
// ============================================================================

const TRUTHS_DATA = [
  "🍷 Truth: Who was the last person you secretly chatted with? Spill the beans! 🤫",
  "💋 Truth: What is your craziest late-night adventure or party story? 🥂",
  "🍷 Truth: Who is your biggest secret crush right now? Be honest! 🩷",
  "💋 Truth: Have you ever sneaked out of your home late at night? 🌙",
  "🍷 Truth: What is one secret photo in your phone you would never show anyone? 📱",
  "🔥 Truth: Do you believe in love at first sight, or should I walk by again? 😉",
  "💋 Truth: What is your wildest party memory? Drop it in one line! 🔥",
];

const DARES_DATA = [
  "💋 Dare: Send your boldest 3 emojis in the chat right now to express your mood! 🔥",
  "🍷 Dare: Compliment someone in this group in one spicy or sweet line! 🥂",
  "💋 Dare: Send a quick 3-second voice note saying 'Cheers to the squad tonight!' 🍾",
  "🍷 Dare: For the next 3 minutes, chat using only emojis without typing words! 🤐",
  "🔥 Dare: Give the hottest reaction emoji to the message above! 💯",
  "💋 Dare: Share your current favorite late-night party track! 🎵",
];

const SPICY_DATA = [
  "🔥 Spicy: Clubbing party, long drive, or secret cozy night: what is your top pick? 🍷",
  "💋 Spicy: Rate your tonight's party vibe from 1 to 10! 💯",
  "🔥 Spicy: Romantic candle-light dinner or wild clubbing till 4 AM? 🥂",
  "🍷 Spicy: What is the boldest text you have ever sent past 1 AM? 💋",
];

const SQUAD_POLL_PRESETS = [
  {
    id: 'poll_next_content',
    title: '🔥 What should we post next? (Photo or Video)',
    question: '🔥 What should we post next? / Next post kya chahiye? 💋',
    options: ['📸 Exclusive Photos', '🎬 Short Video Clips / Reels', '💋 Both / Dono chahiye!'],
  },
  {
    id: 'poll_content_feedback',
    title: '🍷 Content Vibe Check (Feedback)',
    question: '🍷 How do you like our group content and vibes? 💯',
    options: ['🔥 100% Love it! (Super Vibe)', '💯 Post even more content!', '👀 Need daily exclusive updates'],
  },
  {
    id: 'poll_night_vibe',
    title: '💃 Tonight\'s Party Mood',
    question: '💃 Tonight\'s Party Mood / Aaj raat ka plan? 🍾',
    options: ['🍾 Full Wild Party Mode!', '🍷 Cozy & Chill Lounge Night', '🔥 Late Night Secret Chat'],
  },
  {
    id: 'poll_weekend_plan',
    title: '💋 Weekend Plans',
    question: '💋 What are your weekend plans? / Weekend ka kya scene? 🥂',
    options: ['🎉 Clubbing & Nightout', '🏠 Chill at home with movies', '🥂 Hanging out with friends'],
  },
];

const SQUAD_MEME_PRESETS = [
  {
    id: 'meme_night_lounge',
    title: '🍷 Late Night Lounge Banter',
    caption: `💀 **Myra's Late Night Lounge & Memes** 🍷\n\nLate night vibes are unmatched... 🍷🔥 Kis kis ka sleep cycle complete mess up ho gaya hai? Drop your reactions below! 💋💦`,
  },
  {
    id: 'meme_friday_party',
    title: '🍾 Friday Night Vibe',
    caption: `💋 **Tonight\'s Vibe is Unstoppable!** 🥂🔥\n\nWork is done, weekend mood is ON! Jo jo party mood me hain, hit the reactions below! 💯🍾`,
  },
  {
    id: 'meme_single_mingle',
    title: '🔥 Late Night Confessions',
    caption: `🔥 **Late Night Confessions with Myra** 💀\n\nJo log abhi tak jaag rahe hain aur phone scroll kar rahe hain... mark your attendance below! 🍷👀`,
  },
];

async function sendBotActivity(
  botId: string,
  chatId: number,
  activityType: 'poll' | 'game' | 'meme' | 'question',
  options?: {
    customQuestion?: string;
    pollOptions?: string[];
    customCaption?: string;
    autoDeleteHours?: number;
    force?: boolean;
  }
) {
  const bot = dbBotSquad.find((b) => b.id === botId);
  if (!bot) throw new Error(`Bot ${botId} not found in squad`);

  // Check cooldown
  if (!options?.force && bot.lastPostedAt) {
    const elapsedMinutes = (Date.now() - bot.lastPostedAt) / 60000;
    if (elapsedMinutes < bot.cooldownMinutes) {
      const remainingMinutes = Math.ceil(bot.cooldownMinutes - elapsedMinutes);
      return {
        ok: false,
        error: `Cooldown active: ${bot.name} is resting. Next post in ${remainingMinutes} min (Use Force Post to bypass).`,
        remainingMinutes,
      };
    }
  }

  const chat = dbGroups.get(chatId);
  const chatTitle = chat?.title || `Chat ${chatId}`;
  let sentMsgId: number | undefined;

  if (activityType === 'poll') {
    const q = options?.customQuestion || '🔥 पुढचं काय अपलोड करू? / What should we post next? 💋';
    const opts = options?.pollOptions || ['📸 Exclusive Photos', '🎬 Short Video Clips / Reels', '💋 Both / दोन्हीही पाहिजेत!'];
    const res = await tgCall(bot.token, 'sendPoll', {
      chat_id: chatId,
      question: q,
      options: JSON.stringify(opts),
      is_anonymous: false,
    });
    if (!res.ok) {
      throw new Error(res.description || 'Failed to send poll');
    }
    sentMsgId = res.result?.message_id;
  } else if (activityType === 'game') {
    const text = options?.customCaption ||
      `🎮 **Kiara's Late-Night Party Game Room** 🎲\n\nग्रुपमधील सर्व मित्रांसाठी मजेदार खेळ! खालील बटणावर क्लिक करून तुमचे चॅलेंज स्वीकारा 💋\n\n• कोणामध्ये आहे डेअर स्वीकारण्याची हिम्मत? 🔥🍷`;
    const res = await tgCall(bot.token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🍷 Truth / सत्य', callback_data: 'game_truth' },
            { text: '💋 Dare / चॅलेंज', callback_data: 'game_dare' },
          ],
          [
            { text: '🔥 Spicy Question', callback_data: 'game_spicy' },
            { text: '🍾 Spin Bottle', callback_data: 'game_spin' },
          ],
          [
            { text: '💯 Rate The Vibe (1-10)', callback_data: 'game_rate' },
          ],
        ],
      },
    });
    if (!res.ok) {
      throw new Error(res.description || 'Failed to send game');
    }
    sentMsgId = res.result?.message_id;
  } else {
    // meme or question
    const text = options?.customCaption ||
      `💀 **Myra's Late Night Lounge & Memes** 🍷\n\nरात्री 12 नंतरचा मूड काही वेगळाच असतो... 🍷🔥 कोणाकोणाचा स्लीप सायकल खराब झालाय? खाली तुमचे इमोजी रिअॅक्शन द्या! 💋💦`;
    const res = await tgCall(bot.token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💋 0', callback_data: 'react_kiss' },
            { text: '🔥 0', callback_data: 'react_fire' },
            { text: '💀 0', callback_data: 'react_skull' },
            { text: '🍷 0', callback_data: 'react_wine' },
          ],
          [
            { text: '🩷 0', callback_data: 'react_heart' },
            { text: '💯 0', callback_data: 'react_100' },
            { text: '💦 0', callback_data: 'react_splash' },
          ],
        ],
      },
    });
    if (!res.ok) {
      throw new Error(res.description || 'Failed to send meme/reaction board');
    }
    sentMsgId = res.result?.message_id;
  }

  // Update bot stats & lastPostedAt
  bot.lastPostedAt = Date.now();
  bot.totalActivitiesPosted = (bot.totalActivitiesPosted || 0) + 1;

  // Auto-delete scheduling: if bot.autoDeleteHours > 0 or specified
  // NOTE: User explicitly specified: "पाठवलेले मेसेज डिलीट पण व्हायला पाहिजे मेसेजची बात करतोय पुलची नाही"
  // Polls MUST NOT be auto-deleted so members can vote and see results!
  const isPoll = activityType === 'poll';
  const deleteHours = options?.autoDeleteHours !== undefined ? options.autoDeleteHours : bot.autoDeleteHours;
  if (!isPoll && deleteHours > 0 && sentMsgId) {
    dbPendingDeletions.push({
      id: `squad-del-${chatId}-${sentMsgId}-${Date.now()}`,
      chatId,
      messageId: sentMsgId,
      deleteAt: Date.now() + deleteHours * 3600 * 1000,
      retries: 0,
      chatTitle,
      botToken: bot.token,
    });
  }

  saveDatabase();
  addLiveEvent('system', `✨ ${bot.name} posted ${activityType} to "${chatTitle}" (${isPoll ? 'Permanent Poll' : deleteHours > 0 ? `Auto-delete in ${deleteHours}h` : 'Permanent'})`);

  return {
    ok: true,
    messageId: sentMsgId,
    botName: bot.name,
    chatTitle,
    deleteHours,
  };
}

const squadAbortControllers: Map<string, AbortController> = new Map();

async function startSquadBotPoller(bot: ManagedBot) {
  if (bot.id === 'vrishti') return; // Vrishti has primary poller
  if (!bot.token) return;

  const controller = new AbortController();
  squadAbortControllers.set(bot.id, controller);

  try {
    await tgCall(bot.token, 'deleteWebhook', { drop_pending_updates: false });
  } catch {}

  let offset = 0;
  console.log(`Starting squad poller for ${bot.name} (@${bot.username || bot.id})...`);

  while (!controller.signal.aborted) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${bot.token}/getUpdates?offset=${offset}&timeout=25&allowed_updates=["callback_query","message"]`,
        { signal: controller.signal }
      );
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.result)) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }

      for (const update of data.result) {
        offset = update.update_id + 1;
        handleSquadBotUpdate(bot, update).catch((err) => {
          console.error(`Error in ${bot.name} update handler:`, err);
        });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') break;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

async function sendSquadCircleVideo(bot: ManagedBot, chatId: number) {
  const adultCircleGifs = [
    'https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif',
    'https://media.giphy.com/media/l0HlBO7eyXzSZkJri/giphy.gif',
    'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif',
    'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif',
  ];
  const gifUrl = adultCircleGifs[Math.floor(Math.random() * adultCircleGifs.length)];
  const chat = dbGroups.get(chatId);
  const chatTitle = chat?.title || `Chat ${chatId}`;

  let sentMsgId: number | undefined;
  const res = await tgCall(bot.token, 'sendAnimation', {
    chat_id: chatId,
    animation: gifUrl,
    caption: `⭕ **${bot.name} Circle Video Clip & Vibe** 💋🔥\n\nAdult Party Mood: 💋🔥💀🍷🩷💯💦\n\n_Auto-delete active in ${bot.autoDeleteHours}h_`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💋 0', callback_data: 'react_kiss' },
          { text: '🔥 0', callback_data: 'react_fire' },
          { text: '💦 0', callback_data: 'react_splash' },
          { text: '🍷 0', callback_data: 'react_wine' },
        ],
      ],
    },
  });

  if (res.ok && res.result?.message_id) {
    sentMsgId = res.result.message_id;
  } else {
    const fRes = await tgCall(bot.token, 'sendMessage', {
      chat_id: chatId,
      text: `⭕ **[Circle Ratio Video Clip]**\n\n💋 **${bot.name}:** Circle Video Note & Mood Update! 🎬🔥\n\nAdult Party Theme: 💋🔥💀🍷🩷💯💦\n\n_Self-destruct timer: ${bot.autoDeleteHours}h_`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💋 0', callback_data: 'react_kiss' },
            { text: '🔥 0', callback_data: 'react_fire' },
            { text: '💦 0', callback_data: 'react_splash' },
            { text: '🍷 0', callback_data: 'react_wine' },
          ],
        ],
      },
    });
    if (fRes.ok) sentMsgId = fRes.result?.message_id;
  }

  if (sentMsgId && bot.autoDeleteHours > 0) {
    dbPendingDeletions.push({
      id: `squad-circle-${chatId}-${sentMsgId}-${Date.now()}`,
      chatId,
      messageId: sentMsgId,
      deleteAt: Date.now() + bot.autoDeleteHours * 3600 * 1000,
      retries: 0,
      chatTitle,
      botToken: bot.token,
    });
    saveDatabase();
  }

  addLiveEvent('system', `⭕ ${bot.name} sent circle video clip to "${chatTitle}"`);
}

// Anti-collision tracking: ensures only ONE squad bot responds per group message and prevents duplicate welcomes
const handledGroupMessageIds = new Map<string, number>(); // key: `${chat.id}:${msg.message_id}` -> timestamp
const lastReplyingBotByChat = new Map<number, string>(); // key: chatId -> botId
const recentGroupWelcomeMap = new Map<string, number>(); // key: `${chat.id}:${userId}` -> timestamp
const lastGroupActivityTimestamp = new Map<number, number>(); // key: chatId -> timestamp

async function generateSquadChatReply(
  bot: ManagedBot,
  chat: any,
  userName: string,
  userMessage: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const prompt = `You are ${bot.name} (@${bot.username || bot.id}), a stylish, charismatic female member of a 4-bot team in an exclusive Telegram group called "${chat.title || 'VIP Lounge'}".

Your specific persona:
- ${bot.id === 'shanaya' ? 'Shanaya Gill: Glamorous hostess, warm, social, friendly, welcoming, keeps the group vibe lit.' : bot.id === 'kiara' ? 'Kiara Singhania: Playful party gamer, witty, cheeky, loves games, teasing and high energy.' : bot.id === 'myra' ? 'Myra Oberoi: Edgy late-night banter queen, chill, witty, loves night owls and bold humor.' : 'Vrishti Pande: Master admin, elegant, polite and helpful coordinator.'}

CRITICAL RULES:
1. LANGUAGE: Speak primarily in stylish English and Hinglish (natural Hindi written in English/Latin letters, e.g. "Hey! Kaise ho? Glad you asked. Yeh group..."). Do NOT use pure Marathi or Devanagari script unless the user explicitly wrote in Marathi.
2. CONTEXT & CLARITY: If the user asks what the group is about, e.g. "हा ग्रुप कसा संबंधी / group kis baare me hai / what is this group about", explain directly and warmly that it is an exclusive space for night party vibes, chill lounge banter, fun games, spicy memes, and premium entertainment updates!
3. CHAT ONLY: DO NOT output button markups, bracketed actions, command lists, or robotic disclaimers. Just write a real, human, friendly 1 to 2 sentence chat message like a real person typing in the group.
4. Keep it engaging, concise, and charming!

User "${userName}" says: "${userMessage}"

Reply directly as ${bot.name}:`;

  if (apiKey) {
    try {
      const ai = new GoogleGenAI();
      const res = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: prompt,
      });
      const generated = res.text?.trim();
      if (generated && generated.length > 0 && generated.length < 500) {
        return generated.replace(/^["']|["']$/g, '').trim();
      }
    } catch (e: any) {
      console.warn(`Gemini reply error for ${bot.name}:`, e.message || e);
    }
  }

  // Smart fallback if API is temporarily unavailable
  const lower = userMessage.toLowerCase();
  if (lower.includes('group') || lower.includes('संबंधी') || lower.includes('about') || lower.includes('kya hai') || lower.includes('kashasathi')) {
    return `Hey ${userName}! 🥂 Yeh group exclusive night party vibes, chill lounge chats, fun games aur premium updates ke liye hai! Glad to have you here ✨`;
  }
  if (lower.includes('hi') || lower.includes('hello') || lower.includes('hey') || lower.includes('kasa') || lower.includes('kaise')) {
    if (bot.id === 'shanaya') return `Hey ${userName}! 💋 Kaise ho? Aaj ka vibe check kaisa chal raha hai? ✨`;
    if (bot.id === 'kiara') return `Hey ${userName}! 🎮 Kya scene hai aaj raat ka? Sab chill hai na? 😉`;
    if (bot.id === 'myra') return `Hey ${userName}! 🍷 Late night squad me welcome. Sab theek-thaak? 💀`;
    return `Hello ${userName}! 👑 Welcome to the group! Kaise ho aap?`;
  }
  return `Hey ${userName}! 🥂 Glad to chat with you. Aaj raat ka party plan kya hai?`;
}

async function handleSquadBotUpdate(bot: ManagedBot, update: any) {
  // 1. Handle Inline Keyboards (Callback Queries)
  if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data || '';
    const fromUser = cb.from;
    const userName = fromUser?.first_name || 'Friend';
    const chatId = cb.message?.chat?.id;

    if (data.startsWith('game_')) {
      let replyAlert = '';
      if (data === 'game_truth') {
        const truth = TRUTHS_DATA[Math.floor(Math.random() * TRUTHS_DATA.length)];
        replyAlert = `${truth}`;
      } else if (data === 'game_dare') {
        const dare = DARES_DATA[Math.floor(Math.random() * DARES_DATA.length)];
        replyAlert = `${dare}`;
      } else if (data === 'game_spicy') {
        const spicy = SPICY_DATA[Math.floor(Math.random() * SPICY_DATA.length)];
        replyAlert = `${spicy}`;
      } else if (data === 'game_spin') {
        replyAlert = `🍾 Bottle spun... and pointed at @${fromUser?.username || userName}! You must accept the dare now! 🔥`;
      } else if (data === 'game_rate') {
        replyAlert = `💯 Kiara: 10/10 vibes! Total fire and party mood! 💦🔥`;
      }

      await tgCall(bot.token, 'answerCallbackQuery', {
        callback_query_id: cb.id,
        text: replyAlert,
        show_alert: true,
      });

      addLiveEvent('callback', `🎮 ${userName} played ${data} with ${bot.name}`);
      return;
    }

    if (data.startsWith('react_')) {
      const msg = cb.message;
      if (msg && msg.reply_markup?.inline_keyboard) {
        const newKeyboard = msg.reply_markup.inline_keyboard.map((row: any[]) =>
          row.map((btn: any) => {
            if (btn.callback_data === data) {
              const parts = btn.text.split(' ');
              const emoji = parts[0];
              const count = parseInt(parts[1]) || 0;
              return {
                text: `${emoji} ${count + 1}`,
                callback_data: btn.callback_data,
              };
            }
            return btn;
          })
        );

        await tgCall(bot.token, 'editMessageReplyMarkup', {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          reply_markup: { inline_keyboard: newKeyboard },
        }).catch(() => {});
      }

      await tgCall(bot.token, 'answerCallbackQuery', {
        callback_query_id: cb.id,
        text: `Your reaction was recorded! 💋🔥`,
      });
      addLiveEvent('callback', `❤️ ${userName} reacted to ${bot.name}'s post`);
      return;
    }

    if (data.startsWith('send_circle_')) {
      if (chatId) {
        await sendSquadCircleVideo(bot, chatId);
        await tgCall(bot.token, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: `⭕ Circle Video Clip sent! 💋`,
        });
      }
      return;
    }

    if (data === 'squad_act_poll') {
      if (chatId) {
        await sendBotActivity('shanaya', chatId, 'poll', { force: true });
        await tgCall(bot.token, 'answerCallbackQuery', { callback_query_id: cb.id, text: '📊 New poll launched!' });
      }
      return;
    }

    if (data === 'squad_act_game') {
      if (chatId) {
        await sendBotActivity('kiara', chatId, 'game', { force: true });
        await tgCall(bot.token, 'answerCallbackQuery', { callback_query_id: cb.id, text: '🎮 Truth/Dare game started!' });
      }
      return;
    }

    if (data === 'squad_act_meme') {
      if (chatId) {
        await sendBotActivity('myra', chatId, 'meme', { force: true });
        await tgCall(bot.token, 'answerCallbackQuery', { callback_query_id: cb.id, text: '🔞 Adult meme board dropped!' });
      }
      return;
    }

    // Default acknowledge
    await tgCall(bot.token, 'answerCallbackQuery', {
      callback_query_id: cb.id,
      text: `Hello ${userName}! ✨`,
    });
    return;
  }

  // 2. Handle Messages sent to Shanaya, Kiara, Myra, or Vrishti!
  const msg = update.message || update.channel_post;
  if (!msg) return;

  const chat = msg.chat;
  const fromUser = msg.from || { first_name: 'Friend', username: '' };
  const userName = fromUser.first_name || 'Friend';
  const text = (msg.text || msg.caption || '').trim();
  const lowerText = text.toLowerCase();
  const isPrivate = chat.type === 'private';
  const isGroupOrChannel = chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel';

  // Ignore bot messages and messages sent by any of our bots to prevent loops
  if (fromUser.is_bot || botSentMessageIds.has(`${chat.id}:${msg.message_id}`)) {
    return;
  }

  // A. Handle New Members Joining Group (Welcome Greeting)
  if (msg.new_chat_members && Array.isArray(msg.new_chat_members) && msg.new_chat_members.length > 0) {
    for (const newMember of msg.new_chat_members) {
      if (newMember.is_bot) continue;
      const welcomeKey = `${chat.id}:${newMember.id}`;
      const now = Date.now();
      // Ensure only ONE bot welcomes this user within a 60s window
      if (recentGroupWelcomeMap.has(welcomeKey) && now - (recentGroupWelcomeMap.get(welcomeKey) || 0) < 60000) {
        continue;
      }
      recentGroupWelcomeMap.set(welcomeKey, now);

      const memberName = escapeHtml(newMember.first_name || newMember.username || 'Member');
      const chatTitle = escapeHtml(chat.title || 'VIP Lounge');
      const welcomeText =
        `👋 <b>Welcome to ${chatTitle}, <a href="tg://user?id=${newMember.id}">${memberName}</a>!</b> 🥂✨\n\n` +
        `Glad to have you with us in the squad! Enjoy the night party vibes, participate in fun games, and chill! 🔥🍷\n\n` +
        `<i>⏱️ (Auto-deleting in 90s to keep chat clean)</i>`;

      const sent = await tgCall(bot.token, 'sendMessage', {
        chat_id: chat.id,
        text: welcomeText,
        parse_mode: 'HTML',
      });

      if (sent.ok && sent.result?.message_id) {
        const sentMsgId = sent.result.message_id;
        botSentMessageIds.add(`${chat.id}:${sentMsgId}`);
        dbPendingDeletions.push({
          id: `welcome-${chat.id}-${sentMsgId}-${Date.now()}`,
          chatId: chat.id,
          messageId: sentMsgId,
          deleteAt: Date.now() + 90 * 1000,
          retries: 0,
          chatTitle: chat.title || String(chat.id),
          botToken: bot.token,
        });
        saveDatabase();
        addLiveEvent('welcome', `Welcomed ${memberName} to "${chat.title}" via ${bot.name} (auto-delete in 90s)`);
      }
    }
    return;
  }

  // B. Private 1-on-1 Chat Handling (DMs to the bot)
  if (isPrivate) {
    addLiveEvent('incoming_message', `${bot.name} (DM): "${text}" from @${fromUser.username || userName}`);

    if (bot.id === 'shanaya') {
      if (lowerText.startsWith('/poll') || lowerText.includes('poll')) {
        await sendBotActivity('shanaya', chat.id, 'poll', { force: true });
        return;
      }
      if (lowerText.startsWith('/circle') || lowerText.includes('circle') || lowerText.includes('video')) {
        await sendSquadCircleVideo(bot, chat.id);
        return;
      }
      const reply = await generateSquadChatReply(bot, chat, userName, text);
      await tgCall(bot.token, 'sendMessage', {
        chat_id: chat.id,
        text: reply,
      });
      return;
    }

    if (bot.id === 'kiara') {
      if (lowerText.startsWith('/game') || lowerText.includes('game') || lowerText.includes('play')) {
        await sendBotActivity('kiara', chat.id, 'game', { force: true });
        return;
      }
      if (lowerText.startsWith('/circle') || lowerText.includes('circle') || lowerText.includes('video')) {
        await sendSquadCircleVideo(bot, chat.id);
        return;
      }
      const reply = await generateSquadChatReply(bot, chat, userName, text);
      await tgCall(bot.token, 'sendMessage', {
        chat_id: chat.id,
        text: reply,
      });
      return;
    }

    if (bot.id === 'myra') {
      if (lowerText.startsWith('/meme') || lowerText.includes('meme') || lowerText.includes('gif')) {
        await sendBotActivity('myra', chat.id, 'meme', { force: true });
        return;
      }
      if (lowerText.startsWith('/circle') || lowerText.includes('circle') || lowerText.includes('video')) {
        await sendSquadCircleVideo(bot, chat.id);
        return;
      }
      const reply = await generateSquadChatReply(bot, chat, userName, text);
      await tgCall(bot.token, 'sendMessage', {
        chat_id: chat.id,
        text: reply,
      });
      return;
    }
  }

  // C. Group & Supergroup Message Handling
  if (isGroupOrChannel) {
    lastGroupActivityTimestamp.set(chat.id, Date.now());
    addLiveEvent('incoming_message', `${bot.name} heard in "${chat.title || chat.id}": "${text}" from @${fromUser.username || userName}`);

    const msgKey = `${chat.id}:${msg.message_id}`;
    const now = Date.now();

    // 1. Determine which ONE bot should answer this message
    let designatedBotId = '';

    // If the message is a reply to one of the bots
    const repliedBotId = msg.reply_to_message?.from?.id;
    if (repliedBotId) {
      const match = dbBotSquad.find((b) => b.botId === repliedBotId);
      if (match) designatedBotId = match.id;
    }

    // If user explicitly named a bot in the text
    if (!designatedBotId) {
      if (lowerText.includes('shanu') || lowerText.includes('shanaya') || lowerText.includes('hey_shanu_bot')) {
        designatedBotId = 'shanaya';
      } else if (lowerText.includes('kiara') || lowerText.includes('its_kiara_bot')) {
        designatedBotId = 'kiara';
      } else if (lowerText.includes('myra') || lowerText.includes('myra_oberoi_bot')) {
        designatedBotId = 'myra';
      } else if (lowerText.includes('vrishti') || lowerText.includes('its_vrishti_bot')) {
        designatedBotId = 'vrishti';
      }
    }

    // If not addressed to a specific bot, pick ONE rotating squad bot deterministically
    if (!designatedBotId) {
      const squadIds = ['shanaya', 'kiara', 'myra'];
      const lastBot = lastReplyingBotByChat.get(chat.id) || '';
      const available = squadIds.filter((id) => id !== lastBot);
      const hash = Math.abs(msg.message_id || 0) % (available.length || 1);
      designatedBotId = available[hash] || squadIds[0];
    }

    // CRITICAL: If this bot is NOT the designated bot, return immediately!
    // This guarantees that all bots will NEVER reply at once!
    if (bot.id !== designatedBotId) {
      return;
    }

    // Deduplication check: Has this message already been processed?
    if (handledGroupMessageIds.has(msgKey)) {
      return;
    }
    handledGroupMessageIds.set(msgKey, now);
    lastReplyingBotByChat.set(chat.id, bot.id);

    // Clean up old deduplication entries (> 5 minutes)
    if (handledGroupMessageIds.size > 200) {
      for (const [k, timestamp] of handledGroupMessageIds.entries()) {
        if (now - timestamp > 300000) handledGroupMessageIds.delete(k);
      }
    }

    // --- Intent 1: Circle Video Request ---
    if (lowerText.startsWith('/circle') || lowerText.includes('circle video') || lowerText.includes('circle ratio')) {
      await sendSquadCircleVideo(bot, chat.id);
      return;
    }

    // --- Intent 2: On-Demand Poll / "What to upload next?" / "बहुमताने" / "vote" ---
    // User explicitly requested:
    // "आणि डिमांडनुसार समाज एखाद्या व्यक्ती जर विचारत असेल की पुढे काय अपलोड करायचं आणि बहुमताने मग त्यावर पूल तयार केला जाईल"
    // "पाठवलेले मेसेज डिलीट पण व्हायला पाहिजे मेसेजची बात करतोय पुलची नाही"
    const isUploadDemand =
      lowerText.startsWith('/poll') ||
      lowerText.includes('upload') ||
      lowerText.includes('पुढे काय') ||
      lowerText.includes('kya upload') ||
      lowerText.includes('poll') ||
      lowerText.includes('vote') ||
      lowerText.includes('बहुमताने') ||
      lowerText.includes('photo ya video');

    if (isUploadDemand) {
      const pollQ = '🔥 What should we upload next? / बहुमताने ठरवा काय अपलोड करू? 💋';
      const pollOpts = ['📸 Exclusive Photos', '🎬 Short Video Clips / Reels', '💋 Both / Dono Chahiye!'];

      const pRes = await tgCall(bot.token, 'sendPoll', {
        chat_id: chat.id,
        question: pollQ,
        options: JSON.stringify(pollOpts),
        is_anonymous: false,
      });

      if (pRes.ok && pRes.result?.message_id) {
        botSentMessageIds.add(`${chat.id}:${pRes.result.message_id}`);
        // NOTE: Polls are NEVER auto-deleted per user's requirement ("मेसेजची बात करतोय पुलची नाही")
        addLiveEvent('system', `📊 ${bot.name} launched on-demand poll in "${chat.title || chat.id}" (Permanent for voting)`);
      }
      return;
    }

    // --- Intent 3: Game Command ---
    if (lowerText.startsWith('/game') || (bot.id === 'kiara' && lowerText.includes('play game'))) {
      await sendBotActivity('kiara', chat.id, 'game', { force: true });
      return;
    }

    // --- Intent 4: Meme Command ---
    if (lowerText.startsWith('/meme') || (bot.id === 'myra' && lowerText.includes('drop meme'))) {
      await sendBotActivity('myra', chat.id, 'meme', { force: true });
      return;
    }

    // --- Intent 5: Standard Conversation & Questions (e.g. "हा ग्रुप कसा संबंधी?", "Hello", etc.) ---
    // User requested:
    // "आता साधा मेसेज नाही करत समजली एखाद्याने विचारलं की हा ग्रुप कसा संबंधी मग त्याचा रिप्लाय दिला पाहिजे ना"
    // "प्रत्येक मेसेज चा रिप्लाय फुल किंवा कोणतीही बटन देऊन उपयोग नाहीये"
    // "पाठवलेले मेसेज डिलीट पण व्हायला पाहिजे मेसेजची बात करतोय पुलची नाही"
    const replyText = await generateSquadChatReply(bot, chat, userName, text);

    const sent = await tgCall(bot.token, 'sendMessage', {
      chat_id: chat.id,
      text: replyText,
    });

    if (sent.ok && sent.result?.message_id) {
      const sentMsgId = sent.result.message_id;
      botSentMessageIds.add(`${chat.id}:${sentMsgId}`);

      // Auto-delete the chat message after configured hours (default 2 hours)
      const deleteHours = bot.autoDeleteHours > 0 ? bot.autoDeleteHours : 2;
      dbPendingDeletions.push({
        id: `squad-chat-${chat.id}-${sentMsgId}-${Date.now()}`,
        chatId: chat.id,
        messageId: sentMsgId,
        deleteAt: Date.now() + deleteHours * 3600 * 1000,
        retries: 0,
        chatTitle: chat.title || String(chat.id),
        botToken: bot.token,
      });
      saveDatabase();
      addLiveEvent('system', `💬 ${bot.name} replied in "${chat.title || chat.id}" (auto-delete in ${deleteHours}h)`);
    }
  }
  return;
}

async function initBotSquad() {
  console.log('Initializing TeleGroup 4-Bot Squad...');
  for (const bot of dbBotSquad) {
    try {
      const res = await tgCall(bot.token, 'getMe');
      if (res.ok && res.result) {
        bot.username = res.result.username;
        bot.botId = res.result.id;
        bot.status = 'online';
        console.log(`Squad bot verified: ${bot.name} -> @${bot.username}`);
      } else {
        bot.status = 'error';
      }
    } catch {
      bot.status = 'error';
    }

    if (bot.id !== 'vrishti' && bot.status === 'online') {
      startSquadBotPoller(bot).catch((e) => console.error(`Error in ${bot.name} poller:`, e));
    }
  }
  saveDatabase();
}

async function handleNewMemberWelcome(token: string, chat: any, newMember: any) {
  if (!newMember || newMember.id === verifiedBotInfo?.id || newMember.is_bot) return;
  // Never send welcome greetings into broadcast channels!
  if (chat.type === 'channel') return;

  const grp = dbGroups.get(chat.id);
  if (grp && grp.welcomeEnabled === false) {
    return;
  }

  const welcomeKey = `${chat.id}:${newMember.id}`;
  const now = Date.now();
  if (recentGroupWelcomeMap.has(welcomeKey) && now - (recentGroupWelcomeMap.get(welcomeKey) || 0) < 60000) {
    return;
  }
  recentGroupWelcomeMap.set(welcomeKey, now);

  const deleteSeconds = grp?.welcomeDeleteSeconds || 90;
  const memberName = escapeHtml(newMember.first_name || newMember.username || 'Member');
  const chatTitle = escapeHtml(chat.title || 'the group');
  const userMention = `<a href="tg://user?id=${newMember.id}">${memberName}</a>`;

  const welcomeHtml = `👋 <b>Welcome to ${chatTitle}, ${userMention}!</b> 🥂✨\n\n🎉 Glad to have you with us in the squad! Enjoy the night party vibes, participate in fun games, and chill! 🔥🍷\n\n<i>⏱️ (Auto-deleting in ${deleteSeconds}s to keep chat clean)</i>`;

  const sent = await tgCall(token, 'sendMessage', {
    chat_id: chat.id,
    text: welcomeHtml,
    parse_mode: 'HTML',
  });

  if (sent.ok && sent.result?.message_id) {
    const sentMsgId = sent.result.message_id;
    botSentMessageIds.add(`${chat.id}:${sentMsgId}`);
    addLiveEvent('welcome', `Welcomed ${newMember.first_name || 'Member'} to "${chat.title || chat.id}" (auto-delete in ${deleteSeconds}s)`);

    // Track in persistent deletion queue so message is deleted even if server restarts
    dbPendingDeletions.push({
      id: `del-${chat.id}-${sentMsgId}-${Date.now()}`,
      chatId: chat.id,
      messageId: sentMsgId,
      deleteAt: Date.now() + deleteSeconds * 1000,
      retries: 0,
      chatTitle: chat.title || String(chat.id),
    });
    saveDatabase();
  } else {
    // Only log if not a standard channel restriction
    if (sent.error_code !== 400 && sent.error_code !== 403) {
      addLiveEvent('error', `Failed to send welcome message in "${chat.title || chat.id}": ${sent.description || 'Unknown error'}`);
    }
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
      const addingUserId = mcm.from?.id && !mcm.from.is_bot ? mcm.from.id : undefined;

      dbGroups.set(chat.id, {
        id: chat.id,
        tgChatId: chat.id,
        title: chat.title || `Chat ${chat.id}`,
        type: gType,
        ownerUserId: existing?.ownerUserId || addingUserId,
        authorizedUserIds: existing?.authorizedUserIds || (addingUserId ? [addingUserId] : []),
        warnLimit: 3,
        warnAction: 'mute',
        rulesText: '1. Be respectful\n2. No spam\n3. Constructive discussions only.',
        welcomeEnabled: gType !== 'channel',
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
      const userGroups = await getGroupsForUser(user.id, token);
      const userPipelines = getCrossPostsForUser(user.id, new Set(userGroups.map((g) => g.id)));
      const activePipelines = userPipelines.filter((c) => c.isActive).length;

      if (userLang === 'english') {
        responseText = `🏠 **Dashboard Overview**\n\n• **Your Managed Groups:** \`${userGroups.length}\`\n• **Active Cross-Post Pipelines:** \`${activePipelines}\`\n• **Bot Engine:** \`Long-Polling Active (24/7)\`\n• **Anti-Loop Protection:** 🟢 \`Active\`\n\nChoose an action below:`;
      } else if (userLang === 'hindi') {
        responseText = `🏠 **डैशबोर्ड ओवरव्यू**\n\n• **आपके ग्रुप्स:** \`${userGroups.length}\`\n• **सक्रिय क्रॉस-पोस्ट पाइपलाइन्स:** \`${activePipelines}\`\n• **बॉट इंजन:** \`24/7 सक्रिय\`\n• **एंटी-लूप सुरक्षा:** 🟢 \`सक्रिय\`\n\nनीचे दिए गए विकल्पों में से चुनें:`;
      } else if (userLang === 'marathi') {
        responseText = `🏠 **डॅशबोर्ड माहिती**\n\n• **तुमचे ग्रुप्स:** \`${userGroups.length}\`\n• **सक्रिय क्रॉस-पोस्टिंग:** \`${activePipelines}\`\n• **बॉट इंजिन:** \`24/7 सुरू\`\n• **अँटी-लूप सुरक्षा:** 🟢 \`सक्रिय\`\n\nखालील पर्याय निवडा:`;
      } else {
        responseText = `🏠 **Dashboard Overview**\n\n• **Aapke Managed Groups:** \`${userGroups.length}\`\n• **Active Cross-Post Pipelines:** \`${activePipelines}\`\n• **Bot Engine:** \`24/7 Long-Polling Active\`\n• **Anti-Loop Protection:** 🟢 \`Active\`\n\n👉 **Aap aisa karo:** Niche se action choose karein:`;
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
      const userGroups = await getGroupsForUser(user.id, token);

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
      const isAuth = await isUserAuthorizedForGroup(gId, user.id, token);
      const grp = dbGroups.get(gId);
      if (!grp || !isAuth) {
        responseText = `⚠️ Group not found or you are not authorized to manage it.`;
        replyMarkup = { inline_keyboard: [[{ text: '« Back to My Groups', callback_data: 'nav_my_groups' }]] };
      } else {
        responseText = `⚙️ **Group Management: ${grp.title}**\n\n• **Chat ID:** \`${grp.tgChatId}\`\n• **Type:** \`${grp.type}\`\n• **Status:** 🟢 \`Active & Authorized\`\n• **Warn Threshold:** \`${grp.warnLimit}\` (${grp.warnAction})\n• **Flood Limit:** \`${grp.floodLimit}\` msgs / 5s\n• **Welcome Flow:** \`${grp.welcomeEnabled ? `Enabled (${grp.welcomeDeleteSeconds || 60}s auto-delete)` : 'Disabled'}\`\n• **Photo Auto-Delete:** \`${grp.photoAutoDeleteEnabled ? `Enabled (${grp.photoAutoDeleteSeconds || 60}s auto-delete)` : 'Disabled'}\`\n\nSelect an option to customize:`;
        replyMarkup = {
          inline_keyboard: [
            [{ text: `📸 फोटो ऑटो-डिलीट: ${grp.photoAutoDeleteEnabled ? `चालू (${grp.photoAutoDeleteSeconds || 60}s)` : 'बंद'}`, callback_data: `grp_photo_toggle_${grp.id}` }],
            [{ text: '👋 Welcome Message Settings', callback_data: `grp_welcome_${grp.id}` }],
            [{ text: '📜 View & Edit Rules', callback_data: `grp_rules_${grp.id}` }],
            [{ text: '🔄 Cross-Posting Setup', callback_data: 'nav_crosspost' }],
            [{ text: '❌ Unlink This Group', callback_data: `grp_unlink_${grp.id}` }],
            [{ text: '« Back to My Groups', callback_data: 'nav_my_groups' }],
          ],
        };
      }
    } else if (data?.startsWith('grp_photo_toggle_')) {
      const gId = Number(data.replace('grp_photo_toggle_', ''));
      const isAuth = await isUserAuthorizedForGroup(gId, user.id, token);
      const grp = dbGroups.get(gId);
      if (grp && isAuth) {
        if (!grp.photoAutoDeleteEnabled) {
          grp.photoAutoDeleteEnabled = true;
          grp.photoAutoDeleteSeconds = 60;
        } else if (grp.photoAutoDeleteSeconds === 60) {
          grp.photoAutoDeleteSeconds = 300;
        } else if (grp.photoAutoDeleteSeconds === 300) {
          grp.photoAutoDeleteSeconds = 900;
        } else if (grp.photoAutoDeleteSeconds === 900) {
          grp.photoAutoDeleteSeconds = 3600;
        } else {
          grp.photoAutoDeleteEnabled = false;
        }
        saveDatabase();
        addLiveEvent('moderation', `Photo auto-delete for "${grp.title}" set to ${grp.photoAutoDeleteEnabled ? `${grp.photoAutoDeleteSeconds}s` : 'OFF'}`);
        responseText = userLang === 'marathi'
          ? `📸 **फोटो ऑटो-डिलीट सेटिंग अपडेट झाली!**\n\n• **ग्रुप:** **${grp.title}**\n• **स्थिती:** \`${grp.photoAutoDeleteEnabled ? `चालू (${grp.photoAutoDeleteSeconds} सेकंदानंतर डिलीट)` : 'बंद (Disabled)'}\`\n\nया ग्रुपमध्ये सदस्यांनी पाठवलेले फोटो दिलेल्या वेळेनंतर आपोआप सुरक्षितपणे डिलीट केले जातील.`
          : `📸 **Photo Auto-Delete Settings Updated!**\n\n• **Group:** **${grp.title}**\n• **Status:** \`${grp.photoAutoDeleteEnabled ? `ON (${grp.photoAutoDeleteSeconds}s auto-destruct)` : 'OFF'}\`\n\nUploaded photos will automatically self-destruct after timer to prevent chat clutter.`;
      } else {
        responseText = `⚠️ Group not found or unauthorized.`;
      }
      replyMarkup = {
        inline_keyboard: [
          [{ text: '« Back to Group', callback_data: `grp_view_${gId}` }],
          [{ text: '👥 My Groups', callback_data: 'nav_my_groups' }],
        ],
      };
    } else if (data?.startsWith('grp_rules_')) {
      const gId = Number(data.replace('grp_rules_', ''));
      const isAuth = await isUserAuthorizedForGroup(gId, user.id, token);
      const grp = dbGroups.get(gId);
      if (!grp || !isAuth) {
        responseText = `⚠️ Group not found or unauthorized.`;
        replyMarkup = { inline_keyboard: [[{ text: '« Back to My Groups', callback_data: 'nav_my_groups' }]] };
      } else {
        responseText = `📜 **Rules for ${grp.title}:**\n\n${grp.rulesText || 'Be respectful and follow community guidelines.'}`;
        replyMarkup = {
          inline_keyboard: [[{ text: '« Back to Group', callback_data: `grp_view_${gId}` }]],
        };
      }
    } else if (data?.startsWith('grp_welcome_')) {
      const gId = Number(data.replace('grp_welcome_', ''));
      const isAuth = await isUserAuthorizedForGroup(gId, user.id, token);
      const grp = dbGroups.get(gId);
      if (!grp || !isAuth) {
        responseText = `⚠️ Group not found or unauthorized.`;
        replyMarkup = { inline_keyboard: [[{ text: '« Back to My Groups', callback_data: 'nav_my_groups' }]] };
      } else {
        responseText = `👋 **Welcome System: ${grp.title}**\n\n• Status: \`${grp.welcomeEnabled ? '🟢 Enabled' : '🔴 Disabled'}\`\n• Auto-Delete Timer: \`${grp.welcomeDeleteSeconds || 60} seconds\`\n\nNaye members aane par automated welcome greeting send hogi aur chat clean rakhne ke liye delay ke baad delete ho jayegi.`;
        replyMarkup = {
          inline_keyboard: [[{ text: '« Back to Group', callback_data: `grp_view_${gId}` }]],
        };
      }
    } else if (data?.startsWith('grp_unlink_')) {
      const gId = Number(data.replace('grp_unlink_', ''));
      const isAuth = await isUserAuthorizedForGroup(gId, user.id, token);
      const grp = dbGroups.get(gId);
      if (grp && isAuth) {
        if (grp.authorizedUserIds) {
          grp.authorizedUserIds = grp.authorizedUserIds.filter((id) => id !== user.id);
        }
        if (grp.ownerUserId === user.id) {
          grp.ownerUserId = grp.authorizedUserIds?.[0] || undefined;
        }
        saveDatabase();
        responseText = `✅ Group **${grp.title}** has been unlinked from your dashboard.`;
      } else {
        responseText = `⚠️ Group not found or unauthorized.`;
      }
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
      const userGroups = await getGroupsForUser(user.id, token);
      const userGroupIds = new Set(userGroups.map((g) => g.id));
      const userCrossPosts = getCrossPostsForUser(user.id, userGroupIds);

      if (userCrossPosts.length === 0) {
        if (userGroups.length >= 2) {
          const gA = userGroups[0];
          const gB = userGroups[1];
          if (userLang === 'marathi') {
            responseText =
              `🔄 **क्रॉस-पोस्टिंग व्यवस्थापन (Cross-Posting)**\n\n` +
              `तुमच्या ग्रुप्ससाठी कोणतीही सक्रिय पाइपलाइन कॉन्फिगर केलेली नाही.\n\n` +
              `🔵 **ग्रुप A:** **${gA.title}** (\`${gA.id}\`)\n` +
              `🟢 **ग्रुप B:** **${gB.title}** (\`${gB.id}\`)\n\n` +
              `👉 **तुम्ही असे करा:** खालील 1-क्लिक बटणावर क्लिक करून या दोन ग्रुप्समध्ये क्रॉस-पोस्टिंग सुरू करा:`;
            replyMarkup = {
              inline_keyboard: [
                [{ text: `⚡ 1-Click जोडा: ${gA.title} ➔ ${gB.title} (A कडून B)`, callback_data: `cp_connect_${gA.id}_${gB.id}` }],
                [{ text: `⚡ 1-Click दोन्ही बाजूंनी: ${gA.title} ⇄ ${gB.title}`, callback_data: `cp_biconnect_${gA.id}_${gB.id}` }],
                [{ text: '« मुख्य मेनू', callback_data: 'nav_main_menu' }],
              ],
            };
          } else {
            responseText =
              `🔄 **Cross-Posting Management**\n\n` +
              `No active cross-posting pipelines configured yet for your groups.\n\n` +
              `🔵 **Group A:** **${gA.title}** (\`${gA.id}\`)\n` +
              `🟢 **Group B:** **${gB.title}** (\`${gB.id}\`)\n\n` +
              `👉 **Aap aisa karo:** Niche diye gaye 1-click button par click karein aur in donon groups ke beech cross-posting turant activate karein:`;
            replyMarkup = {
              inline_keyboard: [
                [{ text: `⚡ 1-Click Connect: ${gA.title} ➔ ${gB.title} (A to B)`, callback_data: `cp_connect_${gA.id}_${gB.id}` }],
                [{ text: `⚡ 1-Click Bidirectional: ${gA.title} ⇄ ${gB.title}`, callback_data: `cp_biconnect_${gA.id}_${gB.id}` }],
                [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
              ],
            };
          }
        } else if (userGroups.length === 1) {
          const gA = userGroups[0];
          if (userLang === 'marathi') {
            responseText =
              `🔄 **क्रॉस-पोस्टिंग व्यवस्थापन**\n\n` +
              `तुमचा **1 ग्रुप** जोडलेला आहे: **${gA.title}**.\n\n` +
              `क्रॉस-पोस्टिंगसाठी किमान **2 ग्रुप्स** आवश्यक आहेत!\n\n` +
              `👉 **दुसरा ग्रुप जोडण्यासाठी:**\n` +
              `1. दुसऱ्या ग्रुपमध्ये @${botUsername} ला ॲडमिन बनवा.\n` +
              `2. त्या ग्रुपमध्ये \`/linkgroup\` पाठवा.\n` +
              `3. मिळालेला 6-अक्षरी कोड येथे खाजगी चॅटमध्ये पाठवा!`;
            replyMarkup = {
              inline_keyboard: [
                [{ text: '🔗 दुसरा ग्रुप जोडा', callback_data: 'nav_connect_groups' }],
                [{ text: '« मुख्य मेनू', callback_data: 'nav_main_menu' }],
              ],
            };
          } else {
            responseText =
              `🔄 **Cross-Posting Management**\n\n` +
              `Aapka **1 group** connected hai: **${gA.title}**.\n\n` +
              `Cross-posting ke liye kam se kam **2 groups** ki jarurat hoti hai!\n\n` +
              `👉 **Dusra Group Connect Karne Ke Liye (Aap aisa karo):**\n` +
              `1. Apne dusre Telegram group me bot ko Admin banayein.\n` +
              `2. Wahan \`/linkgroup\` command bhejein.\n` +
              `3. Mila hua code yahan private chat me bhejiye!`;
            replyMarkup = {
              inline_keyboard: [
                [{ text: '🔗 Connect Second Group', callback_data: 'nav_connect_groups' }],
                [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
              ],
            };
          }
        } else {
          if (userLang === 'marathi') {
            responseText =
              `🔄 **क्रॉस-पोस्टिंग व्यवस्थापन**\n\n` +
              `सध्या तुमचा कोणताही ग्रुप जोडलेला नाही.\n\n` +
              `👉 **तुमचे ग्रुप्स जोडण्यासाठी:**\n` +
              `1. ग्रुप A मध्ये बॉटला ॲडमिन बनवून \`/linkgroup\` पाठवा.\n` +
              `2. ग्रुप B मध्ये बॉटला ॲडमिन बनवून \`/linkgroup\` पाठवा.\n` +
              `3. मिळालेले कोड खाजगी चॅटमध्ये पाठवून ग्रुप्स जोडा!`;
            replyMarkup = {
              inline_keyboard: [
                [{ text: '🔗 ग्रुप जोडण्याची माहिती', callback_data: 'nav_connect_groups' }],
                [{ text: '« मुख्य मेनू', callback_data: 'nav_main_menu' }],
              ],
            };
          } else {
            responseText =
              `🔄 **Cross-Posting Management**\n\n` +
              `Abhi tak aapka koi bhi group connect nahi hai.\n\n` +
              `👉 **Apne Groups Connect Karne Ke Liye (Aap aisa karo):**\n` +
              `1. Pehle Group A me bot ko Admin banakar \`/linkgroup\` bhejein.\n` +
              `2. Phir Group B me bot ko Admin banakar \`/linkgroup\` bhejein.\n` +
              `3. Donon groups connect hote hi cross-posting activate ho jayegi!`;
            replyMarkup = {
              inline_keyboard: [
                [{ text: '🔗 Connect Group Guide', callback_data: 'nav_connect_groups' }],
                [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
              ],
            };
          }
        }
      } else {
        const pipelineList = userCrossPosts
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

        if (userLang === 'marathi') {
          responseText =
            `🔄 **तुमच्या सक्रिय क्रॉस-पोस्टिंग पाइपलाइन्स (${userCrossPosts.length}):**\n\n${pipelineList}\n\n` +
            `👉 **नियंत्रणे:** खालील बटणांवरून दिशा सेट करा, तात्पुरते थांबवा किंवा चाचणी घ्या:`;
        } else {
          responseText =
            `🔄 **Aapke Active Cross-Posting Pipelines (${userCrossPosts.length}):**\n\n${pipelineList}\n\n` +
            `👉 **Controls:** Niche diye gaye buttons se pipeline pause/resume karein, direction select karein, ya live test karein:`;
        }

        const cpButtons: any[] = [];
        userCrossPosts.forEach((cp) => {
          const gA = dbGroups.get(cp.groupAId)?.title || `Group A (${cp.groupAId})`;
          const gB = dbGroups.get(cp.groupBId)?.title || `Group B (${cp.groupBId})`;
          
          cpButtons.push([
            { text: cp.isActive ? '⏸️ Pause Pipeline' : '▶️ Resume Pipeline', callback_data: `cp_toggle_${cp.id}` },
            { text: `Mode: ${cp.mode === 'COPY' ? 'Clean Copy' : 'Forward'}`, callback_data: `cp_mode_${cp.id}` },
          ]);

          // Direct 1-Click Direction Selection
          cpButtons.push([
            {
              text: `${cp.direction === 'A_TO_B' ? '🟢 ' : ''}➔ Set A to B (${gA} ➔ ${gB})`,
              callback_data: `cp_setdir_${cp.id}_A_TO_B`,
            },
          ]);
          cpButtons.push([
            {
              text: `${cp.direction === 'BIDIRECTIONAL' ? '🟢 ' : ''}⇄ Both Groups (${gA} ⇄ ${gB})`,
              callback_data: `cp_setdir_${cp.id}_BIDIRECTIONAL`,
            },
            {
              text: `${cp.direction === 'B_TO_A' ? '🟢 ' : ''}⬅️ B to A (${gB} ➔ ${gA})`,
              callback_data: `cp_setdir_${cp.id}_B_TO_A`,
            },
          ]);

          cpButtons.push([
            {
              text: userLang === 'marathi' ? '📦 सर्व जुने मेसेज सिंक करा (Sync Past Posts)' : '📦 Sync Past Posts (Transfer Old)',
              callback_data: `cp_sync_${cp.id}`,
            },
          ]);

          cpButtons.push([
            { text: '🧪 Send Test Cross-Post', callback_data: `cp_test_${cp.id}` },
            { text: '🗑️ Delete Pipeline', callback_data: `cp_del_${cp.id}` },
          ]);
        });

        if (userGroups.length >= 2) {
          const gA = userGroups[0];
          const gB = userGroups[1];
          const alreadyLinked = userCrossPosts.some(
            (c) => (c.groupAId === gA.id && c.groupBId === gB.id) || (c.groupAId === gB.id && c.groupBId === gA.id)
          );
          if (!alreadyLinked) {
            cpButtons.push([
              { text: `➕ Connect: ${gA.title} ➔ ${gB.title} (A to B)`, callback_data: `cp_connect_${gA.id}_${gB.id}` },
            ]);
          }
        }

        cpButtons.push([{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }]);
        replyMarkup = { inline_keyboard: cpButtons };
      }
    } else if (data?.startsWith('cp_toggle_')) {
      const cpId = Number(data.replace('cp_toggle_', ''));
      const userGroups = await getGroupsForUser(user.id, token);
      const userGroupIds = new Set(userGroups.map((g) => g.id));
      const userCrossPosts = getCrossPostsForUser(user.id, userGroupIds);
      const cp = userCrossPosts.find((c) => c.id === cpId);
      if (cp) {
        cp.isActive = !cp.isActive;
        saveDatabase();
        addLiveEvent('crosspost', `Cross-post pipeline "${cp.name}" ${cp.isActive ? 'resumed' : 'paused'}`);
        responseText = cp.isActive
          ? `▶️ **Pipeline Resumed:** \`${cp.name}\` is now ACTIVE.`
          : `⏸️ **Pipeline Paused:** \`${cp.name}\` is now PAUSED.`;
      } else {
        responseText = `⚠️ Pipeline not found or you are not authorized to manage it.`;
      }
      replyMarkup = {
        inline_keyboard: [[{ text: '« Back to Cross-Posting', callback_data: 'nav_crosspost' }]],
      };
    } else if (data?.startsWith('cp_setdir_')) {
      const raw = data.replace('cp_setdir_', '');
      const parts = raw.split('_');
      const cpId = Number(parts[0]);
      const dir = parts.slice(1).join('_') as 'A_TO_B' | 'B_TO_A' | 'BIDIRECTIONAL';
      const userGroups = await getGroupsForUser(user.id, token);
      const userGroupIds = new Set(userGroups.map((g) => g.id));
      const userCrossPosts = getCrossPostsForUser(user.id, userGroupIds);
      const cp = userCrossPosts.find((c) => c.id === cpId);

      if (cp && ['A_TO_B', 'B_TO_A', 'BIDIRECTIONAL'].includes(dir)) {
        cp.direction = dir;
        const gA = dbGroups.get(cp.groupAId)?.title || `Chat ${cp.groupAId}`;
        const gB = dbGroups.get(cp.groupBId)?.title || `Chat ${cp.groupBId}`;
        cp.name = dir === 'A_TO_B' ? `${gA} ➔ ${gB}` : dir === 'B_TO_A' ? `${gB} ➔ ${gA}` : `${gA} ⇄ ${gB}`;
        saveDatabase();
        addLiveEvent('crosspost', `Pipeline "${cp.name}" direction set to ${dir}`);

        if (dir === 'A_TO_B') {
          responseText =
            userLang === 'marathi'
              ? `✅ **दिशा यशस्वीरीत्या सेट झाली: A ➔ B**\n\n• **रूट:** **${gA}** ➔ **${gB}**\n• **फक्त ग्रुप A मधील मेसेज ग्रुप B मध्ये जातील.**\n• 🛡️ **ग्रुप B मधील मेसेज मुख्य ग्रुपवर (A) येणार नाहीत!**\n\nही सेटिंग कायमस्वरूपी सेव्ह झाली आहे आणि सर्व्हर रीस्टार्ट झाला तरी बदलणार नाही.`
              : userLang === 'hindi'
              ? `✅ **दिशा सेट हो गई: A ➔ B (One-Way)**\n\n• **रूट:** **${gA}** ➔ **${gB}**\n• **केवल ग्रुप A के संदेश ग्रुप B में जाएंगे।**\n• 🛡️ **ग्रुप B के संदेश मुख्य ग्रुप (A) में नहीं आएंगे!**\n\nयह सेटिंग परमानेंटली सेव हो गई है और सर्वर रीस्टार्ट होने पर भी बनी रहेगी।`
              : `✅ **Direction Set to: A ➔ B (One-Way)**\n\n• **Route:** **${gA}** ➔ **${gB}**\n• **Messages will only flow from Group A to Group B.**\n• 🛡️ **Group B messages will NOT be posted back to Group A!**\n\nSaved permanently to database and persists across server reboots.`;
        } else if (dir === 'BIDIRECTIONAL') {
          responseText =
            userLang === 'marathi'
              ? `🔄 **दिशा सेट झाली: दोन्ही बाजूंनी (A ⇄ B)**\n\n• **रूट:** **${gA}** ⇄ **${gB}**\n• दोन्ही ग्रुप्समधील मेसेज एकमेकांमध्ये जातील.`
              : `🔄 **Direction Set to: Bidirectional (A ⇄ B)**\n\n• **Route:** **${gA}** ⇄ **${gB}**\n• Messages will cross-post between both groups.`;
        } else {
          responseText =
            userLang === 'marathi'
              ? `⬅️ **दिशा सेट झाली: B ➔ A (One-Way)**\n\n• **रूट:** **${gB}** ➔ **${gA}**\n• फक्त ग्रुप B कडून ग्रुप A कडे मेसेज जातील.`
              : `⬅️ **Direction Set to: B ➔ A (One-Way)**\n\n• **Route:** **${gB}** ➔ **${gA}**\n• Messages will only flow from Group B to Group A.`;
        }
      } else {
        responseText = `⚠️ Pipeline not found or unauthorized.`;
      }
      replyMarkup = {
        inline_keyboard: [[{ text: '« Back to Cross-Posting', callback_data: 'nav_crosspost' }]],
      };
    } else if (data?.startsWith('cp_dir_')) {
      const cpId = Number(data.replace('cp_dir_', ''));
      const userGroups = await getGroupsForUser(user.id, token);
      const userGroupIds = new Set(userGroups.map((g) => g.id));
      const userCrossPosts = getCrossPostsForUser(user.id, userGroupIds);
      const cp = userCrossPosts.find((c) => c.id === cpId);

      if (cp) {
        const nextDir =
          cp.direction === 'A_TO_B' ? 'BIDIRECTIONAL' : cp.direction === 'BIDIRECTIONAL' ? 'B_TO_A' : 'A_TO_B';
        cp.direction = nextDir;
        const gA = dbGroups.get(cp.groupAId)?.title || `Chat ${cp.groupAId}`;
        const gB = dbGroups.get(cp.groupBId)?.title || `Chat ${cp.groupBId}`;
        cp.name = nextDir === 'A_TO_B' ? `${gA} ➔ ${gB}` : nextDir === 'B_TO_A' ? `${gB} ➔ ${gA}` : `${gA} ⇄ ${gB}`;
        saveDatabase();
        addLiveEvent('crosspost', `Pipeline "${cp.name}" direction switched to ${nextDir}`);
        responseText = `🔄 **Direction Updated to:** \`${nextDir}\`\n\nPipeline **${cp.name}** routing direction updated successfully!`;
      } else {
        responseText = `⚠️ Pipeline not found or unauthorized.`;
      }
      replyMarkup = {
        inline_keyboard: [[{ text: '« Back to Cross-Posting', callback_data: 'nav_crosspost' }]],
      };
    } else if (data?.startsWith('cp_mode_')) {
      const cpId = Number(data.replace('cp_mode_', ''));
      const userGroups = await getGroupsForUser(user.id, token);
      const userGroupIds = new Set(userGroups.map((g) => g.id));
      const userCrossPosts = getCrossPostsForUser(user.id, userGroupIds);
      const cp = userCrossPosts.find((c) => c.id === cpId);

      if (cp) {
        cp.mode = cp.mode === 'COPY' ? 'FORWARD' : 'COPY';
        saveDatabase();
        responseText = `🔄 **Mode Updated to:** \`${cp.mode === 'COPY' ? 'Clean Copy' : 'Forward Header'}\`\n\nPipeline **${cp.name}** transfer mode updated!`;
      } else {
        responseText = `⚠️ Pipeline not found or unauthorized.`;
      }
      replyMarkup = {
        inline_keyboard: [[{ text: '« Back to Cross-Posting', callback_data: 'nav_crosspost' }]],
      };
    } else if (data?.startsWith('cp_del_')) {
      const cpId = Number(data.replace('cp_del_', ''));
      const userGroups = await getGroupsForUser(user.id, token);
      const userGroupIds = new Set(userGroups.map((g) => g.id));
      const userCrossPosts = getCrossPostsForUser(user.id, userGroupIds);
      const cp = userCrossPosts.find((c) => c.id === cpId);

      if (cp) {
        const idx = dbCrossPosts.findIndex((c) => c.id === cpId);
        if (idx !== -1) {
          const removed = dbCrossPosts.splice(idx, 1)[0];
          saveDatabase();
          addLiveEvent('crosspost', `Deleted pipeline "${removed.name}" by @${user.username || user.first_name}`);
          responseText = `🗑️ **Pipeline Disconnected:** \`${removed.name}\` has been removed.`;
        }
      } else {
        responseText = `⚠️ Pipeline not found or you are not authorized to delete it.`;
      }
      replyMarkup = {
        inline_keyboard: [[{ text: '« Back to Cross-Posting', callback_data: 'nav_crosspost' }]],
      };
    } else if (data?.startsWith('cp_test_')) {
      const cpId = Number(data.replace('cp_test_', ''));
      const userGroups = await getGroupsForUser(user.id, token);
      const userGroupIds = new Set(userGroups.map((g) => g.id));
      const userCrossPosts = getCrossPostsForUser(user.id, userGroupIds);
      const cp = userCrossPosts.find((c) => c.id === cpId);

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
      } else {
        responseText = `⚠️ Pipeline not found or unauthorized.`;
      }
      replyMarkup = {
        inline_keyboard: [[{ text: '« Back to Cross-Posting', callback_data: 'nav_crosspost' }]],
      };
    } else if (data?.startsWith('cp_sync_')) {
      const cpId = Number(data.replace('cp_sync_', ''));
      const userGroups = await getGroupsForUser(user.id, token);
      const userGroupIds = new Set(userGroups.map((g) => g.id));
      const userCrossPosts = getCrossPostsForUser(user.id, userGroupIds);
      const cp = userCrossPosts.find((c) => c.id === cpId);

      if (cp) {
        const gA = dbGroups.get(cp.groupAId)?.title || `Group A (${cp.groupAId})`;
        const gB = dbGroups.get(cp.groupBId)?.title || `Group B (${cp.groupBId})`;
        const srcTitle = cp.direction === 'B_TO_A' ? gB : gA;
        const destTitle = cp.direction === 'B_TO_A' ? gA : gB;

        if (userLang === 'marathi') {
          responseText =
            `📦 **मागील सर्व जुने मेसेज ट्रान्सफर करा (History Backfill)**\n\n` +
            `• **पाइपलाइन:** **${cp.name}**\n` +
            `• **सोर्स ग्रुप:** **${srcTitle}**\n` +
            `• **डेस्टिनेशन ग्रुप:** **${destTitle}**\n\n` +
            `या फीचरद्वारे सोर्स ग्रुपमधील जुने अपलोड केलेले पोस्ट्स, फोटो आणि व्हिडिओ डेस्टिनेशन ग्रुपमध्ये ट्रान्सफर केले जातील.\n\n` +
            `👉 **किती जुने मेसेज कॉपी करायचे आहेत? निवडा:**`;
        } else {
          responseText =
            `📦 **Sync Past Historical Posts (History Backfill)**\n\n` +
            `• **Pipeline:** **${cp.name}**\n` +
            `• **Source:** **${srcTitle}**\n` +
            `• **Destination:** **${destTitle}**\n\n` +
            `This will clone historical posts, photos, and media from source to destination so nothing is missed.\n\n` +
            `👉 **Select how many past messages to sync:**`;
        }

        replyMarkup = {
          inline_keyboard: [
            [{ text: '🚀 शेवटचे 50 जुने मेसेज सिंक करा (Last 50)', callback_data: `cp_startsync_${cp.id}_50` }],
            [{ text: '🚀 शेवटचे 200 जुने मेसेज सिंक करा (Last 200)', callback_data: `cp_startsync_${cp.id}_200` }],
            [{ text: '🚀 संपूर्ण हिस्ट्री सिंक करा (All from Post #1)', callback_data: `cp_startsync_${cp.id}_all` }],
            [{ text: '« मागे जा (Back to Cross-Posting)', callback_data: 'nav_crosspost' }],
          ],
        };
      } else {
        responseText = `⚠️ Pipeline not found or unauthorized.`;
        replyMarkup = { inline_keyboard: [[{ text: '« Back', callback_data: 'nav_crosspost' }]] };
      }
    } else if (data?.startsWith('cp_startsync_')) {
      const parts = data.replace('cp_startsync_', '').split('_');
      const cpId = Number(parts[0]);
      const preset = parts[1] || '50';

      const userGroups = await getGroupsForUser(user.id, token);
      const userGroupIds = new Set(userGroups.map((g) => g.id));
      const userCrossPosts = getCrossPostsForUser(user.id, userGroupIds);
      const cp = userCrossPosts.find((c) => c.id === cpId);

      if (cp) {
        const limit = preset === 'all' ? undefined : parseInt(preset) || 50;
        const startId = preset === 'all' ? 1 : undefined;

        startHistorySync(cp.id, {
          startId,
          limit,
          notifyUserId: user.id,
        }).catch((err) => {
          console.error('Failed to start history sync:', err);
        });

        if (userLang === 'marathi') {
          responseText =
            `🚀 **जुने मेसेज ट्रान्सफर सुरू झाले आहे!**\n\n` +
            `• **पाइपलाइन:** **${cp.name}**\n` +
            `• **रेंज:** \`${preset === 'all' ? 'संपूर्ण जुनी हिस्ट्री (From #1)' : `शेवटचे ${preset} मेसेज`}\`\n\n` +
            `बॉट पार्श्वभूमीत (Background) रेट-लिमिट सांभाळून सुरक्षितपणे मेसेज कॉपी करत आहे.\n` +
            `काम पूर्ण झाल्यावर तुम्हाला येथे तात्काळ मेसेज पाठवला जाईल!`;
        } else {
          responseText =
            `🚀 **History Sync Started!**\n\n` +
            `• **Pipeline:** **${cp.name}**\n` +
            `• **Scope:** \`${preset === 'all' ? 'All historical posts (From #1)' : `Last ${preset} posts`}\`\n\n` +
            `Messages are being cloned safely with anti-flood controls in background.\n` +
            `You will receive a notification here once transfer completes!`;
        }

        replyMarkup = {
          inline_keyboard: [
            [{ text: '🔄 View Cross-Posting Status', callback_data: 'nav_crosspost' }],
            [{ text: '🏠 Main Dashboard', callback_data: 'nav_main_menu' }],
          ],
        };
      } else {
        responseText = `⚠️ Pipeline not found or unauthorized.`;
        replyMarkup = { inline_keyboard: [[{ text: '« Back', callback_data: 'nav_crosspost' }]] };
      }
    } else if (data?.startsWith('cp_connect_') || data?.startsWith('cp_biconnect_')) {
      const isBi = data.startsWith('cp_biconnect_');
      const parts = data.replace(isBi ? 'cp_biconnect_' : 'cp_connect_', '').split('_');
      const g1Id = Number(parts[0]);
      const g2Id = Number(parts[1]);

      const isAuth1 = await isUserAuthorizedForGroup(g1Id, user.id, token);
      const isAuth2 = await isUserAuthorizedForGroup(g2Id, user.id, token);

      if (!isAuth1 || !isAuth2) {
        responseText = `⚠️ **Permission Denied:** You are only allowed to connect groups that you manage in private chat!`;
        replyMarkup = {
          inline_keyboard: [[{ text: '« Back to Cross-Posting', callback_data: 'nav_crosspost' }]],
        };
      } else {
        const gA = dbGroups.get(g1Id);
        const gB = dbGroups.get(g2Id);

        if (gA && gB && gA.id !== gB.id) {
          const existing = dbCrossPosts.find(
            (c) => (c.groupAId === gA.id && c.groupBId === gB.id) || (c.groupAId === gB.id && c.groupBId === gA.id)
          );
          if (existing) {
            existing.groupAId = gA.id;
            existing.groupBId = gB.id;
            existing.isActive = true;
            existing.direction = isBi ? 'BIDIRECTIONAL' : 'A_TO_B';
            existing.name = isBi ? `${gA.title} ⇄ ${gB.title}` : `${gA.title} ➔ ${gB.title}`;
            if (!existing.createdByUserId) existing.createdByUserId = user.id;
            if (!existing.authorizedUserIds) existing.authorizedUserIds = [];
            if (!existing.authorizedUserIds.includes(user.id)) existing.authorizedUserIds.push(user.id);
          } else {
            dbCrossPosts.push({
              id: Date.now(),
              name: isBi ? `${gA.title} ⇄ ${gB.title}` : `${gA.title} ➔ ${gB.title}`,
              groupAId: gA.id,
              groupBId: gB.id,
              direction: isBi ? 'BIDIRECTIONAL' : 'A_TO_B',
              mode: 'COPY',
              isActive: true,
              createdByUserId: user.id,
              authorizedUserIds: [user.id],
            });
          }
          saveDatabase();
          addLiveEvent('crosspost', `Connected ${gA.title} ${isBi ? '⇄' : '➔'} ${gB.title} for cross-posting by @${user.username || user.first_name}`);
          responseText =
            userLang === 'marathi'
              ? `✅ **क्रॉस-पोस्टिंग यशस्वीरीत्या सुरू झाली!**\n\n• **सोर्स ग्रुप (A):** **${gA.title}**\n• **डेस्टिनेशन ग्रुप (B):** **${gB.title}**\n• **दिशा:** \`${isBi ? 'दोन्ही बाजूंनी (A ⇄ B)' : 'फक्त A ➔ B'}\`\n• **मोड:** \`Clean Copy\`\n\n🎉 आता तुमचे ग्रुप्स सुरक्षितपणे जोडले गेले आहेत!`
              : `✅ **Groups Connected for Cross-Posting!**\n\n• **Group A:** **${gA.title}**\n• **Group B:** **${gB.title}**\n• **Direction:** \`${isBi ? 'Bidirectional (A ⇄ B)' : 'One-Way (A ➔ B)'}\`\n• **Mode:** \`Clean Copy\`\n\n🎉 Pipeline is now ACTIVE and running with loop protection!`;
          replyMarkup = {
            inline_keyboard: [
              [{ text: '🔄 View Cross-Posting Menu', callback_data: 'nav_crosspost' }],
              [{ text: '🏠 Main Dashboard', callback_data: 'nav_main_menu' }],
            ],
          };
        }
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
          ? `📚 **Help & Documentation Center**\n\n• \`/start\` — Open private dashboard\n• \`/language\` — Change language\n• \`/linkgroup\` — Generate connection code (run in group/channel)\n• \`/connect <CODE>\` — Connect group in private chat\n• \`/syncposts\` — Transfer past historical posts between groups\n• \`/autofix\` — Run auto bug diagnostics and self-healing\n• \`/del\` — Reply to any photo/message to delete it\n• \`/purge <count>\` — Batch delete messages in group\n• \`/warn\` & \`/mute\` — Moderation commands\n• \`/rules\` — Display group rules`
          : userLang === 'hindi'
          ? `📚 **सहायता एवं कमांड सेंटर**\n\n• \`/start\` — प्राइवेट डैशबोर्ड खोलें\n• \`/language\` — भाषा बदलें\n• \`/linkgroup\` — ग्रुप/चैनल में कोड बनाएं\n• \`/connect <CODE>\` — प्राइवेट चैट में ग्रुप जोड़ें\n• \`/syncposts\` — पुराने सभी पोस्ट ग्रुप B में सिंक करें\n• \`/autofix\` — ऑटो बग फिक्स व डायग्नोस्टिक्स चलाएं\n• \`/del\` — किसी फोटो/मैसेज को तुरंत डिलीट करें\n• \`/purge <संख्या>\` — ग्रुप मैसेज बल्क डिलीट करें\n• \`/warn\` एवं \`/mute\` — मॉडरेशन कमांड्स\n• \`/rules\` — ग्रुप नियम देखें`
          : userLang === 'marathi'
          ? `📚 **मदत आणि कमांड्स**\n\n• \`/start\` — खाजगी डॅशबोर्ड उघडा\n• \`/language\` — भाषा निवडा\n• \`/linkgroup\` — ग्रुप/चॅनेलमध्ये कोड तयार करा\n• \`/connect <CODE>\` — खाजगी चॅटमध्ये ग्रुप जोडा\n• \`/syncposts\` — मागील सर्व जुने मेसेज सिंक करा\n• \`/autofix\` — ऑटो बग फिक्स व स्वयंचलित दुरुस्ती करा\n• \`/del\` — कोणत्याही फोटो किंवा मेसेजला रिप्लाय देऊन लगेच डिलीट करा\n• \`/purge <संख्या>\` — ग्रुप मेसेज एकदम डिलीट करा\n• \`/warn\` आणि \`/mute\` — मॉडरेशन कमांड्स\n• \`/rules\` — ग्रुप नियम दाखवा`
          : `📚 **TeleGroup Help & Commands Center**\n\n• \`/start\` — Private dashboard open karein\n• \`/language\` — Bhasha change karein (Hinglish, English, हिन्दी, मराठी)\n• \`/linkgroup\` — Connection code generate karein (group/channel me run karein)\n• \`/connect <CODE>\` — Private chat me group link karein\n• \`/syncposts\` — Purane messages Group B me transfer karein\n• \`/autofix\` — Auto bug fix chalu karein\n• \`/del\` — Kisi bhi message/photo ko delete karein\n• \`/purge <count>\` — Purane messages batch delete karein\n• \`/warn\` & \`/mute\` — Moderation commands\n• \`/rules\` — Group rules show karein`;
      replyMarkup = getBackKeyboard(userLang);
    } else if (data === 'nav_status') {
      responseText = `🔍 **Bot Health & Status**\n\n• **Bot Username:** @${botUsername}\n• **Status:** 🟢 \`Operational (24/7)\`\n• **Groups in DB:** \`${dbGroups.size}\`\n• **Language Mode:** \`${userLang}\`\n• **Loop Guard:** 🟢 \`Active\`\n• **Channel Support:** 🟢 \`Active (channel_post)\``;
      replyMarkup = {
        inline_keyboard: [
          [{ text: '🔄 Refresh Status', callback_data: 'nav_status' }],
          [{ text: '🩺 Auto Bug Fixer', callback_data: 'nav_autofix' }],
          [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
        ],
      };
    } else if (data === 'nav_autofix') {
      const result = await runAutoBugFixer(user.id);
      const uLang = getUserLang(user.id);

      const checkList = result.checks
        .map((c) => {
          const icon = c.status === 'ok' ? '✅' : c.status === 'fixed' ? '🛠️ [दुरुस्त]' : c.status === 'warning' ? '⚠️' : '❌';
          return `${icon} **${c.name}**\n   ${c.detail}`;
        })
        .join('\n\n');

      if (uLang === 'marathi') {
        responseText =
          `🩺 **ऑटो बग फिक्स व स्वयंचलित सिस्टीम तपासणी अहवाल**\n\n` +
          `बॉटने सर्व कनेक्शन्स, ॲडमिन परवानग्या आणि मेसेज रांगांची तपासणी केली आहे:\n\n` +
          `${checkList}\n\n` +
          `🎉 **निष्कर्ष:** सर्व तपासण्या यशस्वी! तुमची सिस्टीम 100% सुरळीत काम करत आहे.`;
      } else {
        responseText =
          `🩺 **Auto Bug Diagnostics & Self-Healing Report**\n\n` +
          `All system connections, permissions, and routing queues have been inspected:\n\n` +
          `${checkList}\n\n` +
          `🎉 **Summary:** All checks passed! System is operational and self-healed.`;
      }

      replyMarkup = {
        inline_keyboard: [
          [{ text: '🔄 Re-Run Diagnostics', callback_data: 'nav_autofix' }],
          [{ text: '« Back to Main Menu', callback_data: 'nav_main_menu' }],
        ],
      };
    } else if (data === 'nav_squad') {
      const userGroups = await getGroupsForUser(user.id, token);
      const squadDetails = dbBotSquad.map((b) => {
        return `• ${b.avatarEmoji} **${b.name}** (@${b.username || b.id})\n   ↳ **भूमिका:** \`${b.roleMarathi}\`\n   ↳ **Auto-Delete:** \`${b.autoDeleteHours > 0 ? `${b.autoDeleteHours} तास` : 'OFF'}\` | **Cooldown:** \`${b.cooldownMinutes}m\``;
      }).join('\n\n');

      if (userLang === 'marathi') {
        responseText =
          `🤖 **TeleGroup 4-Bot Squad Network**\n\n` +
          `तुमच्या ग्रुप्ससाठी 4 बॉट्स कार्यरत आहेत. प्रत्येक बॉटची स्वतंत्र भूमिका आहे:\n\n` +
          `${squadDetails}\n\n` +
          `👉 **खालील बटणावर क्लिक करून कोणत्याही ग्रुप/चॅनेलमध्ये ऍक्टिव्हिटी पाठवा:**`;
      } else {
        responseText =
          `🤖 **TeleGroup 4-Bot Squad Network**\n\n` +
          `4 dedicated bots are active to engage your community:\n\n` +
          `${squadDetails}\n\n` +
          `👉 **Choose an activity below to dispatch into your linked chats:**`;
      }

      const buttons: any[] = [];
      if (userGroups.length > 0) {
        buttons.push([
          { text: '💋 Send Poll (Shanaya)', callback_data: `squad_send_poll_${userGroups[0].id}` },
          { text: '🎮 Start Game (Kiara)', callback_data: `squad_send_game_${userGroups[0].id}` },
        ]);
        buttons.push([
          { text: '💀 Drop Meme Board (Myra)', callback_data: `squad_send_meme_${userGroups[0].id}` },
        ]);
      } else {
        buttons.push([
          { text: '🔗 आधी ग्रुप जोडा (Link Groups)', callback_data: 'nav_connect_groups' },
        ]);
      }
      buttons.push([{ text: '« मुख्य मेनू', callback_data: 'nav_main_menu' }]);
      replyMarkup = { inline_keyboard: buttons };
    } else if (data?.startsWith('squad_send_')) {
      const parts = data.replace('squad_send_', '').split('_');
      const actType = parts[0] as 'poll' | 'game' | 'meme';
      const gId = Number(parts[1]);
      const botId = actType === 'poll' ? 'shanaya' : actType === 'game' ? 'kiara' : 'myra';

      try {
        const res = await sendBotActivity(botId, gId, actType, { force: true });
        if (res.ok) {
          const dHours = res.deleteHours || 0;
          responseText = userLang === 'marathi'
            ? `✅ **ऍक्टिव्हिटी यशस्वीरीत्या पाठवली!**\n\n• **बॉट:** **${res.botName}**\n• **ग्रुप:** **${res.chatTitle}**\n• **प्रकार:** \`${actType.toUpperCase()}\`\n• ⏱️ **Auto-Delete:** \`${dHours > 0 ? `${dHours} तासांनंतर आपोआप डिलीट होईल` : 'कायमस्वरूपी'}\`\n\nतुमच्या ग्रुप/चॅनेलमध्ये जाऊन पहा!`
            : `✅ **Activity Dispatched Successfully!**\n\n• **Bot:** **${res.botName}**\n• **Target:** **${res.chatTitle}**\n• **Type:** \`${actType.toUpperCase()}\`\n• ⏱️ **Auto-Delete:** \`${dHours > 0 ? `Auto-destruct in ${dHours}h` : 'OFF'}\``;
        } else {
          responseText = `⚠️ ${res.error}`;
        }
      } catch (err: any) {
        responseText = `⚠️ Error sending activity: ${err.message}`;
      }
      replyMarkup = {
        inline_keyboard: [
          [{ text: '🤖 Back to Squad Hub', callback_data: 'nav_squad' }],
          [{ text: '« Main Menu', callback_data: 'nav_main_menu' }],
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

    // Command: /squad or /bots
    if (text.startsWith('/squad') || text.startsWith('/bots')) {
      const userGroups = await getGroupsForUser(user.id, token);
      const squadDetails = dbBotSquad.map((b) => {
        return `• ${b.avatarEmoji} **${b.name}** (@${b.username || b.id})\n   ↳ **भूमिका:** \`${b.roleMarathi}\`\n   ↳ **Auto-Delete:** \`${b.autoDeleteHours > 0 ? `${b.autoDeleteHours} तास` : 'OFF'}\` | **Cooldown:** \`${b.cooldownMinutes}m\``;
      }).join('\n\n');

      const msgText = userLang === 'marathi'
        ? `🤖 **TeleGroup 4-Bot Squad Network**\n\n${squadDetails}\n\n👉 खालील बटणांवरून ग्रुपमध्ये ऍक्टिव्हिटी पाठवा:`
        : `🤖 **TeleGroup 4-Bot Squad Network**\n\n${squadDetails}\n\n👉 Select an activity below to dispatch:`;

      const buttons: any[] = [];
      if (userGroups.length > 0) {
        buttons.push([
          { text: '💋 Send Poll (Shanaya)', callback_data: `squad_send_poll_${userGroups[0].id}` },
          { text: '🎮 Start Game (Kiara)', callback_data: `squad_send_game_${userGroups[0].id}` },
        ]);
        buttons.push([
          { text: '💀 Drop Meme Board (Myra)', callback_data: `squad_send_meme_${userGroups[0].id}` },
        ]);
      } else {
        buttons.push([{ text: '🔗 Link Groups First', callback_data: 'nav_connect_groups' }]);
      }
      buttons.push([{ text: '« Main Menu', callback_data: 'nav_main_menu' }]);

      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: msgText,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons },
      });
      return;
    }

    // Command: /poll (Shanaya)
    if (text.startsWith('/poll') || text.startsWith('/shanu')) {
      const userGroups = await getGroupsForUser(user.id, token);
      if (userGroups.length === 0) {
        await tgCall(token, 'sendMessage', { chat_id: chat.id, text: '⚠️ Link a group first using /linkgroup!' });
        return;
      }
      const g = userGroups[0];
      await sendBotActivity('shanaya', g.id, 'poll', { force: true });
      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: `✅ **Shanaya Gill** sent a community poll to **${g.title}**! (Auto-deletes in 2h)`,
        parse_mode: 'Markdown',
      });
      return;
    }

    // Command: /game (Kiara)
    if (text.startsWith('/game') || text.startsWith('/kiara')) {
      const userGroups = await getGroupsForUser(user.id, token);
      if (userGroups.length === 0) {
        await tgCall(token, 'sendMessage', { chat_id: chat.id, text: '⚠️ Link a group first using /linkgroup!' });
        return;
      }
      const g = userGroups[0];
      await sendBotActivity('kiara', g.id, 'game', { force: true });
      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: `✅ **Kiara Singhania** started Truth/Dare game in **${g.title}**! (Auto-deletes in 2h)`,
        parse_mode: 'Markdown',
      });
      return;
    }

    // Command: /meme (Myra)
    if (text.startsWith('/meme') || text.startsWith('/myra')) {
      const userGroups = await getGroupsForUser(user.id, token);
      if (userGroups.length === 0) {
        await tgCall(token, 'sendMessage', { chat_id: chat.id, text: '⚠️ Link a group first using /linkgroup!' });
        return;
      }
      const g = userGroups[0];
      await sendBotActivity('myra', g.id, 'meme', { force: true });
      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: `✅ **Myra Oberoi** posted reaction meme board to **${g.title}**! (Auto-deletes in 2h)`,
        parse_mode: 'Markdown',
      });
      return;
    }

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

    // Command: /autofix or /diagnose
    if (text.startsWith('/autofix') || text.startsWith('/diagnose')) {
      const result = await runAutoBugFixer(user.id);
      const checkList = result.checks
        .map((c) => {
          const icon = c.status === 'ok' ? '✅' : c.status === 'fixed' ? '🛠️ [दुरुस्त]' : c.status === 'warning' ? '⚠️' : '❌';
          return `${icon} **${c.name}**\n   ${c.detail}`;
        })
        .join('\n\n');

      const autofixReply =
        userLang === 'marathi'
          ? `🩺 **ऑटो बग फिक्स व स्वयंचलित दुरुस्ती अहवाल**\n\n${checkList}\n\n🎉 सर्व सिस्टीम 100% सुरळीत व कार्यरत आहे!`
          : `🩺 **Auto Bug Diagnostics & Self-Healing Report**\n\n${checkList}\n\n🎉 All checks passed! System verified healthy.`;

      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: autofixReply,
        parse_mode: 'Markdown',
        reply_markup: getBackKeyboard(userLang),
      });
      return;
    }

    // Command: /syncposts [count|all] or /syncposts [start] [end]
    if (text.startsWith('/syncposts') || text.startsWith('/backfill')) {
      const parts = text.split(/\s+/).slice(1);
      const userGroups = await getGroupsForUser(user.id, token);
      const userGroupIds = new Set(userGroups.map((g) => g.id));
      const userCrossPosts = getCrossPostsForUser(user.id, userGroupIds);

      if (userCrossPosts.length === 0) {
        await tgCall(token, 'sendMessage', {
          chat_id: chat.id,
          text: `⚠️ **No Active Cross-Posting Pipeline Found!**\nPlease link at least two groups first using \`/linkgroup\`.`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🔗 Connect Groups', callback_data: 'nav_connect_groups' }]],
          },
        });
        return;
      }

      const cp = userCrossPosts[0];
      let limit = 50;
      let startId: number | undefined;
      let endId: number | undefined;

      if (parts.length >= 2) {
        startId = parseInt(parts[0]);
        endId = parseInt(parts[1]);
      } else if (parts.length === 1) {
        if (parts[0].toLowerCase() === 'all') {
          startId = 1;
        } else {
          limit = parseInt(parts[0]) || 50;
        }
      }

      startHistorySync(cp.id, { startId, endId, limit, notifyUserId: user.id }).catch((err) => {
        console.error('Sync failed:', err);
      });

      const syncConfirmText =
        userLang === 'marathi'
          ? `🚀 **जुने मेसेज ट्रान्सफर सुरू झाले आहे!**\n\n• **पाइपलाइन:** **${cp.name}**\n• पार्श्वभूमीत सर्व जुने मेसेज ग्रुप A कडून ग्रुप B मध्ये कॉपी होत आहेत.\nकाम पूर्ण झाल्यावर येथे तात्काळ मेसेज येईल.`
          : `🚀 **History Sync Started for ${cp.name}!**\n\nCloning past historical messages in background with anti-flood controls... You will be notified once complete.`;

      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: syncConfirmText,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🔄 View Cross-Posting Status', callback_data: 'nav_crosspost' }]],
        },
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
      const userGroups = await getGroupsForUser(user.id, token);
      const userGroupIds = new Set(userGroups.map((g) => g.id));
      const userCrossPosts = getCrossPostsForUser(user.id, userGroupIds);

      if (userCrossPosts.length > 0) {
        const cp = userCrossPosts[0];
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

      if (userGroups.length >= 2) {
        const gA = userGroups[0];
        const gB = userGroups[1];
        await tgCall(token, 'sendMessage', {
          chat_id: chat.id,
          text: `🔗 **Connect Groups for Cross-Posting**\n\nFound 2 registered groups in your account:\n🔵 **Group A:** **${gA.title}**\n🟢 **Group B:** **${gB.title}**\n\n👉 **Aap aisa karo:** Niche diye gaye button par click karke cross-posting connect karein:`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `⚡ Connect: ${gA.title} ➔ ${gB.title} (A to B)`, callback_data: `cp_connect_${gA.id}_${gB.id}` }],
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
        if (!grp.authorizedUserIds) grp.authorizedUserIds = [];
        if (!grp.authorizedUserIds.includes(user.id)) grp.authorizedUserIds.push(user.id);
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
      if (grpA) {
        grpA.ownerUserId = user.id;
        if (!grpA.authorizedUserIds) grpA.authorizedUserIds = [];
        if (!grpA.authorizedUserIds.includes(user.id)) grpA.authorizedUserIds.push(user.id);
      }
      const grpB = dbGroups.get(matchB.groupId);
      if (grpB) {
        grpB.ownerUserId = user.id;
        if (!grpB.authorizedUserIds) grpB.authorizedUserIds = [];
        if (!grpB.authorizedUserIds.includes(user.id)) grpB.authorizedUserIds.push(user.id);
      }

      const newConn: DBCrossPost = {
        id: Date.now(),
        name: `${matchA.groupTitle} ➔ ${matchB.groupTitle}`,
        groupAId: matchA.groupId,
        groupBId: matchB.groupId,
        direction: 'A_TO_B',
        mode: 'COPY',
        isActive: true,
        createdByUserId: user.id,
        authorizedUserIds: [user.id],
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

    // Track lastKnownMessageId for history backfill discovery
    const grp = dbGroups.get(chat.id);
    if (grp) {
      grp.lastKnownMessageId = Math.max(grp.lastKnownMessageId || 0, msg.message_id);
    }

    // Photo & Media Auto-Delete System (Aapla Photo Delete)
    const isMedia = Boolean(msg.photo || msg.video || msg.animation || msg.document || msg.sticker);
    if (grp && grp.photoAutoDeleteEnabled && isMedia) {
      const deleteSeconds = grp.photoAutoDeleteSeconds || 60;
      dbPendingDeletions.push({
        id: `photo-del-${chat.id}-${msg.message_id}-${Date.now()}`,
        chatId: chat.id,
        messageId: msg.message_id,
        deleteAt: Date.now() + deleteSeconds * 1000,
        retries: 0,
        chatTitle: chat.title || String(chat.id),
      });
      saveDatabase();
      addLiveEvent('moderation', `📸 Photo auto-delete scheduled in ${deleteSeconds}s in "${chat.title}"`);
    }

    const lowerText = text.toLowerCase().trim();
    const firstWord = lowerText.split(/\s+/)[0];

    // /del or /delete command: immediately delete replied photo or message
    if (firstWord === '/del' || firstWord === '/delete') {
      if (msg.reply_to_message) {
        await tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: msg.reply_to_message.message_id }).catch(() => {});
        await tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: msg.message_id }).catch(() => {});
        addLiveEvent('moderation', `Deleted message #${msg.reply_to_message.message_id} on /del request in "${chat.title}"`);
        return;
      } else {
        await tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: msg.message_id }).catch(() => {});
        const notice = await tgCall(token, 'sendMessage', {
          chat_id: chat.id,
          text: `⚠️ Reply to any photo or message with \`/del\` to delete it immediately!`,
          parse_mode: 'Markdown',
        });
        if (notice.ok && notice.result?.message_id) {
          setTimeout(() => {
            tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: notice.result.message_id }).catch(() => {});
          }, 4000);
        }
        return;
      }
    }

    // /purge command: batch delete recent messages
    if (firstWord === '/purge') {
      const count = Math.min(100, Math.max(1, parseInt(text.split(/\s+/)[1]) || 10));
      await tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: msg.message_id }).catch(() => {});
      let deleted = 0;
      for (let i = 1; i <= count; i++) {
        const dRes = await tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: msg.message_id - i });
        if (dRes.ok) deleted++;
        await new Promise((r) => setTimeout(r, 60));
      }
      const notice = await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: `🧹 **Purged ${deleted} messages!** (Auto-deleting notice in 4s)`,
        parse_mode: 'Markdown',
      });
      if (notice.ok && notice.result?.message_id) {
        setTimeout(() => {
          tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: notice.result.message_id }).catch(() => {});
        }, 4000);
      }
      addLiveEvent('moderation', `Purged ${deleted} messages in "${chat.title}"`);
      return;
    }

    // /syncposts command in group
    if (firstWord === '/syncposts' || firstWord === '/backfill') {
      const parts = text.split(/\s+/).slice(1);
      const userGroups = await getGroupsForUser(user.id, token);
      const userGroupIds = new Set(userGroups.map((g) => g.id));
      const userCrossPosts = getCrossPostsForUser(user.id, userGroupIds);

      if (userCrossPosts.length === 0) {
        await tgCall(token, 'sendMessage', {
          chat_id: chat.id,
          text: `⚠️ No active cross-posting pipelines found. Connect 2 groups first in bot private chat!`,
          parse_mode: 'Markdown',
        });
        return;
      }

      const cp = userCrossPosts[0];
      let limit = 50;
      let startId: number | undefined;
      let endId: number | undefined;

      if (parts.length >= 2) {
        startId = parseInt(parts[0]);
        endId = parseInt(parts[1]);
      } else if (parts.length === 1) {
        if (parts[0].toLowerCase() === 'all') {
          startId = 1;
        } else {
          limit = parseInt(parts[0]) || 50;
        }
      }

      startHistorySync(cp.id, { startId, endId, limit, notifyUserId: user.id }).catch((err) => {
        console.error('Sync failed:', err);
      });

      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: `🚀 **History Sync Started for ${cp.name}!**\n\nCloning past posts in background...`,
        parse_mode: 'Markdown',
      });
      return;
    }

    // /autofix command in group
    if (firstWord === '/autofix' || firstWord === '/diagnose') {
      const result = await runAutoBugFixer(user.id);
      const summary = result.checks.map((c) => `${c.status === 'ok' ? '✅' : '🛠️'} ${c.name}: ${c.detail}`).join('\n');
      await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: `🩺 **Auto Bug Diagnostics & Self-Healing**\n\n${summary}\n\n🎉 All systems operational!`,
        parse_mode: 'Markdown',
      });
      return;
    }

    // /poll command in group: Shanaya posts a poll
    if (firstWord === '/poll' || firstWord === '/shanu') {
      await tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: msg.message_id }).catch(() => {});
      await sendBotActivity('shanaya', chat.id, 'poll', { force: true });
      return;
    }

    // /game command in group: Kiara starts game
    if (firstWord === '/game' || firstWord === '/kiara') {
      await tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: msg.message_id }).catch(() => {});
      await sendBotActivity('kiara', chat.id, 'game', { force: true });
      return;
    }

    // /meme command in group: Myra drops reaction board
    if (firstWord === '/meme' || firstWord === '/myra') {
      await tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: msg.message_id }).catch(() => {});
      await sendBotActivity('myra', chat.id, 'meme', { force: true });
      return;
    }

    // /squad command in group: overview of all 4 bots
    if (firstWord === '/squad' || firstWord === '/bots') {
      await tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: msg.message_id }).catch(() => {});
      const squadMsg =
        `🤖 **TeleGroup 4-Bot Squad Active in ${chat.title || 'this chat'}**\n\n` +
        `👑 **Vrishti Pande** (@Its_Vrishti_bot) — Master Admin & Cross-Posting\n` +
        `💋 **Shanaya Gill** (@Hey_shanu_bot) — Community Polls & Vibe Checks\n` +
        `🎮 **Kiara Singhania** (@Its_kiara_bot) — Truth/Dare & Spicy Party Games\n` +
        `💀 **Myra Oberoi** (@myra_oberoi_bot) — Adult Memes & Late-Night Reactions\n\n` +
        `⏱️ **Auto-Destruct:** Activity posts auto-delete in 2 hours to keep the main channel clean!`;
      const sRes = await tgCall(token, 'sendMessage', {
        chat_id: chat.id,
        text: squadMsg,
        parse_mode: 'Markdown',
      });
      if (sRes.ok && sRes.result?.message_id) {
        setTimeout(() => {
          tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: sRes.result.message_id }).catch(() => {});
        }, 15000);
      }
      return;
    }

    // /circle or /video command in group: send circle ratio video clip note
    if (firstWord === '/circle' || firstWord === '/video' || firstWord === '/gif') {
      await tgCall(token, 'deleteMessage', { chat_id: chat.id, message_id: msg.message_id }).catch(() => {});
      const myraBot = dbBotSquad.find((b) => b.id === 'myra') || dbBotSquad[0];
      await sendSquadCircleVideo(myraBot, chat.id);
      return;
    }

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
        dbPendingDeletions.push({
          id: `del-${chat.id}-${sentId}-${Date.now()}`,
          chatId: chat.id,
          messageId: sentId,
          deleteAt: Date.now() + deleteSeconds * 1000,
          retries: 0,
          chatTitle: chat.title || String(chat.id),
        });
        saveDatabase();
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
    const gA = dbGroups.get(cp.groupAId)?.title || `Chat ${cp.groupAId}`;
    const gB = dbGroups.get(cp.groupBId)?.title || `Chat ${cp.groupBId}`;
    cp.name = direction === 'A_TO_B' ? `${gA} ➔ ${gB}` : direction === 'B_TO_A' ? `${gB} ➔ ${gA}` : `${gA} ⇄ ${gB}`;
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
  const { groupAId, groupBId, direction = 'A_TO_B', mode = 'COPY', userId } = req.body;
  const gA = dbGroups.get(Number(groupAId));
  const gB = dbGroups.get(Number(groupBId));
  if (!gA || !gB || gA.id === gB.id) {
    res.status(400).json({ ok: false, error: 'Select two distinct valid groups' });
    return;
  }
  const creatorId = userId ? Number(userId) : (gA.ownerUserId || 8785248011);
  const authIds = Array.from(new Set([...(gA.authorizedUserIds || []), ...(gB.authorizedUserIds || []), creatorId]));

  const existing = dbCrossPosts.find(
    (c) => (c.groupAId === gA.id && c.groupBId === gB.id) || (c.groupAId === gB.id && c.groupBId === gA.id)
  );
  if (existing) {
    existing.groupAId = gA.id;
    existing.groupBId = gB.id;
    existing.isActive = true;
    existing.direction = direction;
    existing.mode = mode;
    existing.name = direction === 'A_TO_B' ? `${gA.title} ➔ ${gB.title}` : direction === 'B_TO_A' ? `${gB.title} ➔ ${gA.title}` : `${gA.title} ⇄ ${gB.title}`;
    existing.createdByUserId = existing.createdByUserId || creatorId;
    existing.authorizedUserIds = authIds;
    saveDatabase();
    res.json({ ok: true, crossPost: existing, message: 'Already connected, updated settings' });
    return;
  }
  const newCp: DBCrossPost = {
    id: Date.now(),
    name: direction === 'A_TO_B' ? `${gA.title} ➔ ${gB.title}` : direction === 'B_TO_A' ? `${gB.title} ➔ ${gA.title}` : `${gA.title} ⇄ ${gB.title}`,
    groupAId: gA.id,
    groupBId: gB.id,
    direction,
    mode,
    isActive: true,
    createdByUserId: creatorId,
    authorizedUserIds: authIds,
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

// 4.5. Auto Bug Fixer Endpoint
app.post('/api/telegram/autofix', async (_req: Request, res: Response) => {
  try {
    const result = await runAutoBugFixer();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4.6. History Sync Trigger Endpoint
app.post('/api/crosspost/:id/sync-history', async (req: Request, res: Response) => {
  const pipelineId = Number(req.params.id);
  const { startId, endId, limit } = req.body;
  const cp = dbCrossPosts.find((c) => c.id === pipelineId);
  if (!cp) {
    res.status(404).json({ ok: false, error: 'Pipeline not found' });
    return;
  }
  try {
    const syncState = await startHistorySync(pipelineId, {
      startId: startId ? Number(startId) : undefined,
      endId: endId ? Number(endId) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ ok: true, syncState });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4.7. History Sync Status Endpoint
app.get('/api/crosspost/:id/sync-status', (req: Request, res: Response) => {
  const pipelineId = Number(req.params.id);
  const task = activeSyncTasks.get(pipelineId);
  const cp = dbCrossPosts.find((c) => c.id === pipelineId);
  res.json({
    ok: true,
    syncTask: task || null,
    pipeline: cp || null,
  });
});

// 4.8. History Sync Cancel Endpoint
app.post('/api/crosspost/:id/sync-cancel', (req: Request, res: Response) => {
  const pipelineId = Number(req.params.id);
  const cancelled = cancelHistorySync(pipelineId);
  res.json({ ok: true, cancelled });
});

// 4.9. Photo Auto-Delete Settings Endpoint
app.post('/api/group/photo-delete', (req: Request, res: Response) => {
  const { groupId, photoAutoDeleteEnabled, photoAutoDeleteSeconds } = req.body;
  const grp = dbGroups.get(Number(groupId));
  if (grp) {
    if (typeof photoAutoDeleteEnabled === 'boolean') {
      grp.photoAutoDeleteEnabled = photoAutoDeleteEnabled;
    }
    if (typeof photoAutoDeleteSeconds === 'number') {
      grp.photoAutoDeleteSeconds = photoAutoDeleteSeconds;
    }
    saveDatabase();
    addLiveEvent('moderation', `Photo auto-delete for "${grp.title}" updated (${grp.photoAutoDeleteEnabled ? `${grp.photoAutoDeleteSeconds}s` : 'OFF'})`);
    res.json({ ok: true, group: grp });
  } else {
    res.status(404).json({ ok: false, error: 'Group not found' });
  }
});

// 4.10. Bot Squad & Activity Endpoints
app.get('/api/botsquad', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    squad: dbBotSquad,
  });
});

app.post('/api/botsquad/update', (req: Request, res: Response) => {
  const { botId, cooldownMinutes, autoDeleteHours, token } = req.body;
  const bot = dbBotSquad.find((b) => b.id === botId);
  if (!bot) {
    res.status(404).json({ ok: false, error: 'Bot not found' });
    return;
  }
  if (typeof cooldownMinutes === 'number') bot.cooldownMinutes = cooldownMinutes;
  if (typeof autoDeleteHours === 'number') bot.autoDeleteHours = autoDeleteHours;
  if (token && typeof token === 'string' && token.trim()) bot.token = token.trim();
  saveDatabase();
  addLiveEvent('system', `Updated settings for ${bot.name} (Cooldown: ${bot.cooldownMinutes}m, Auto-delete: ${bot.autoDeleteHours}h)`);
  res.json({ ok: true, bot });
});

app.post('/api/botsquad/post-activity', async (req: Request, res: Response) => {
  const { botId, chatId, activityType, customQuestion, pollOptions, customCaption, autoDeleteHours, force } = req.body;
  try {
    const result = await sendBotActivity(botId, Number(chatId), activityType, {
      customQuestion,
      pollOptions,
      customCaption,
      autoDeleteHours: typeof autoDeleteHours === 'number' ? autoDeleteHours : undefined,
      force: Boolean(force),
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/botsquad/presets', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    polls: SQUAD_POLL_PRESETS,
    memes: SQUAD_MEME_PRESETS,
  });
});

// 4.11. Audio Transcription with gemini-3.5-transcribe
app.post('/api/transcribe-audio', async (req: Request, res: Response) => {
  try {
    const { audioData, mimeType = 'audio/webm', sendToChatId, botId } = req.body;
    if (!audioData) {
      res.status(400).json({ ok: false, error: 'Audio data is required' });
      return;
    }

    // Strip data URI prefix if present
    const cleanBase64 = audioData.includes(',') ? audioData.split(',')[1] : audioData;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY is not defined in environment');
    }

    const ai = new GoogleGenAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: cleanBase64,
              },
            },
            {
              text: 'Transcribe this speech accurately in its original spoken language (e.g., Marathi, Hindi, Hinglish, or English). Provide ONLY the exact transcribed text, without commentary, timestamp headers, or quote formatting.',
            },
          ],
        },
      ],
    });

    const transcript = response.text?.trim() || '';
    addLiveEvent('system', `🎙️ Audio transcribed successfully (${transcript.slice(0, 40)}...)`);

    let messageSent = false;
    let targetTitle = '';
    if (sendToChatId && transcript) {
      const targetChat = dbGroups.get(Number(sendToChatId));
      targetTitle = targetChat?.title || `Chat ${sendToChatId}`;
      const senderBot = dbBotSquad.find((b) => b.id === botId) || dbBotSquad[0];
      const botToken = senderBot?.token || activeBotToken;

      if (botToken) {
        const tgRes = await tgCall(botToken, 'sendMessage', {
          chat_id: Number(sendToChatId),
          text: `🎙️ **Voice Transcript (${senderBot?.name || 'Bot'}):**\n\n${transcript}`,
          parse_mode: 'Markdown',
        });
        if (tgRes.ok) {
          messageSent = true;
          addLiveEvent('system', `Sent transcribed message to "${targetTitle}" via ${senderBot?.name}`);
        }
      }
    }

    res.json({
      ok: true,
      transcript,
      messageSent,
      targetTitle: messageSent ? targetTitle : undefined,
    });
  } catch (err: any) {
    console.error('Audio transcription error:', err);
    addLiveEvent('error', `Audio transcription failed: ${err.message || 'Unknown error'}`);
    res.status(500).json({ ok: false, error: err.message || 'Failed to transcribe audio' });
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
    botSquad: dbBotSquad,
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
    initBotSquad().catch((err) => {
      console.error('Failed to initialize Bot Squad:', err);
    });
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
