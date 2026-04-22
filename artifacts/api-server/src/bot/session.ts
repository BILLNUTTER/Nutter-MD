import { logger } from "../lib/logger";
import fs from "fs";
import path from "path";
import os from "os";
import zlib from "zlib";
import { promisify } from "util";

const gzip   = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export const SESSION_PREFIX = "NUTTERX-MD::;";
export type SessionFileMap = Record<string, unknown>;

const SESSION_DIR = path.join(os.tmpdir(), "nutter-xmd-session");
let activeBotSessionDir: string | null = null;

export function getActiveBotSessionDir(): string | null {
  return activeBotSessionDir;
}

export async function loadSessionFromEnv(): Promise<{
  state: { creds: unknown; keys: unknown };
  saveCreds: () => Promise<void>;
} | null> {
  const sessionId = process.env["SESSION_ID"];

  if (!sessionId) {
    logger.error("❌ SESSION_ID not set.");
    return null;
  }

  logger.info({ length: sessionId.length, prefix: sessionId.slice(0, 20) }, "🔑 SESSION_ID found");

  if (!sessionId.startsWith(SESSION_PREFIX)) {
    logger.error({ expected: SESSION_PREFIX, got: sessionId.slice(0, 20) }, "❌ Invalid SESSION_ID prefix — re-pair on the pairing page.");
    return null;
  }

  const encoded = sessionId.slice(SESSION_PREFIX.length);

  let fileMap: SessionFileMap;
  try {
    const raw = Buffer.from(encoded, "base64");
    let jsonStr: string;
    if (raw[0] === 0x1f && raw[1] === 0x8b) {
      jsonStr = (await gunzip(raw)).toString("utf-8");
    } else {
      jsonStr = raw.toString("utf-8");
    }
    fileMap = JSON.parse(jsonStr) as SessionFileMap;
  } catch (err) {
    logger.error({ err }, "❌ SESSION_ID corrupted — re-pair to get a new one.");
    return null;
  }

  const fileKeys = Object.keys(fileMap);
  const hasCreds = fileKeys.includes("creds.json");
  logger.info(
    {
      totalFiles: fileKeys.length,
      hasCreds,
      preKeys: fileKeys.filter(f => f.startsWith("pre-key-")).length,
      sessions: fileKeys.filter(f => f.startsWith("session-")).length,
      senderKeys: fileKeys.filter(f => f.startsWith("sender-key-")).length,
    },
    "📋 SESSION_ID inventory"
  );

  if (!hasCreds) {
    logger.error("❌ creds.json missing — re-pair to get a valid SESSION_ID.");
    return null;
  }

  const sessionDir  = SESSION_DIR;
  const isFirstBoot = !fs.existsSync(sessionDir);

  if (isFirstBoot) {
    fs.mkdirSync(sessionDir, { recursive: true });
    logger.info({ sessionDir }, "📁 Fresh session directory created");
  } else {
    logger.info({ sessionDir, existingFiles: fs.readdirSync(sessionDir).length }, "📁 Reusing existing session directory");
  }

  let written = 0, skipped = 0;
  for (const [filename, content] of Object.entries(fileMap)) {
    const filePath = path.join(sessionDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(content), "utf-8");
      written++;
    } else {
      skipped++;
    }
  }
  logger.info({ written, skipped }, "📝 Session files written");

  let authState: Awaited<ReturnType<import("@whiskeysockets/baileys")["useMultiFileAuthState"]>>;
  try {
    const { useMultiFileAuthState } = await import("@whiskeysockets/baileys");
    authState = await useMultiFileAuthState(sessionDir);
  } catch (authErr) {
    logger.error({ authErr }, "❌ useMultiFileAuthState failed — re-pair to fix.");
    return null;
  }

  activeBotSessionDir = sessionDir;
  const allFiles = fs.readdirSync(sessionDir);
  logger.info(
    {
      sessionDir,
      totalOnDisk: allFiles.length,
      hasCreds: allFiles.includes("creds.json"),
      preKeys: allFiles.filter(f => f.startsWith("pre-key-")).length,
      sessions: allFiles.filter(f => f.startsWith("session-")).length,
      senderKeys: allFiles.filter(f => f.startsWith("sender-key-") && f !== "sender-key-memory.json").length,
    },
    "✅ Session loaded — Baileys auth state ready"
  );

  // ── Auto-export enriched SESSION_ID after 3 minutes ──────────────────────
  // At pairing time the SESSION_ID has almost no session/sender-key files.
  // After 3 minutes of running, Baileys has negotiated Signal sessions with
  // all your contacts and groups. We auto-export the enriched SESSION_ID and
  // log it so you can copy it as your permanent SESSION_ID — no more delays
  // on cold starts for existing contacts.
  setTimeout(async () => {
    try {
      const currentFiles = fs.readdirSync(sessionDir);
      const sessionCount   = currentFiles.filter(f => f.startsWith("session-")).length;
      const senderKeyCount = currentFiles.filter(f => f.startsWith("sender-key-") && f !== "sender-key-memory.json").length;

      // Only export if we have meaningfully more sessions than we started with
      const startingSessions = fileKeys.filter(f => f.startsWith("session-")).length;
      if (sessionCount <= startingSessions && senderKeyCount === 0) {
        logger.info({ sessionCount, senderKeyCount }, "⏭ Auto-export skipped — no new sessions accumulated yet");
        return;
      }

      const updatedFileMap: SessionFileMap = {};
      for (const file of currentFiles) {
        try {
          updatedFileMap[file] = JSON.parse(fs.readFileSync(path.join(sessionDir, file), "utf-8"));
        } catch { /* skip unreadable */ }
      }

      const newSessionId = await encodeSessionToBase64(updatedFileMap);
      logger.info(
        {
          sessionCount,
          senderKeyCount,
          sessionIdLength: newSessionId.length,
        },
        "🔄 Auto-exported enriched SESSION_ID — copy this to your Heroku SESSION_ID config var for instant future starts"
      );
      // Log the full SESSION_ID so it can be copied from Heroku logs
      logger.info({ SESSION_ID: newSessionId }, "📋 ENRICHED SESSION_ID (copy this value)");
    } catch (err) {
      logger.warn({ err }, "Auto SESSION_ID export failed — use .refreshsession instead");
    }
  }, 3 * 60 * 1000); // 3 minutes after startup

  return authState;
}

const MAX_PREKEYS           = 50;
const SESSION_RAW_BUDGET    = 150_000;
const SENDER_KEY_RAW_BUDGET = 120_000;

export async function encodeSessionToBase64(fileMap: SessionFileMap): Promise<string> {
  const toEncode: SessionFileMap = {};

  if (fileMap["creds.json"]) toEncode["creds.json"] = fileMap["creds.json"];
  else logger.warn("creds.json not found");

  // Pre-key files — newest MAX_PREKEYS
  const preKeyFiles = Object.keys(fileMap)
    .filter(f => f.startsWith("pre-key-") && f.endsWith(".json"))
    .sort((a, b) => {
      const idA = parseInt(a.replace("pre-key-", "").replace(".json", ""), 10) || 0;
      const idB = parseInt(b.replace("pre-key-", "").replace(".json", ""), 10) || 0;
      return idA - idB;
    })
    .slice(-MAX_PREKEYS);
  for (const f of preKeyFiles) toEncode[f] = fileMap[f];

  // Session files — up to budget
  let sessionRawBytes = 0;
  for (const f of Object.keys(fileMap).filter(f => f.startsWith("session-") && f.endsWith(".json")).sort()) {
    const size = JSON.stringify(fileMap[f]).length;
    if (sessionRawBytes + size > SESSION_RAW_BUDGET) break;
    toEncode[f] = fileMap[f];
    sessionRawBytes += size;
  }

  // Sender-key files — newest first
  if (fileMap["sender-key-memory.json"]) toEncode["sender-key-memory.json"] = fileMap["sender-key-memory.json"];

  const sessionDirForStat = activeBotSessionDir ?? os.tmpdir();
  let senderKeyRawBytes = 0;
  const senderKeyFiles = Object.keys(fileMap)
    .filter(f => f.startsWith("sender-key-") && f.endsWith(".json") && f !== "sender-key-memory.json")
    .sort((a, b) => {
      try {
        return fs.statSync(path.join(sessionDirForStat, b)).mtimeMs - fs.statSync(path.join(sessionDirForStat, a)).mtimeMs;
      } catch { return a.localeCompare(b); }
    });
  for (const f of senderKeyFiles) {
    const size = JSON.stringify(fileMap[f]).length;
    if (senderKeyRawBytes + size > SENDER_KEY_RAW_BUDGET) break;
    toEncode[f] = fileMap[f];
    senderKeyRawBytes += size;
  }

  const sessionCount   = Object.keys(toEncode).filter(f => f.startsWith("session-")).length;
  const senderKeyCount = Object.keys(toEncode).filter(f => f.startsWith("sender-key-")).length;

  logger.info(
    {
      totalFiles: Object.keys(toEncode).length,
      preKeys: preKeyFiles.length,
      sessions: sessionCount,
      senderKeys: senderKeyCount,
      sessionBytes: sessionRawBytes,
      senderBytes: senderKeyRawBytes,
    },
    "Encoding session"
  );

  const compressed = await gzip(Buffer.from(JSON.stringify(toEncode), "utf-8"));
  const encoded = SESSION_PREFIX + compressed.toString("base64");

  const charLen = encoded.length;
  if (charLen > 60_000) logger.warn({ charLen }, "⚠️ SESSION_ID approaching Heroku 64 KB limit");
  else logger.info({ charLen }, "✅ SESSION_ID size OK");

  return encoded;
}
