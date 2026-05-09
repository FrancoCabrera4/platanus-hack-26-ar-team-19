import { Router, type Router as RouterType } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import path from "path";
import { requireAuth } from "../auth";

export const uploadsRouter: RouterType = Router();

const storage = multer.diskStorage({
  destination: path.resolve(__dirname, "../../public/uploads"),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

uploadsRouter.use(requireAuth);

uploadsRouter.post("/image", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file provided" });
  }
  const url = `/uploads/${req.file.filename}`;
  return res.json({ url });
});
