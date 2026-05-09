import "dotenv/config";
import { createServer } from "./server";
import { log } from "@repo/logger";

const port = process.env.PORT || 4000;
const server = createServer();

server.listen(port, () => {
  log(`agentic-marketplace api running on ${port}`);
  if (!process.env.OPENAI_API_KEY) {
    log("WARN: OPENAI_API_KEY is unset — agent endpoints will fail until you set it.");
  }
});
