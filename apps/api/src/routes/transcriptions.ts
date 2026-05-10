import multer, { memoryStorage, MulterError } from "multer";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as RouterType,
} from "express";
import { requireAuth } from "../auth";
import { transcribeAudio } from "../services/transcription";

export const transcriptionsRouter: RouterType = Router();

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/mpga",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);

const uploadAudio = multer({
  storage: memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!SUPPORTED_AUDIO_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("unsupported_audio_type"));
      return;
    }
    cb(null, true);
  },
}).single("file");

transcriptionsRouter.use((req, res, next) => {
  void requireAuth(req, res, next);
});

async function handleTranscription(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.file) {
    res.status(400).json({ error: "audio_required" });
    return;
  }

  try {
    const text = await transcribeAudio({
      buffer: req.file.buffer,
      filename: req.file.originalname || "audio.webm",
      mimeType: req.file.mimetype,
    });
    res.json({ text });
  } catch (err) {
    if ((err as Error).message === "missing_openai_api_key") {
      res.status(503).json({ error: "transcription_unavailable" });
      return;
    }
    next(err);
  }
}

transcriptionsRouter.post("/", (req, res, next) => {
  uploadAudio(req, res, (uploadErr) => {
    if (uploadErr) {
      if (uploadErr instanceof MulterError && uploadErr.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "audio_too_large" });
        return;
      }
      if ((uploadErr as Error).message === "unsupported_audio_type") {
        res.status(415).json({ error: "unsupported_audio_type" });
        return;
      }
      next(uploadErr);
      return;
    }

    void handleTranscription(req, res, next);
  });
});
