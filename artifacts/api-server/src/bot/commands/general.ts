import type { WASocket, proto } from "@whiskeysockets/baileys";
import type { CommandContext } from "../handler";
import { logger } from "../../lib/logger";

export async function handlePing(sock: WASocket, msg: proto.IWebMessageInfo, ctx: CommandContext) {
  const start = Date.now();
  await sock.sendMessage(ctx.jid, { text: "🏓 Pong!" });
  const latency = Date.now() - start;
  await sock.sendMessage(ctx.jid, { text: `*Latency:* ${latency}ms` });
}

export async function handleAlive(sock: WASocket, _msg: proto.IWebMessageInfo, ctx: CommandContext) {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  const text = `*NUTTER-XMD* ⚡\n\n*Status:* Online\n*Uptime:* ${hours}h ${minutes}m ${seconds}s\n*Version:* 1.0.0`;
  await sock.sendMessage(ctx.jid, { text });
}

export async function handleMenu(sock: WASocket, _msg: proto.IWebMessageInfo, ctx: CommandContext, prefix: string) {
  const botName = process.env["BOT_NAME"] || "NUTTER-XMD";
  const menu = `*${botName}* — Command Menu\n\n` +
    `*General*\n` +
    `${prefix}ping — Check bot latency\n` +
    `${prefix}alive — Bot uptime & status\n` +
    `${prefix}menu — Show this menu\n` +
    `${prefix}owner — Get owner contact\n` +
    `${prefix}settings — Current bot settings\n` +
    `${prefix}sticker — Convert image to sticker (reply to image)\n\n` +
    `*Group Management* (Admin only)\n` +
    `${prefix}kick @user — Remove member\n` +
    `${prefix}add +number — Add member\n` +
    `${prefix}promote @user — Make admin\n` +
    `${prefix}demote @user — Remove admin\n` +
    `${prefix}antilink on/off — Block links\n` +
    `${prefix}antibadword on/off — Block bad words\n` +
    `${prefix}antimention on/off — Block mass mentions\n` +
    `${prefix}ban @user — Ban user from bot\n` +
    `${prefix}unban @user — Unban user\n` +
    `${prefix}setprefix <char> — Change command prefix`;
  await sock.sendMessage(ctx.jid, { text: menu });
}

export async function handleOwner(sock: WASocket, _msg: proto.IWebMessageInfo, ctx: CommandContext) {
  const ownerNumber = process.env["OWNER_NUMBER"] || "";
  if (!ownerNumber) {
    await sock.sendMessage(ctx.jid, { text: "Owner number not configured." });
    return;
  }
  const digits = ownerNumber.replace(/[^0-9]/g, "");
  await sock.sendMessage(ctx.jid, {
    contacts: {
      displayName: "NUTTER-XMD Owner",
      contacts: [{ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:NUTTER-XMD Owner\nTEL;type=CELL;type=VOICE;waid=${digits}:+${digits}\nEND:VCARD`, displayName: "NUTTER-XMD Owner" }]
    }
  });
}

export async function handleSettings(sock: WASocket, _msg: proto.IWebMessageInfo, ctx: CommandContext, prefix: string) {
  const botName = process.env["BOT_NAME"] || "NUTTER-XMD";
  const ownerNumber = process.env["OWNER_NUMBER"] || "Not set";

  let groupInfo = "";
  if (ctx.groupSettings) {
    groupInfo = `\n\n*Group Protection*\nAntilink: ${ctx.groupSettings.antilink ? "ON" : "OFF"}\nAntibadword: ${ctx.groupSettings.antibadword ? "ON" : "OFF"}\nAntimention: ${ctx.groupSettings.antimention ? "ON" : "OFF"}\nCustom Prefix: ${ctx.groupSettings.customPrefix || prefix}`;
  }

  const text = `*${botName} Settings*\n\nPrefix: ${prefix}\nOwner: ${ownerNumber}${groupInfo}`;
  await sock.sendMessage(ctx.jid, { text });
}

async function downloadToBuffer(mediaMsg: object, type: "image" | "video"): Promise<Buffer> {
  const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
  const stream = await downloadContentFromMessage(
    mediaMsg as Parameters<typeof downloadContentFromMessage>[0],
    type
  );
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function extractVideoFirstFrame(videoBuffer: Buffer): Promise<Buffer> {
  const os = await import("os");
  const path = await import("path");
  const fs = await import("fs");
  const { spawn } = await import("child_process");

  const tmpDir = os.default.tmpdir();
  const inputPath = path.default.join(tmpDir, `nutter_vid_${Date.now()}.mp4`);
  const outputPath = path.default.join(tmpDir, `nutter_frame_${Date.now()}.png`);

  fs.default.writeFileSync(inputPath, videoBuffer);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y", "-i", inputPath,
      "-ss", "0", "-vframes", "1",
      "-f", "image2", outputPath,
    ]);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    proc.on("error", reject);
  });

  const frameBuffer = fs.default.readFileSync(outputPath);
  fs.default.rmSync(inputPath, { force: true });
  fs.default.rmSync(outputPath, { force: true });
  return frameBuffer;
}

export async function handleSticker(sock: WASocket, msg: proto.IWebMessageInfo, ctx: CommandContext) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) {
    await sock.sendMessage(ctx.jid, { text: "Reply to an image or video with .sticker to convert it to a sticker." });
    return;
  }

  const imageMsg = quoted.imageMessage;
  const videoMsg = quoted.videoMessage;

  if (!imageMsg && !videoMsg) {
    await sock.sendMessage(ctx.jid, { text: "Only images and short videos can be converted to stickers. Reply to an image or video." });
    return;
  }

  try {
    const { default: sharp } = await import("sharp");

    let sourceBuffer: Buffer;

    if (imageMsg) {
      sourceBuffer = await downloadToBuffer(imageMsg, "image");
    } else {
      sourceBuffer = await downloadToBuffer(videoMsg!, "video");
      sourceBuffer = await extractVideoFirstFrame(sourceBuffer);
    }

    if (!sourceBuffer || sourceBuffer.length === 0) {
      await sock.sendMessage(ctx.jid, { text: "Could not download the media. Please try again." });
      return;
    }

    const webpBuffer = await sharp(sourceBuffer)
      .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 80 })
      .toBuffer();

    await sock.sendMessage(ctx.jid, { sticker: webpBuffer });
  } catch (err) {
    logger.error({ err }, "Sticker conversion failed");
    await sock.sendMessage(ctx.jid, { text: "Sticker conversion failed. Please try again." });
  }
}

export async function handleRestart(sock: WASocket, _msg: proto.IWebMessageInfo, ctx: CommandContext) {
  if (!ctx.isOwner) {
    await sock.sendMessage(ctx.jid, { text: "Only the bot owner can restart." });
    return;
  }
  await sock.sendMessage(ctx.jid, { text: "Restarting..." });
  setTimeout(() => process.exit(0), 1000);
}
