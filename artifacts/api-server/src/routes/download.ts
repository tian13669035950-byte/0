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

// Windows one-click launcher — checks pnpm + deps, then opens two cmd windows
// Uses CRLF line endings so Windows batch interpreter is happy
const BAT_LINES = [
  "@echo off",
  "chcp 65001 >nul",
  "title 一键启动 - ScraperTool",
  "echo.",
  "echo ============================================",
  "echo   ScraperTool  一键启动",
  "echo ============================================",
  "echo.",
  "",
  ":: ── 检查 pnpm ──────────────────────────────",
  "where pnpm >nul 2>&1",
  "if errorlevel 1 (",
  "    echo [错误] 未检测到 pnpm，请先在 PowerShell 里运行：",
  "    echo         npm install -g pnpm",
  "    echo.",
  "    pause",
  "    exit /b 1",
  ")",
  "",
  ":: ── 检查依赖是否已安装（pnpm workspace 锁标志）──",
  'if not exist "node_modules\\.pnpm" (',
  "    echo [提示] 依赖尚未安装，正在自动安装，请稍候...",
  "    echo       （首次安装约需 2～5 分钟，请保持网络畅通）",
  "    echo.",
  "    pnpm install",
  "    if errorlevel 1 (",
  "        echo.",
  "        echo [错误] 安装失败，请检查网络连接后重试。",
  "        pause",
  "        exit /b 1",
  "    )",
  "    echo.",
  "    echo [完成] 依赖安装成功！",
  "    echo.",
  ")",
  "",
  ":: ── 启动后端（8080）────────────────────────",
  'echo [启动] 后端服务（端口 8080）...',
  'start "ScraperTool 后端" cmd /k "pnpm --filter @workspace/api-server run dev"',
  "",
  ":: ── 等 2 秒再开前端，避免端口冲突误报 ────────",
  "timeout /t 2 /nobreak >nul",
  "",
  ":: ── 启动前端（25879）───────────────────────",
  'echo [启动] 前端界面（端口 25879）...',
  'start "ScraperTool 前端" cmd /k "pnpm --filter @workspace/scraper-tool run dev"',
  "",
  "echo.",
  "echo ============================================",
  "echo   两个服务已在独立窗口中启动",
  "echo   请等待 20～40 秒让服务完全就绪",
  "echo   然后浏览器打开：http://localhost:25879",
  "echo ============================================",
  "echo.",
  "pause",
];
const BAT_TEMPLATE = BAT_LINES.join("\r\n") + "\r\n";

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

  // Add Windows one-click launcher (CRLF line endings for cmd.exe compatibility)
  archive.append(Buffer.from(BAT_TEMPLATE, "utf8"), { name: "一键启动.bat" });

  archive.finalize();
});

export default router;
