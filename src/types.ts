export interface SimGroup {
  id: number;
  tgChatId: number;
  title: string;
  type?: 'group' | 'supergroup' | 'channel' | string;
  memberCount: number;
  isActive: boolean;
  warnLimit: number;
  warnAction: string;
  muteDurationMinutes: number;
  floodLimit: number;
  repeatLimit: number;
  blockLinks: boolean;
  blockedWords: string;
  rulesText: string;
  welcomeEnabled?: boolean;
  welcomeDeleteSeconds?: number;
  photoAutoDeleteEnabled?: boolean;
  photoAutoDeleteSeconds?: number;
  lastKnownMessageId?: number;
}

export interface SimLinkCode {
  code: string;
  groupId: number;
  groupTitle: string;
  generatedBy: string;
  expiresAt: number;
  isUsed: boolean;
}

export interface SimCrossPost {
  id: number;
  name: string;
  groupAId: number;
  groupBId: number;
  direction: 'A_TO_B' | 'B_TO_A' | 'BIDIRECTIONAL';
  mode: 'COPY' | 'FORWARD';
  isActive: boolean;
  adminOnly: boolean;
  lastSyncedMessageId?: number;
  syncTotalCopied?: number;
  syncTotalSkipped?: number;
  syncStatus?: 'idle' | 'running' | 'completed' | 'paused' | 'error';
  syncProgressText?: string;
}

export interface SimWelcomeConfig {
  groupId: number;
  isEnabled: boolean;
  templateText: string;
  mediaUrl: string | null;
  deleteAfterSeconds: number;
  buttons: Array<{ text: string; url: string }>;
}

export interface SimChatMessage {
  id: string;
  chatType: 'private' | 'group_a' | 'group_b';
  sender: string;
  senderRole: 'admin' | 'member' | 'bot';
  senderId: number;
  text: string;
  mediaUrl?: string;
  timestamp: string;
  inlineButtons?: Array<Array<{ text: string; callbackData?: string; url?: string }>>;
  replyToId?: string;
  isForwarded?: boolean;
  forwardOrigin?: string;
  autoDeleteAt?: number;
  isDeleted?: boolean;
}

export interface SimWarnRecord {
  id: number;
  groupId: number;
  userId: number;
  userName: string;
  warnedBy: string;
  reason: string;
  timestamp: string;
}

export interface SimModLog {
  id: number;
  groupId: number;
  userName: string;
  action: string;
  reason: string;
  executedBy: string;
  timestamp: string;
}

export interface VerifiedBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
  can_join_groups: boolean;
  can_read_all_group_messages: boolean;
  supports_inline_queries: boolean;
}

export interface LiveEvent {
  id: string;
  time: string;
  type: 'incoming_message' | 'callback' | 'crosspost' | 'welcome' | 'moderation' | 'system' | 'error';
  chatTitle?: string;
  sender?: string;
  details: string;
}

export interface ManagedBot {
  id: string;
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

export interface BotActivityTemplate {
  id: string;
  botId: string;
  title: string;
  type: 'poll' | 'game' | 'meme' | 'question';
  previewText: string;
}

