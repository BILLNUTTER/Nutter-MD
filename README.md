# NUTTER-XMD

> A powerful WhatsApp multi-device bot by [@nutterxtech](https://github.com/nutterxtech)

---

## What is NUTTER-XMD?

NUTTER-XMD is a WhatsApp bot that runs on your own Heroku instance. It supports group management, anti-spam protection, and essential automation — all configurable via WhatsApp commands.

---

## How to Deploy

### Step 1: Get Your Session ID

Visit the pairing page and link your WhatsApp number:

**Pairing Page:** [𝗣𝗔𝗜𝗥𝗜𝗡𝗚 𝗣𝗔𝗚𝗘](https://nutter-xmd-d5ce894ba4519.herokuapp.com)

1. Enter your phone number in international format (e.g. `+254712345678`)
2. You will receive a pair code — enter it in WhatsApp under **Linked Devices → Link a Device**
3. After linking, copy the **Session ID** shown on the page

---

### Step 2: Fork this Repo

[Fork Nutter-MD on GitHub](https://github.com/nutterxtech/Nutter-MD/fork)

---

### Step 3: Deploy to Heroku

[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://nutter-md-31047d4ad9a9.herokuapp.com/deploy)

You will be asked to fill in:

| Config Var     | Description                                | Required |
| -------------- | ------------------------------------------ | -------- |
| `SESSION_ID`   | Session ID from pairing page               | Yes      |
| `OWNER_NUMBER` | Your WhatsApp number (e.g. `254712345678`) | Yes      |
| `BOT_NAME`     | Bot display name                           | No       |
| `PREFIX`       | Command prefix (default `.`)               | No       |

---

## Commands

### General Commands

| Command    | Description                  |
| ---------- | ---------------------------- |
| `.menu`    | Show all available commands  |
| `.ping`    | Check bot response latency   |
| `.alive`   | Show bot uptime and status   |
| `.sticker` | Convert media to sticker     |
| `.restart` | Restart the bot (owner only) |

---

### Group Management (Bot must be admin)

| Command               | Description         |
| --------------------- | ------------------- |
| `.kick @user`         | Remove a member     |
| `.add +number`        | Add a member        |
| `.promote @user`      | Make admin          |
| `.demote @user`       | Remove admin        |
| `.antilink on/off`    | Block links         |
| `.antibadword on/off` | Filter profanity    |
| `.antimention on/off` | Block mass mentions |
| `.ban @user`          | Ban user from bot   |
| `.unban @user`        | Unban user          |

---

## Requirements

* Node.js 18+
* Heroku account
* WhatsApp account

---

## Tech Stack

* **WhatsApp:** [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)
* **Runtime:** Node.js
* **Database:** PostgreSQL (Heroku Postgres)
* **Sessions:** Stored as Heroku config var (SESSION_ID)

---

## Credits

* Developer: [@nutterxtech](https://github.com/nutterxtech)
* Built with [Baileys](https://github.com/WhiskeySockets/Baileys)

---

## Support

For help, open an issue on GitHub or contact the bot owner.

> **Note:** SESSION_ID is stored securely in Heroku config vars and not in the database.
