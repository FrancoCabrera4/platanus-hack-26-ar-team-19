import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { Router, type Request, type Router as RouterType } from "express";
import { requireAuth } from "../auth";

export const uploadsRouter: RouterType = Router();

export const uploadsDir = process.cwd().endsWith(`${path.sep}apps${path.sep}api`)
  ? path.resolve(process.cwd(), "../public/uploads")
  : path.resolve(process.cwd(), "apps/public/uploads");

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function boundaryFrom(contentType: string | undefined): string | null {
  const match = contentType?.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  return match?.[1] ?? match?.[2] ?? null;
}

async function readRequest(req: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_IMAGE_BYTES) throw new Error("image_too_large");
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function extractImage(body: Buffer, boundary: string): { contentType: string; data: Buffer } | null {
  const raw = body.toString("latin1");
  const parts = raw.split(`--${boundary}`);

  for (const part of parts) {
    if (!part.includes('name="image"')) continue;

    const [rawHeaders, ...bodyParts] = part.split("\r\n\r\n");
    if (!rawHeaders || bodyParts.length === 0) return null;

    const contentType = rawHeaders.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim() ?? "";
    const content = bodyParts.join("\r\n\r\n").replace(/\r\n$/, "");
    return { contentType, data: Buffer.from(content, "latin1") };
  }

  return null;
}

uploadsRouter.post("/image", requireAuth, async (req, res, next) => {
  try {
    const boundary = boundaryFrom(req.headers["content-type"]);
    if (!boundary) return res.status(400).json({ error: "invalid_multipart" });

    const image = extractImage(await readRequest(req), boundary);
    if (!image || image.data.length === 0) return res.status(400).json({ error: "image_required" });

    const ext = EXT_BY_MIME[image.contentType];
    if (!ext) return res.status(415).json({ error: "unsupported_image_type" });

    await fs.mkdir(uploadsDir, { recursive: true });

    const filename = `${randomUUID()}.${ext}`;
    await fs.writeFile(path.join(uploadsDir, filename), image.data);

    return res.status(201).json({ url: `/uploads/${filename}` });
  } catch (err) {
    if ((err as Error).message === "image_too_large") {
      return res.status(413).json({ error: "image_too_large" });
    }
    return next(err);
  }
});
