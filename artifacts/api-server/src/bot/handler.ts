import type { WASocket, WAMessageKey, proto } from "@whiskeysockets/baileys";
import type { GroupSettings } from "./store";
import { getGroupSettings, getUserSettings, getBotSettings, updateBotSettings, resolveLid } from "./store";
import { logger } from "../lib/logger";
import { safeSend } from "./utils";

export { safeSend };
import {
  handlePing,
  handleAlive,
  handleMenu,
  handleOwner,
  handleSettings,
  handleSticker,
  handleRestart,
  handleRefreshSession,
} from "./commands/general";
import {
  handleKick,
  handleAdd,
  handlePromote,
  handleDemote,
  handleAntilink,
  handleAntibadword,
  handleAntimention,
  handleBan,
  handleUnban,
  handleSetPrefix,
  handleTagAll,
  handleGroupInfo,
  handleMute,
  handleUnmute,
  handleWelcome,
  handleSetWelcome,
  handleAutoReply,
  handleSetBadWords,
  handleAntiDelete,
} from "./commands/group";

const DEFAULT_BAD_WORDS = ["fuck", "shit", "bitch", "asshole", "nigga", "faggot", "cunt"];
const URL_REGEX = /https?:\/\/[^\s]+|wa\.me\/[^\s]+|t\.me\/[^\s]+/i;

// ── Group metadata cache ───────────────────────────────────────────────────────
interface GroupMetaEntry {
  subject: string;
  participants: Array<{ id: string; admin?: "admin" | "superadmin" | null }>;
  expireAt: number;
}
const groupMetaCache = new Map<string, GroupMetaEntry>();
const GROUP_META_TTL     = 2 * 60 * 1000;
const GROUP_META_TIMEOUT = 5_000;

async function getCachedGroupMeta(sock: WASocket, jid: string): Promise<GroupMetaEntry> {
  const cached = groupMetaCache.get(jid);
  if (cached && cached.expireAt > Date.now()) return cached;
  const meta = await Promise.race([
    sock.groupMetadata(jid),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`groupMetadata timeout for ${jid}`)), GROUP_META_TIMEOUT)
    ),
  ]);
  const entry: GroupMetaEntry = {
    subject: meta.subject,
    participants: meta.participants as GroupMetaEntry["participants"],
    expireAt: Date.now() + GROUP_META_TTL,
  };
  groupMetaCache.set(jid, entry);
  return entry;
}

export function invalidateGroupMetaCache(jid: string) {
  groupMetaCache.delete(jid);
}

export function populateGroupMetaCache(
  groups: Record<string, { subject: string; participants: Array<{ id: string; admin?: "admin" | "superadmin" | null }> }>
) {
  const expireAt = Date.now() + GROUP_META_TTL;
  for (const [jid, meta] of Object.entries(groups)) {
    groupMetaCache.set(jid, { subject: meta.subject, participants: meta.participants, expireAt });
  }
  return Object.keys(groups).length;
}

export function upsertGroupMetaCache(
  jid: string,
  meta: { subject?: string; participants?: Array<{ id: string; admin?: "admin" | "superadmin" | null }> }
) {
  const existing = groupMetaCache.get(jid);
  const updated: GroupMetaEntry = {
    subject: meta.subject ?? existing?.subject ?? "",
    participants: meta.participants ?? existing?.participants ?? [],
    expireAt: Date.now() + GROUP_META_TTL,
  };
  groupMetaCache.set(jid, updated);
}

function printMessageActivity(opts: {
  msgType: string; pushName: string; senderNumber: string;
  isGroup: boolean; groupName?: string; groupNumber?: string;
}) {
  const botName = (process.env["BOT_NAME"] || "NUTTER-XMD").toUpperCase().split("").join(" ");
  console.log(`\t ✦ ✦ ✦ { ${botName} } ✦ ✦ ✦`);
  console.log("╔════════════════════════════╗");
  console.log("║ ✉   N E W   M E S S A G E   ✉ ║");
  console.log("╚════════════════════════════╝");
  if (opts.isGroup && opts.groupName) {
    console.log(`👥 Group: ${opts.groupName}`);
    console.log(`   ↳ Group ID: (${opts.groupNumber || ""})`);
  } else {
    console.log("💬 Direct Message");
  }
  console.log(`👤 Sender: [${opts.pushName || opts.senderNumber}]`);
  console.log(`🆔 JID: ${opts.senderNumber}`);
  console.log(`📋 Message Type: ${opts.msgType}`);
  console.log("");
}

export interface CommandContext {
  jid: string;
  isGroup: boolean;
  isOwner: boolean;
  isSenderGroupAdmin: boolean;
  isBotGroupAdmin: boolean;
  groupSettings: GroupSettings | null;
  prefix: string;
}

// ── Status broadcast handler ───────────────────────────────────────────────────
// Only processes statuses posted AFTER the bot connected (connectedAt guard is
// applied in connection.ts via the stale-message filter). This function only
// handles statuses that arrive as live notify events, never replayed history.
export async function handleStatusMessage(sock: WASocket, msg: proto.IWebMessageInfo) {
  const settings   = getBotSettings();
  const senderJid  = msg.key.participant || "";

  // Skip if no sender, or if sender IS status@broadcast (reaction notifications,
  // senderKeyDistribution etc — not actual status posts we should react to)
  if (!senderJid || senderJid === "status@broadcast") return;

  const botJid = (sock.user?.id || "").split(":")[0].split("@")[0] + "@s.whatsapp.net";

  // Auto-view: send read receipt so status shows as "seen"
  if (settings.autoViewStatus) {
    try {
      await sock.readMessages([msg.key]);
      logger.info({ sender: senderJid }, "👁 Status viewed");
    } catch { /* non-fatal */ }
  }

  // Auto-like: react with emoji — must use statusJidList targeting the sender
  if (settings.autoLikeStatus) {
    try {
      // Ensure read first (WhatsApp requires view before react)
      if (!settings.autoViewStatus) {
        try { await sock.readMessages([msg.key]); } catch {}
      }
      const emojiList = (settings.statusLikeEmoji || "❤️")
        .split(",").map((e) => e.trim()).filter(Boolean);
      const emoji = emojiList[Math.floor(Math.random() * emojiList.length)] || "❤️";

      await sock.sendMessage(
        "status@broadcast",
        { react: { text: emoji, key: { ...msg.key, remoteJid: "status@broadcast" } } },
        { statusJidList: [senderJid, botJid] }
      );
      logger.info({ sender: senderJid, emoji }, "👍 Status reaction sent");
    } catch (err) {
      logger.warn({ err }, "Status reaction failed (non-fatal)");
    }
  }
}

// ── Version marker — visible in logs on every message, confirms deployment ────
// Change this string any time you deploy so you can verify the new build is live.
const HANDLER_VERSION = "v2.4-REPLY-FIX";

// ── Main message handler ───────────────────────────────────────────────────────
export async function handleMessage(sock: WASocket, msg: proto.IWebMessageInfo) {
  if (!msg.key) {
    logger.warn("handleMessage called with no msg.key — dropped");
    return;
  }

  const ownerNumber   = (process.env["OWNER_NUMBER"] || "").replace(/[^0-9]/g, "");
  const defaultPrefix = process.env["PREFIX"] || ".";

  const jid = msg.key.remoteJid;
  if (!jid) {
    logger.warn("handleMessage: no remoteJid — dropped");
    return;
  }

  // Log version on first call so you can confirm the right build is deployed
  logger.info({ v: HANDLER_VERSION, jid }, "🔖 handler version");

  // Drop protocol/Signal housekeeping messages
  const msgContent = msg.message;
  if (
    msgContent?.protocolMessage ||
    msgContent?.reactionMessage ||
    msgContent?.pollUpdateMessage ||
    msgContent?.keepInChatMessage ||
    msgContent?.senderKeyDistributionMessage
  ) {
    logger.info({ jid, type: msgContent ? Object.keys(msgContent)[0] : "unknown" }, "↩ Protocol message dropped in handler");
    return;
  }

  logger.info({ jid, fromMe: msg.key.fromMe, msgKeys: Object.keys(msg.message || {}) }, "📩 handleMessage reached");

  const isGroup    = jid.endsWith("@g.us");
  const botJidFull = sock.user?.id || "";

  // ── isOwner detection ─────────────────────────────────────────────────────
  let isOwner = false;
  let senderJidRaw: string;
  let realSenderJid: string;
  let senderNumber: string;

  if (!isGroup && msg.key.fromMe) {
    // Case 1: fromMe DM = owner
    isOwner       = true;
    senderJidRaw  = `${ownerNumber}@s.whatsapp.net`;
    realSenderJid = senderJidRaw;
    senderNumber  = ownerNumber;
    logger.info({ jid }, "👑 Owner identified via fromMe=true");
  } else {
    senderJidRaw  = isGroup ? (msg.key.participant || botJidFull) : jid;
    realSenderJid = resolveLid(senderJidRaw);
    senderNumber  = realSenderJid.split(":")[0].split("@")[0];

    const numberMatch = ownerNumber !== "" && senderNumber === ownerNumber;
    isOwner = numberMatch;
    logger.info(
      { ownerNumber, senderNumber, senderJidRaw, realSenderJid, numberMatch, isOwner },
      "🔑 Owner resolution"
    );
  }

  const msgType = Object.keys(msg.message || {})[0] || "unknown";
  const botMode = (process.env["BOT_MODE"] || "public").toLowerCase();
  if (botMode === "private" && !isOwner) {
    logger.info({ jid, msgType }, "Skipped — private mode");
    return;
  }

  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    msg.message?.documentMessage?.caption ||
    msg.message?.buttonsResponseMessage?.selectedButtonId ||
    msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    msg.message?.templateButtonReplyMessage?.selectedId ||
    "";

  if (!body) {
    printMessageActivity({ msgType, pushName: msg.pushName || "", senderNumber, isGroup });
    logger.info({ jid, msgType }, "No text body — skipped");
    return;
  }

  let groupSettings: GroupSettings | null = null;
  let isSenderGroupAdmin = false;
  let isBotGroupAdmin    = false;
  let prefix   = defaultPrefix;
  let groupName: string | undefined;
  let groupNumber: string | undefined;

  if (isGroup) {
    try {
      groupSettings = getGroupSettings(jid);
      if (groupSettings?.customPrefix) prefix = groupSettings.customPrefix;

      const groupMeta = await getCachedGroupMeta(sock, jid);
      groupName   = groupMeta.subject;
      groupNumber = jid.split("@")[0];
      const botNumber = botJidFull.split(":")[0].split("@")[0];

      for (const participant of groupMeta.participants) {
        const pNum    = participant.id.split(":")[0].split("@")[0];
        const isAdmin = participant.admin === "admin" || participant.admin === "superadmin";
        if (pNum === senderNumber) isSenderGroupAdmin = isAdmin;
        if (pNum === botNumber)    isBotGroupAdmin    = isAdmin;
      }

      const msgKey = msg.key as WAMessageKey;
      if (groupSettings) {
        if (groupSettings.antilink && !isOwner && !isSenderGroupAdmin && URL_REGEX.test(body)) {
          await safeSend(sock, jid, { delete: msgKey });
          await safeSend(sock, jid, { text: "Links are not allowed in this group." });
          return;
        }
        const badWordList = groupSettings.customBadWords
          ? groupSettings.customBadWords.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean)
          : DEFAULT_BAD_WORDS;
        if (groupSettings.antibadword !== "off" && !isOwner && badWordList.some((w) => body.toLowerCase().includes(w))) {
          await safeSend(sock, jid, { delete: msgKey });
          if (groupSettings.antibadword === "kick") {
            await sock.groupParticipantsUpdate(jid, [realSenderJid], "remove");
            await safeSend(sock, jid, { text: `@${realSenderJid.split("@")[0]} was kicked for bad language.`, mentions: [realSenderJid] });
          } else {
            await safeSend(sock, jid, { text: "Bad language is not allowed." });
          }
          return;
        }
        if (groupSettings.antimention && !isOwner && !isSenderGroupAdmin) {
          const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (mentions.length >= 5) {
            await safeSend(sock, jid, { delete: msgKey });
            await safeSend(sock, jid, { text: "Mass mentions are not allowed." });
            return;
          }
        }
      }
    } catch (err) {
      logger.warn({ err, jid }, "Failed to fetch group metadata — continuing");
    }
  }

  printMessageActivity({ msgType, pushName: msg.pushName || "", senderNumber, isGroup, groupName, groupNumber });
  logger.info({ jid, prefix, hasPrefix: body.startsWith(prefix), bodyPreview: body.slice(0, 40) }, "📝 Body extracted");

  if (!body.startsWith(prefix)) {
    if (isGroup && groupSettings?.autoReply) {
      try {
        const autoReplyMap: Record<string, string> = JSON.parse(groupSettings.autoReply);
        const bodyLower = body.toLowerCase().trim();
        const matched = Object.entries(autoReplyMap).find(([trigger]) => bodyLower.includes(trigger.toLowerCase()));
        if (matched) await safeSend(sock, jid, { text: matched[1] });
      } catch { /* skip */ }
    }
    return;
  }

  // ── FIXED: Resolve reply JID ─────────────────────────────────────────────────
  // ALWAYS reply to the chat where the message came from (jid)
  // This ensures commands in DMs reply in the same DM, and group commands reply in the group
  const replyJid = jid;  // ← THE FIX: use the original chat ID directly
  
  // Log the fix for debugging
  logger.info({ 
    originalJid: jid, 
    replyJid, 
    isGroup, 
    fromMe: msg.key.fromMe,
    isOwner 
  }, "🔍 Reply target (FIXED: always using original jid)");

  const userSettings = getUserSettings(realSenderJid);
  if (userSettings?.isBanned && !isOwner) {
    await safeSend(sock, replyJid, { text: "You are banned from using this bot." });
    return;
  }

  const ctx: CommandContext = { jid: replyJid, isGroup, isOwner, isSenderGroupAdmin, isBotGroupAdmin, groupSettings, prefix };
  const commandText = body.slice(prefix.length).trim();
  const parts = commandText.split(/\s+/).filter(Boolean);
  const [command = "", ...args] = parts;
  const cmd = command.toLowerCase();

  // No need to patch msg key since we're using the original jid
  // But keep patchedMsg for compatibility with handlers that might expect it
  let patchedMsg = msg;
  // Only patch if replyJid is different (shouldn't happen now, but kept for safety)
  if (msg.key.remoteJid !== replyJid) {
    patchedMsg = { ...msg, key: { ...msg.key, remoteJid: replyJid } };
  }

  logger.info({ cmd, jid: replyJid, isOwner, isGroup }, "📌 Command execution");

  switch (cmd) {
    case "ping":           return handlePing(sock, patchedMsg, ctx);
    case "alive":          return handleAlive(sock, patchedMsg, ctx);
    case "menu":           return handleMenu(sock, patchedMsg, ctx, prefix);
    case "owner":          return handleOwner(sock, patchedMsg, ctx);
    case "settings":       return handleSettings(sock, patchedMsg, ctx, prefix);
    case "sticker":        return handleSticker(sock, patchedMsg, ctx);
    case "restart":        return handleRestart(sock, patchedMsg, ctx);
    case "refreshsession":
    case "getsession":     return handleRefreshSession(sock, patchedMsg, ctx);

    case "autoviewstatus":
    case "autoview": {
      if (!isOwner) { await safeSend(sock, replyJid, { text: "🚫 Only owner command" }); return; }
      const val = args[0]?.toLowerCase();
      if (val !== "true" && val !== "false" && val !== "on" && val !== "off") {
        await safeSend(sock, replyJid, { text: `Current: ${getBotSettings().autoViewStatus ? "ON" : "OFF"}\nUsage: ${prefix}autoviewstatus on/off` });
        return;
      }
      const enabled = val === "true" || val === "on";
      updateBotSettings({ autoViewStatus: enabled });
      await safeSend(sock, replyJid, { text: `Auto-view status: *${enabled ? "ON" : "OFF"}*` });
      return;
    }

    case "autolikestatus":
    case "autolike": {
      if (!isOwner) { await safeSend(sock, replyJid, { text: "🚫 Only owner command" }); return; }
      const val = args[0]?.toLowerCase();
      if (val !== "true" && val !== "false" && val !== "on" && val !== "off") {
        await safeSend(sock, replyJid, { text: `Current: ${getBotSettings().autoLikeStatus ? "ON" : "OFF"}\nUsage: ${prefix}autolikestatus on/off` });
        return;
      }
      const enabled = val === "true" || val === "on";
      updateBotSettings({ autoLikeStatus: enabled });
      await safeSend(sock, replyJid, { text: `Auto-like status: *${enabled ? "ON" : "OFF"}*` });
      return;
    }

    case "statusemoji": {
      if (!isOwner) { await safeSend(sock, replyJid, { text: "🚫 Only owner command" }); return; }
      const emoji = args.join(" ").trim();
      if (!emoji) {
        await safeSend(sock, replyJid, { text: `Current emoji: ${getBotSettings().statusLikeEmoji}\nUsage: ${prefix}statusemoji ❤️,🔥,😍` });
        return;
      }
      updateBotSettings({ statusLikeEmoji: emoji });
      await safeSend(sock, replyJid, { text: `Status like emoji set to: *${emoji}*` });
      return;
    }

    case "kick":          return handleKick(sock, patchedMsg, ctx);
    case "add":           return handleAdd(sock, patchedMsg, ctx, args);
    case "promote":       return handlePromote(sock, patchedMsg, ctx);
    case "demote":        return handleDemote(sock, patchedMsg, ctx);
    case "antilink":      return handleAntilink(sock, patchedMsg, ctx, args);
    case "antibadword":   return handleAntibadword(sock, patchedMsg, ctx, args);
    case "setbadwords":   return handleSetBadWords(sock, patchedMsg, ctx, args);
    case "antimention":   return handleAntimention(sock, patchedMsg, ctx, args);
    case "antidelete":    return handleAntiDelete(sock, patchedMsg, ctx, args);
    case "ban":           return handleBan(sock, patchedMsg, ctx);
    case "unban":         return handleUnban(sock, patchedMsg, ctx);
    case "setprefix":     return handleSetPrefix(sock, patchedMsg, ctx, args);
    case "tagall":        return handleTagAll(sock, patchedMsg, ctx, args);
    case "groupinfo":     return handleGroupInfo(sock, patchedMsg, ctx);
    case "mute":          return handleMute(sock, patchedMsg, ctx);
    case "unmute":        return handleUnmute(sock, patchedMsg, ctx);
    case "welcome":       return handleWelcome(sock, patchedMsg, ctx, args);
    case "setwelcome":    return handleSetWelcome(sock, patchedMsg, ctx, args);
    case "autoreply":     return handleAutoReply(sock, patchedMsg, ctx, args);

    default:
      return;
  }
}

export async function handleGroupParticipantsUpdate(
  sock: WASocket,
  update: { id: string; participants: Array<{ id: string } | string>; action: string }
) {
  if (update.action !== "add") return;
  const groupId = update.id;
  try {
    const settings = getGroupSettings(groupId);
    if (!settings?.welcomeEnabled) return;
    const groupMeta = await sock.groupMetadata(groupId);
    const welcomeTemplate = settings.welcomeMessage || "Welcome to *{group}*, {name}! 🎉";
    for (const participant of update.participants) {
      const participantJid = typeof participant === "string" ? participant : participant.id;
      const name = `@${participantJid.split("@")[0]}`;
      const welcomeText = welcomeTemplate
        .replace(/\{name\}/gi, name)
        .replace(/\{group\}/gi, groupMeta.subject);
      await safeSend(sock, groupId, { text: welcomeText, mentions: [participantJid] });
    }
  } catch (err) {
    logger.warn({ err, groupId }, "Failed to send welcome message");
  }
}
