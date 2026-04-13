import { Router } from "express";
import path from "path";
import fs from "fs";

const router = Router();

// Store data two levels up from artifacts/api-server → workspace root /data/
// This directory is intentionally NOT included in the download zip,
// so it survives source-code updates when the user extracts a new version.
const DATA_DIR = path.resolve(process.cwd(), "../../data");
const BACKUP_FILE = path.join(DATA_DIR, "scraper-collected-v1.json");

router.get("/store/backup", (_req, res) => {
  try {
    if (!fs.existsSync(BACKUP_FILE)) return res.json([]);
    const raw = fs.readFileSync(BACKUP_FILE, "utf-8");
    res.json(JSON.parse(raw));
  } catch {
    res.status(500).json({ error: "读取备份失败" });
  }
});

router.post("/store/backup", (req, res) => {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(req.body, null, 2), "utf-8");
    res.json({ ok: true, path: BACKUP_FILE });
  } catch {
    res.status(500).json({ error: "保存备份失败" });
  }
});

export default router;
