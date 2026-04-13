import { Router } from "express";
import { chromium } from "playwright-core";
import { randomUUID } from "crypto";

const router = Router();

const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

const VIEWPORT = { width: 1280, height: 720 };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecordedStep {
  type: "click" | "type" | "select";
  selector: string;
  text?: string;
  value?: string;
  label?: string;
  navigatedTo?: string;
}

interface RecorderSession {
  browser: import("playwright-core").Browser;
  page: import("playwright-core").Page;
  lastActivity: number;
  steps: RecordedStep[];
  currentUrl: string;
}

// ─── Session registry ─────────────────────────────────────────────────────────

const sessions = new Map<string, RecorderSession>();

// Auto-cleanup inactive sessions (>5 min idle)
setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [id, s] of sessions) {
    if (s.lastActivity < cutoff) {
      s.browser.close().catch(() => {});
      sessions.delete(id);
    }
  }
}, 60_000);

// ─── CSS selector generator (runs inside page context) ───────────────────────

const GET_SELECTOR = `(el) => {
  if (!el || el.nodeType !== 1) return '';
  if (el === document.body) return 'body';
  const parts = [];
  let cur = el;
  for (let d = 0; d < 8; d++) {
    if (!cur || cur === document.documentElement) break;
    if (cur.id && /^[a-zA-Z][\\w:-]*$/.test(cur.id)) {
      parts.unshift('#' + CSS.escape(cur.id));
      break;
    }
    let tag = cur.tagName.toLowerCase();
    const parent = cur.parentElement;
    if (parent) {
      const sibs = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
      if (sibs.length > 1) tag += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
    }
    parts.unshift(tag);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}`;

const GET_LABEL = `(el) => {
  return (
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('name') ||
    el.textContent?.trim().slice(0, 60) || ''
  ).replace(/\\s+/g, ' ').trim();
}`;

// ─── POST /api/record/session/start ──────────────────────────────────────────
router.post("/record/session/start", async (req, res) => {
  let { url } = req.body as { url?: string };
  if (!url?.trim()) return res.status(400).json({ error: "Missing url" });
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  try {
    const browser = await chromium.launch({
      headless: true,
      executablePath: CHROMIUM_PATH,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const ctx = await browser.newContext({ viewport: VIEWPORT, userAgent: UA });
    const page = await ctx.newPage();

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch {
      // keep going even if networkidle times out
    }

    const sessionId = randomUUID();
    sessions.set(sessionId, {
      browser,
      page,
      lastActivity: Date.now(),
      steps: [],
      currentUrl: page.url(),
    });

    res.json({ sessionId, url: page.url() });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── GET /api/record/session/:id/stream  (SSE screenshot stream) ─────────────
router.get("/record/session/:id/stream", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let alive = true;
  const send = (obj: object) => {
    if (!alive) return;
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { alive = false; }
  };

  // Send first frame immediately
  try {
    const shot = await session.page.screenshot({ type: "jpeg", quality: 70 });
    send({ type: "screenshot", data: shot.toString("base64"), url: session.page.url() });
  } catch {}

  const loop = setInterval(async () => {
    if (!alive) return;
    session.lastActivity = Date.now();
    try {
      const shot = await session.page.screenshot({ type: "jpeg", quality: 70 });
      const url = session.page.url();
      if (url !== session.currentUrl) {
        session.currentUrl = url;
        send({ type: "navigated", url });
      }
      send({ type: "screenshot", data: shot.toString("base64"), url });
    } catch {
      alive = false;
      clearInterval(loop);
    }
  }, 300); // ~3fps — safe even on a slow server

  req.on("close", () => { alive = false; clearInterval(loop); });
});

// ─── POST /api/record/session/:id/interact ────────────────────────────────────
router.post("/record/session/:id/interact", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  session.lastActivity = Date.now();

  const { action, x, y, text, key, deltaY } = req.body as {
    action: "click" | "type" | "key" | "scroll";
    x?: number; y?: number;   // normalized 0–1
    text?: string;
    key?: string;
    deltaY?: number;
  };

  const page = session.page;

  try {
    if (action === "click" && x !== undefined && y !== undefined) {
      const px = Math.round(x * VIEWPORT.width);
      const py = Math.round(y * VIEWPORT.height);

      // Get element info BEFORE clicking
      const info = await page.evaluate(
        ({ selectorFn, labelFn, px, py }) => {
          const el = document.elementFromPoint(px, py) as Element | null;
          if (!el) return null;
          const getSelector = new Function("el", `return (${selectorFn})(el);`) as (el: Element) => string;
          const getLabel = new Function("el", `return (${labelFn})(el);`) as (el: Element) => string;
          return {
            selector: getSelector(el),
            label: getLabel(el),
            tag: el.tagName.toLowerCase(),
          };
        },
        { selectorFn: GET_SELECTOR, labelFn: GET_LABEL, px, py }
      );

      const prevUrl = page.url();
      await page.mouse.click(px, py);

      // Wait briefly for potential navigation or JS response
      await page.waitForTimeout(400);
      const newUrl = page.url();

      const step: RecordedStep = {
        type: "click",
        selector: info?.selector ?? "",
        label: info?.label ?? "",
        ...(newUrl !== prevUrl ? { navigatedTo: newUrl } : {}),
      };
      session.steps.push(step);
      res.json({ step, url: newUrl });

    } else if (action === "type" && text) {
      await page.keyboard.type(text, { delay: 30 });
      res.json({ ok: true });

    } else if (action === "key" && key) {
      await page.keyboard.press(key);
      await page.waitForTimeout(200);
      res.json({ ok: true, url: page.url() });

    } else if (action === "scroll" && x !== undefined && y !== undefined) {
      const px = Math.round(x * VIEWPORT.width);
      const py = Math.round(y * VIEWPORT.height);
      await page.mouse.move(px, py);
      await page.mouse.wheel(0, deltaY ?? 300);
      res.json({ ok: true });

    } else {
      res.status(400).json({ error: "Invalid action or missing params" });
    }
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── DELETE /api/record/session/:id ──────────────────────────────────────────
router.delete("/record/session/:id", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Not found" });
  await session.browser.close().catch(() => {});
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

export default router;
