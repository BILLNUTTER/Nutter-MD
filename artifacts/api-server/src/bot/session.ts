import { logger } from "../lib/logger";
import fs from "fs";
import path from "path";
import os from "os";

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

  try {
    const decoded = Buffer.from(sessionId, "base64").toString("utf-8");
    const fileMap = JSON.parse(decoded) as SessionFileMap;

    const { useMultiFileAuthState } = await import("@whiskeysockets/baileys");

    const sessionDir = path.join(os.tmpdir(), `nutter-xmd-session-${process.pid}`);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sessionDir, { recursive: true });

    for (const [filename, content] of Object.entries(fileMap)) {
      fs.writeFileSync(path.join(sessionDir, filename), JSON.stringify(content), "utf-8");
    }

    const authState = await useMultiFileAuthState(sessionDir);
    logger.info({ sessionDir }, "Session loaded from SESSION_ID env var");
    return authState;
  } catch (err) {
    logger.error({ err }, "Failed to parse SESSION_ID — ensure it is a valid base64-encoded JSON string");
    return null;
  }
}

export function encodeSessionToBase64(fileMap: SessionFileMap): string {
  return Buffer.from(JSON.stringify(fileMap)).toString("base64");
}
