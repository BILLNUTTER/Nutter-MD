import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  if (process.env["SESSION_ID"]) {
    import("./bot/botEngine")
      .then(({ startBot }) => startBot())
      .catch((err) => {
        logger.error({ err }, "Bot engine failed to start");
      });
  } else {
    logger.info(
      "SESSION_ID not set — running in pairing/admin mode only (bot engine not started)",
    );
  }
});
