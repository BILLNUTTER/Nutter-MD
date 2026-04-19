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

// ── Stable session directory ──────────────────────────────────────────────────
// FIX: was `nutter-xmd-session-${process.pid}` which on Heroku is always pid=4,
// causing the directory to be deleted and recreated on every restart. This wiped
// all Signal key material that Baileys accumulated at runtime (sender-key
// exchanges, session ratchet advances), leaving only the stale pairing-time
// snapshot from SESSION_ID — causing verifyMAC / Bad MAC decryption failures.
//
// Using a fixed name means the session directory survives restarts within the
// same dyno lifetime. Baileys' useMultiFileAuthState reads from and writes to
// this directory continuously so new keys are always current.
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
    logger.info("No SESSION_ID env var found — bot will not start");
    return null;
  }

  if (!sessionId.startsWith(SESSION_PREFIX)) {
    logger.error(
      { prefix: sessionId.slice(0, 16) },
      `Invalid SESSION_ID: must start with "${SESSION_PREFIX}". Re-pair your device on the pairing page to get a new SESSION_ID.`
    );
    return null;
  }

  const encoded = sessionId.slice(SESSION_PREFIX.length);

  try {
    const raw = Buffer.from(encoded, "base64");

    let jsonStr: string;
    if (raw[0] === 0x1f && raw[1] === 0x8b) {
      const decompressed = await gunzip(raw);
      jsonStr = decompressed.toString("utf-8");
    } else {
      jsonStr = raw.toString("utf-8");
    }

    const fileMap = JSON.parse(jsonStr) as SessionFileMap;

    const { useMultiFileAuthState } = await import("@whiskeysockets/baileys");

    // FIX: use a stable directory name — do NOT wipe it if it already exists.
    // If the directory is present from a previous run within the same dyno
    // lifetime, its files are more up-to-date than the SESSION_ID snapshot
    // (Baileys has been writing new keys into it continuously). Only write
    // files from SESSION_ID that don't already exist on disk so we never
    // overwrite a newer runtime key with a stale pairing-time key.
    const sessionDir = SESSION_DIR;
    const isFirstBoot = !fs.existsSync(sessionDir);

    if (isFirstBoot) {
      fs.mkdirSync(sessionDir, { recursive: true });
      logger.info({ sessionDir }, "📁 Fresh session directory created");
    } else {
      logger.info({ sessionDir }, "📁 Reusing existing session directory (runtime keys preserved)");
    }

    // Write SESSION_ID files — skip any file that already exists on disk
    // (the on-disk version is newer and should not be overwritten).
    let written = 0;
    let skipped = 0;
    for (const [filename, content] of Object.entries(fileMap)) {
      const filePath = path.join(sessionDir, filename);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(content), "utf-8");
        written++;
      } else {
        skipped++;
      }
    }

    const authState = await useMultiFileAuthState(sessionDir);
    activeBotSessionDir = sessionDir;

    const allFiles       = fs.readdirSync(sessionDir);
    const sessionFiles   = allFiles.filter((f) => f.startsWith("session-")).length;
    const senderKeyFiles = allFiles.filter((f) => f.startsWith("sender-key-") && f !== "sender-key-memory.json").length;
    const preKeyFiles    = allFiles.filter((f) => f.startsWith("pre-key-")).length;

    logger.info(
      { sessionDir, totalOnDisk: allFiles.length, written, skipped, sessionFiles, senderKeyFiles, preKeyFiles },
      "📦 Session loaded — runtime keys preserved, SESSION_ID files filled gaps"
    );
    return authState;
  } catch (err) {
    logger.error({ err }, "Failed to parse SESSION_ID — re-pair on the pairing page to get a new one");
    return null;
  }
}

// ── Encoding constants ────────────────────────────────────────────────────────
const MAX_PREKEYS = 50;
const SESSION_RAW_BUDGET    = 150_000;
const SENDER_KEY_RAW_BUDGET = 120_000;

export async function encodeSessionToBase64(fileMap: SessionFileMap): Promise<string> {
  const toEncode: SessionFileMap = {};

  if (fileMap["creds.json"]) {
    toEncode["creds.json"] = fileMap["creds.json"];
  } else {
    logger.warn("creds.json not found in fileMap — SESSION_ID may be invalid");
  }

  // ── Pre-key files ─────────────────────────────────────────────────────────
  const preKeyFiles = Object.keys(fileMap)
    .filter((f) => f.startsWith("pre-key-") && f.endsWith(".json"))
    .sort((a, b) => {
      const idA = parseInt(a.replace("pre-key-", "").replace(".json", ""), 10) || 0;
      const idB = parseInt(b.replace("pre-key-", "").replace(".json", ""), 10) || 0;
      return idA - idB;
    })
    .slice(-MAX_PREKEYS);

  for (const f of preKeyFiles) {
    toEncode[f] = fileMap[f];
  }

  // ── Session files ─────────────────────────────────────────────────────────
  let sessionRawBytes = 0;
  const sessionFiles = Object.keys(fileMap)
    .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
    .sort();

  for (const f of sessionFiles) {
    const size = JSON.stringify(fileMap[f]).length;
    if (sessionRawBytes + size > SESSION_RAW_BUDGET) break;
    toEncode[f] = fileMap[f];
    sessionRawBytes += size;
  }

  const sessionCount = Object.keys(toEncode).filter((f) => f.startsWith("session-")).length;

  // ── Sender-key files ──────────────────────────────────────────────────────
  if (fileMap["sender-key-memory.json"]) {
    toEncode["sender-key-memory.json"] = fileMap["sender-key-memory.json"];
  }

  // FIX: sort by most recently modified first so the newest (most active) sender
  // keys are included when the budget is hit, not the alphabetically first ones.
  // The old alphabetical sort meant the newest group sender keys were silently
  // dropped, causing 2-minute group message delays after redeploy.
  let senderKeyRawBytes = 0;
  const sessionDirForStat = activeBotSessionDir ?? os.tmpdir();
  const senderKeyFiles = Object.keys(fileMap)
    .filter((f) => f.startsWith("sender-key-") && f.endsWith(".json") && f !== "sender-key-memory.json")
    .sort((a, b) => {
      try {
        const mtimeA = fs.statSync(path.join(sessionDirForStat, a)).mtimeMs;
        const mtimeB = fs.statSync(path.join(sessionDirForStat, b)).mtimeMs;
        return mtimeB - mtimeA; // newest first
      } catch {
        return a.localeCompare(b); // fallback to alphabetical if stat fails
      }
    });

  for (const f of senderKeyFiles) {
    const size = JSON.stringify(fileMap[f]).length;
    if (senderKeyRawBytes + size > SENDER_KEY_RAW_BUDGET) break;
    toEncode[f] = fileMap[f];
    senderKeyRawBytes += size;
  }

  const senderKeyCount = Object.keys(toEncode).filter((f) => f.startsWith("sender-key-")).length;

  logger.info(
    {
      totalFiles:   Object.keys(toEncode).length,
      preKeys:      preKeyFiles.length,
      sessions:     sessionCount,
      senderKeys:   senderKeyCount,
      sessionBytes: sessionRawBytes,
      senderBytes:  senderKeyRawBytes,
    },
    "Encoding session (creds + pre-keys + sessions + sender-keys)"
  );

  const json       = Buffer.from(JSON.stringify(toEncode), "utf-8");
  const compressed = await gzip(json);
  const encoded    = SESSION_PREFIX + compressed.toString("base64");

  const charLen = encoded.length;
  if (charLen > 60_000) {
    logger.warn(
      { charLen, herokuLimit: 65536 },
      "SESSION_ID is large — approaching Heroku 64 KB limit. Consider re-pairing."
    );
  } else {
    logger.info({ charLen, herokuLimit: 65536 }, "SESSION_ID size OK");
  }
  return encoded;
}
