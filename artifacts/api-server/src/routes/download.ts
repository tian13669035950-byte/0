import { Router } from "express";
import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";

const router = Router();

// Resolve to workspace root (api-server is at artifacts/api-server, so go up two levels)
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
  "README.md",
];

router.get("/download-source", (req, res) => {
  res.setHeader("Content-Type", "application/x-gzip");
  res.setHeader("Content-Disposition", 'attachment; filename="scraper-tool.tar.gz"');

  // Only include paths that actually exist
  const existingPaths = SOURCE_PATHS.filter((p) => fs.existsSync(path.join(ROOT, p)));

  const tar = spawn("tar", ["czf", "-", "-C", ROOT, ...existingPaths], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  tar.stdout.pipe(res);

  tar.stderr.on("data", (d: Buffer) => console.error("[download]", d.toString().trim()));

  tar.on("error", (err: Error) => {
    console.error("[download] spawn error:", err);
    if (!res.headersSent) res.status(500).end("打包失败");
  });

  tar.on("close", (code: number) => {
    if (code !== 0) console.warn("[download] tar exited with code", code);
  });

  req.on("close", () => tar.kill());
});

export default router;
