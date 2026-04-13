import { config } from "dotenv";
import { resolve } from "path";
// Load .env from workspace root (two levels up from artifacts/api-server)
config({ path: resolve(process.cwd(), "../../.env") });
// Also try local .env
config();

import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
