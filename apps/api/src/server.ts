import { json, urlencoded } from "body-parser";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import morgan from "morgan";
import cors from "cors";
import path from "path";

import { usersRouter } from "./routes/users";
import { conversationsRouter } from "./routes/conversations";
import { productsRouter } from "./routes/products";
import { searchesRouter } from "./routes/searches";
import { negotiationsRouter } from "./routes/negotiations";
import { jobsRouter } from "./routes/jobs";
import { authRouter } from "./routes/auth";
import { uploadsRouter } from "./routes/uploads";
import { log } from "@repo/logger";

export const createServer = (): Express => {
  const app = express();

  app
    .disable("x-powered-by")
    .use(morgan("dev"))
    .use(urlencoded({ extended: true }))
    .use(json({ limit: "1mb" }))
    .use(cors({
      origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
      credentials: true,
    }))
    .use("/uploads", express.static(path.resolve(__dirname, "../public/uploads")))
    .get("/status", (_req, res) => res.json({ ok: true }))
    .use("/auth", authRouter)
    .use("/users", usersRouter)
    .use("/conversations", conversationsRouter)
    .use("/products", productsRouter)
    .use("/searches", searchesRouter)
    .use("/negotiations", negotiationsRouter)
    .use("/jobs", jobsRouter)
    .use("/uploads", uploadsRouter);

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log("ERROR", err.message, err.stack);
    res.status(500).json({ error: err.message });
  });

  return app;
};
