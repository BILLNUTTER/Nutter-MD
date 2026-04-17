import { logger } from "../lib/logger";
import fs from "fs";
import path from "path";
import os from "os";
import zlib from "zlib";
import { promisify } from "util";

const gzip   = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Prefix that identifies a valid NUTTER-XMD session string.
// Bumped to NUTTERX-MD::; so users know to regenerate after the full-state fix.
export const SESSION_PREFIX = "NUTTERX-MD::;";

export type SessionFileMap = Record<string, unknown>;

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

    const sessionDir = path.join(os.tmpdir(), `nutter-xmd-session-${process.pid}`);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sessionDir, { recursive: true });

    const fileCount = Object.keys(fileMap).length;
    for (const [filename, content] of Object.entries(fileMap)) {
      fs.writeFileSync(path.join(sessionDir, filename), JSON.stringify(content), "utf-8");
    }

    const authState = await useMultiFileAuthState(sessionDir);
    logger.info({ sessionDir, fileCount }, "Session loaded from SESSION_ID env var");
    return authState;
  } catch (err) {
    logger.error({ err }, "Failed to parse SESSION_ID — re-pair on the pairing page to get a new one");
    return null;
  }
}

// Files that must be included for the bot to reconnect AND decrypt first messages.
//   creds.json     → registration identity + signed pre-key → reconnection to WA
//   pre-key-N.json → one-time pre-keys uploaded to WA servers → decrypt first
//                    message from any new contact that fetches one of these keys
//
// Excluded deliberately to stay within Heroku's 64 KB config-var limit:
//   session-*.json          → P2P Signal sessions; re-established automatically
//                             via key-retry (getMessage returns undefined)
//   sender-key-*.json       → Group sender keys; re-exchanged on bot reconnect
//   app-state-sync-key-*.json / app-state-sync-version-*.json → not needed for
//                             message decryption at all
//
// Estimated encoded size of creds + 30 pre-keys ≈ 4–8 KB — well under 64 KB.
const ESSENTIAL_PREFIXES = ["creds.json", "pre-key-"];

export async function encodeSessionToBase64(fileMap: SessionFileMap): Promise<string> {
  const essential: SessionFileMap = {};

  for (const [filename, content] of Object.entries(fileMap)) {
    if (ESSENTIAL_PREFIXES.some((p) => filename === p || filename.startsWith(p))) {
      essential[filename] = content;
    }
  }

  // Safety fallback: if filtering left us with nothing, encode everything
  const toEncode = Object.keys(essential).length > 0 ? essential : fileMap;

  const fileNames = Object.keys(toEncode);
  logger.info(
    { files: fileNames.length, names: fileNames.slice(0, 8) },
    "Encoding session (creds + pre-keys only)"
  );

  const json       = Buffer.from(JSON.stringify(toEncode), "utf-8");
  const compressed = await gzip(json);
  const encoded    = SESSION_PREFIX + compressed.toString("base64");
  logger.info({ byteLength: encoded.length }, "SESSION_ID size (characters)");
  return encoded;
}
