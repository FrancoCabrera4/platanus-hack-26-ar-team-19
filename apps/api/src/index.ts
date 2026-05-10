import "dotenv/config";
import { createServer } from "./server";
import { log } from "@repo/logger";

const port = process.env.PORT || 4000;
const server = createServer();

const httpServer = server.listen(port, () => {
  log(`agentic-marketplace api running on ${port}`);
  const provider = process.env.LLM_PROVIDER ?? (process.env.OPENAI_API_KEY ? "openai" : "gemini");
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    log("WARN: OPENAI_API_KEY is unset — agent endpoints will fail until you set it.");
  }
  if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
    log("WARN: GEMINI_API_KEY is unset — agent endpoints will fail until you set it.");
  }
});

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    log(`Port ${port} busy, retrying in 1s...`);
    setTimeout(() => httpServer.listen(port), 1000);
  }
});

process.on("SIGTERM", () => httpServer.close());
process.on("SIGINT", () => httpServer.close());
