import pino from "pino";
import { Boom } from "@hapi/boom";
import { logger } from "../lib/logger";
import { loadSessionFromEnv } from "./session";
import { handleMessage, handleGroupParticipantsUpdate } from "./handler";
import type { WASocket } from "@whiskeysockets/baileys";

// Only count genuine failures toward the limit — not normal handshake restarts
const MAX_RECONNECTS = 2;
const RECONNECT_DELAY_MS = 5000;

const silentLogger = pino({ level: "silent" });

// Track state across reconnects
let failureCount = 0;
let hasSentWelcome = false;

export async function startBot() {
  const sessionAuth = await loadSessionFromEnv();
  if (!sessionAuth) {
    logger.info("No SESSION_ID provided — bot engine not started.");
    return;
  }

  logger.info("Starting NUTTER-XMD bot engine...");
  await connectBot(sessionAuth);
}

async function onFirstConnect(sock: WASocket) {
  if (hasSentWelcome) return;
  hasSentWelcome = true;

  const ownerNumber = (process.env["OWNER_NUMBER"] || "").replace(/\D/g, "");
  const mode = (process.env["BOT_MODE"] || "public").toLowerCase();
  const prefix = process.env["PREFIX"] || ".";

  // Send styled welcome message to owner
  if (ownerNumber) {
    const ownerJid = `${ownerNumber}@s.whatsapp.net`;
    const welcome = [
      `*°═════ NUTTER-XMD ═════°*`,
      ``,
      `   ᴍᴏᴅᴇ   › *${mode}*`,
      `   ᴘʀᴇғɪx  › *[ ${prefix} ]*`,
      ``,
      `*°═≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈═°*`,
    ].join("\n");

    try {
      await sock.sendMessage(ownerJid, { text: welcome });
      logger.info("✅ Sent welcome message to owner");
    } catch (err) {
      logger.warn({ err }, "Could not send welcome message to owner");
    }
  } else {
    logger.warn("OWNER_NUMBER not set — skipping welcome message");
  }

  // Auto-join support group
  try {
    await sock.groupAcceptInvite("JsKmQMpECJMHyxucHquF15");
    logger.info("✅ Auto-joined NUTTER-XMD support group");
  } catch {
    logger.info("Support group: already joined or invite expired");
  }

  // Auto-follow official channel
  try {
    const channelJid = "0029VbCcIrFEAKWNxpi8qR2V@newsletter";
    const s = sock as unknown as Record<string, unknown>;
    if (typeof s["followNewsletter"] === "function") {
      await (s["followNewsletter"] as (j: string) => Promise<void>)(channelJid);
      logger.info("✅ Auto-followed NUTTER-XMD channel");
    } else if (typeof s["newsletterFollow"] === "function") {
      await (s["newsletterFollow"] as (j: string) => Promise<void>)(channelJid);
      logger.info("✅ Auto-followed NUTTER-XMD channel");
    } else {
      logger.info("Channel follow not available in this Baileys build — skipping");
    }
  } catch {
    logger.info("Channel: already following or not available");
  }
}

async function connectBot(sessionAuth: {
  state: { creds: unknown; keys: unknown };
  saveCreds: () => Promise<void>;
}) {
  const {
    default: makeWASocket,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion,
  } = await import("@whiskeysockets/baileys");

  const { default: NodeCache } = await import("node-cache");
  const msgRetryCounterCache = new NodeCache();

  // Fetch latest WA Web version to avoid 405 rejection
  let waVersion: [number, number, number] | undefined;
  try {
    const { version } = await fetchLatestBaileysVersion();
    waVersion = version;
    logger.info({ version }, "Using WhatsApp Web version");
  } catch {
    logger.warn("Could not fetch latest WA version — using Baileys default");
  }

  const sock = makeWASocket({
    version: waVersion,
    auth: sessionAuth.state as Parameters<typeof makeWASocket>[0]["auth"],
    printQRInTerminal: false,
    browser: Browsers.ubuntu("Chrome"),
    msgRetryCounterCache,
    logger: silentLogger,
  });

  sock.ev.on("creds.update", sessionAuth.saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      failureCount = 0;
      logger.info("✅ NUTTER-XMD connected to WhatsApp");
      void onFirstConnect(sock);
      return;
    }

    if (connection === "close") {
      const boom = lastDisconnect?.error as Boom | undefined;
      const reason = boom?.output?.statusCode;
      const message = boom?.message ?? "unknown";

      logger.warn({ reason, message }, `Connection closed — reason ${reason} (${message})`);

      // 515 = restart required: normal handshake step, reconnect immediately, don't count as failure
      if (reason === DisconnectReason.restartRequired) {
        logger.info("Restart required by server — reconnecting immediately");
        void connectBot(sessionAuth);
        return;
      }

      // 401 = logged out: session is permanently dead
      if (reason === DisconnectReason.loggedOut) {
        logger.error("❌ Bot logged out. Generate a new SESSION_ID from the pairing page.");
        return;
      }

      // 403 = account banned or session rejected by WhatsApp
      if (reason === 403) {
        logger.error("❌ Session rejected (403). Generate a new SESSION_ID from the pairing page.");
        return;
      }

      // All other failures count toward the 2-attempt limit
      failureCount++;

      if (failureCount > MAX_RECONNECTS) {
        logger.error(
          { reason, failureCount },
          `❌ Failed ${MAX_RECONNECTS} times (reason ${reason}). Bot stopped. Check your SESSION_ID or redeploy.`
        );
        process.exit(1);
      }

      logger.warn(`🔄 Reconnecting after failure... (${failureCount}/${MAX_RECONNECTS})`);
      setTimeout(() => void connectBot(sessionAuth), RECONNECT_DELAY_MS);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      try {
        await handleMessage(sock, msg);
      } catch (err) {
        logger.error({ err }, "Error handling message");
      }
    }
  });

  sock.ev.on("group-participants.update", async (update) => {
    try {
      await handleGroupParticipantsUpdate(sock, update);
    } catch (err) {
      logger.error({ err }, "Error handling group update");
    }
  });

  return sock;
}
