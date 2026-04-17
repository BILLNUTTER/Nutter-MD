import type { proto } from "@whiskeysockets/baileys";

export interface GroupSettings {
  groupId: string;
  antilink: boolean;
  antibadword: "off" | "delete" | "kick";
  customBadWords: string | null;
  antimention: boolean;
  antiDelete: boolean;
  mute: boolean;
  customPrefix: string | null;
  welcomeEnabled: boolean;
  welcomeMessage: string | null;
  autoReply: string | null;
}

export interface UserSettings {
  userId: string;
  isBanned: boolean;
}

export interface BotSettings {
  autoViewStatus: boolean;
  autoLikeStatus: boolean;
  statusLikeEmoji: string;
  autoRejectCall: boolean;
}

// ── Group store ────────────────────────────────────────────────────────────────
const groupStore = new Map<string, GroupSettings>();

export function getGroupSettings(groupId: string): GroupSettings | null {
  return groupStore.get(groupId) ?? null;
}

export function ensureGroupSettings(groupId: string): GroupSettings {
  if (!groupStore.has(groupId)) {
    groupStore.set(groupId, {
      groupId,
      // Default true unless explicitly set to "false"
      antilink:    process.env["ANTI_LINK"]     !== "false",
      antibadword: (process.env["ANTI_BAD_WORD"] !== "false" ? "delete" : "off") as "off" | "delete" | "kick",
      customBadWords: null,
      antimention: process.env["ANTI_MENTION"]  !== "false",
      antiDelete:  process.env["ANTI_DELETE"]   !== "false",
      mute: false,
      customPrefix: null,
      welcomeEnabled: false,
      welcomeMessage: null,
      autoReply: null,
    });
  }
  return groupStore.get(groupId)!;
}

export function updateGroupSettings(groupId: string, update: Partial<Omit<GroupSettings, "groupId">>): void {
  const existing = ensureGroupSettings(groupId);
  groupStore.set(groupId, { ...existing, ...update });
}

// ── User store ─────────────────────────────────────────────────────────────────
const userStore = new Map<string, UserSettings>();

export function getUserSettings(userId: string): UserSettings | null {
  return userStore.get(userId) ?? null;
}

export function setUserBanned(userId: string, isBanned: boolean): void {
  userStore.set(userId, { userId, isBanned });
}

// ── Bot-level settings — default TRUE unless env is explicitly "false" ─────────
const botSettings: BotSettings = {
  autoViewStatus: process.env["AUTO_VIEW_STATUS"] !== "false",
  autoLikeStatus: process.env["AUTO_LIKE_STATUS"] !== "false",
  statusLikeEmoji: process.env["STATUS_LIKE_EMOJI"] || "❤️",
  autoRejectCall:  process.env["AUTO_REJECT_CALL"] !== "false",
};

export function getBotSettings(): BotSettings {
  return { ...botSettings };
}

export function updateBotSettings(update: Partial<BotSettings>): void {
  Object.assign(botSettings, update);
}

// ── Volatile in-memory message cache (for antidelete) ─────────────────────────
// Messages expire automatically after 5 minutes. No database, no file storage.
const MSG_TTL = 5 * 60 * 1000;   // 5 minutes
const MSG_MAX = 2000;              // cap to prevent unbounded growth

interface CacheEntry { msg: proto.IWebMessageInfo; expireAt: number }
const msgCache = new Map<string, CacheEntry>();

export function cacheMessage(msg: proto.IWebMessageInfo): void {
  const id = msg.key.id;
  if (!id || msg.key.fromMe) return;   // don't cache own outgoing messages
  if (msgCache.size >= MSG_MAX) {
    const now = Date.now();
    for (const [k, v] of msgCache) {
      if (v.expireAt < now) msgCache.delete(k);
    }
  }
  msgCache.set(id, { msg, expireAt: Date.now() + MSG_TTL });
}

export function popCachedMessage(id: string): proto.IWebMessageInfo | null {
  const entry = msgCache.get(id);
  if (!entry) return null;
  msgCache.delete(id);
  return entry.expireAt >= Date.now() ? entry.msg : null;
}
