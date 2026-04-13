import { Router } from "express";
import path from "path";
import fs from "fs";
import { createRequire } from "module";

const router = Router();
const _require = createRequire(import.meta.url);

// Resolve to workspace root (api-server is at artifacts/api-server, go up two levels)
const ROOT = path.resolve(process.cwd(), "../..");

const SOURCE_PATHS = [
  "artifacts/api-server/src",
  "artifacts/api-server/package.json",
  "artifacts/api-server/build.mjs",
  "artifacts/api-server/tsconfig.json",
  "artifacts/scraper-tool/src",
  "artifacts/scraper-tool/public",
  "artifacts/scraper-tool/package.json",
  "artifacts/scraper-tool/vite.config.ts",
  "artifacts/scraper-tool/tsconfig.json",
  "artifacts/scraper-tool/index.html",
  "artifacts/scraper-tool/components.json",
  "lib",
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "tsconfig.base.json",
  "README.md",
];

// Pre-filled .env template — uses Microsoft Edge which ships with Windows 10/11
const ENV_TEMPLATE = `# ── 必填：会话加密密钥，随机字符串即可，越长越好 ───────────────────────────────
SESSION_SECRET=请替换成你自己的随机字符串至少32位

# ── 浏览器路径（以下三行选一个取消注释） ─────────────────────────────────────────

# Microsoft Edge（Windows 10/11 自带，推荐）
CHROMIUM_PATH=C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe

# Google Chrome
# CHROMIUM_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe

# Linux / macOS（服务器部署时用）
# CHROMIUM_PATH=/usr/bin/chromium-browser
`;

router.get("/download-source", (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const archiver = _require("archiver") as any;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="scraper-tool.zip"');

  const archive = archiver("zip", { zlib: { level: 6 } });

  archive.on("error", (err: Error) => {
    console.error("[download] archiver error:", err);
    if (!res.headersSent) res.status(500).end("打包失败");
  });

  archive.pipe(res);

  // Add all source paths that exist
  for (const relPath of SOURCE_PATHS) {
    const absPath = path.join(ROOT, relPath);
    if (!fs.existsSync(absPath)) continue;
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      archive.directory(absPath, relPath);
    } else {
      archive.file(absPath, { name: relPath });
    }
  }

  // Add pre-filled .env template into the zip root
  archive.append(ENV_TEMPLATE, { name: ".env" });

  archive.finalize();
});

export default router;
