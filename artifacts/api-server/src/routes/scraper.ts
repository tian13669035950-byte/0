import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { launchStealthBrowser, newStealthContext } from "../lib/stealth-browser";

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CustomSelectorSchema = z.object({
  name: z.string(),
  selector: z.string(),
});

const ScrapeStepSchema = z.object({
  type: z.enum(["click", "listen", "type", "key", "select", "scroll", "hover", "navigate", "capture", "goback", "goforward", "reload", "wait", "screenshot", "rightclick", "doubleclick", "newtab", "switchtab", "closetab"]),
  selector: z.string().optional(),
  waitMs: z.number().optional(),
  waitForPopupClose: z.boolean().optional(),
  popupTimeoutMs: z.number().optional(),
  listenFor: z.enum(["appear", "disappear", "networkIdle"]).optional(),
  listenTimeout: z.number().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  value: z.string().optional(),
  url: z.string().optional(),
  varName: z.string().optional(),
  incognito: z.boolean().optional(),
  tabIndex: z.number().optional(),
});

const ScrapeOptionsSchema = z.object({
  headings: z.boolean(),
  links: z.boolean(),
  paragraphs: z.boolean(),
  images: z.boolean(),
  metaTags: z.boolean(),
  customSelectors: z.array(CustomSelectorSchema).optional(),
  clickSelector: z.string().optional(),
  clickWaitMs: z.number().optional(),
  waitForPopupClose: z.boolean().optional(),
  popupTimeoutMs: z.number().optional(),
  steps: z.array(ScrapeStepSchema).optional(),
});

const ScrapeRequestSchema = z.object({
  url: z.string().url(),
  options: ScrapeOptionsSchema,
  proxy: z.string().optional(),
  headed: z.boolean().optional(),
});

function parseProxy(raw?: string) {
  if (!raw?.trim()) return undefined;
  try {
    const u = new URL(raw.trim());
    const server = `${u.protocol}//${u.host}`;
    return { server, username: u.username || undefined, password: u.password || undefined };
  } catch {
    return { server: raw.trim() };
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ScrapeOptions = z.infer<typeof ScrapeOptionsSchema>;

export type StreamEvent =
  | { t: "step_start"; i: number; stepType: string }
  | { t: "step_done"; i: number; ok: boolean }
  | { t: "captured"; varName: string; value: string }
  | { t: "navigated"; url: string }
  | { t: "watch_ready"; watchId: string }
  | { t: "result"; [key: string]: unknown }
  | { t: "error"; message: string };

// ─── Live-watch sessions (screenshot stream during execution) ─────────────────
interface WatchSession { page: import("playwright-core").Page | null }
const watchSessions = new Map<string, WatchSession>();

interface ScrapeHistoryItem {
  id: string;
  url: string;
  title: string;
  scrapedAt: string;
  duration: number;
  itemCount: number;
  capturedVars?: Record<string, string>;
  customResults?: { name: string; selector: string; values: string[] }[];
}

const history: ScrapeHistoryItem[] = [];

// ─── Core session runner ──────────────────────────────────────────────────────
// `emit` is called with streaming events as execution progresses.
// For non-streaming callers, pass `() => {}`.

async function runScrapeSession(
  url: string,
  options: ScrapeOptions,
  emit: (event: StreamEvent) => void,
  watchId?: string,
  proxyRaw?: string,
  headed?: boolean,
) {
  const startTime = Date.now();
  const proxy = parseProxy(proxyRaw);
  const browser = await launchStealthBrowser(headed ?? false);

  try {
    const newCtx = () => newStealthContext(browser, proxy ? { proxy } : {});
    let ctx = await newCtx();
    let page = await ctx.newPage();

    // Track all open tabs so steps can switch between them
    const tabs: import("playwright-core").Page[] = [page];

    const setActivePage = (p: import("playwright-core").Page) => {
      page = p;
      if (watchId && watchSessions.has(watchId)) watchSessions.get(watchId)!.page = p;
    };

    // Register page so the live-watch SSE stream can grab screenshots
    if (watchId && watchSessions.has(watchId)) {
      watchSessions.get(watchId)!.page = page;
    }

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);

    let clickedElement: string | undefined;
    const vars: Record<string, string> = {};

    const resolveVars = (str: string) =>
      str.replace(/\$\{([^}]+)\}/g, (_, n) => vars[n.trim()] ?? "");

    const effectiveSteps =
      options.steps && options.steps.length > 0
        ? options.steps
        : options.clickSelector?.trim()
        ? [
            {
              type: "click" as const,
              selector: options.clickSelector.trim(),
              waitMs: options.clickWaitMs ?? 2000,
              waitForPopupClose: options.waitForPopupClose,
              popupTimeoutMs: options.popupTimeoutMs,
            },
          ]
        : [];

    for (let i = 0; i < effectiveSteps.length; i++) {
      const step = effectiveSteps[i];
      emit({ t: "step_start", i, stepType: step.type });
      let ok = true;

      if (step.type === "listen") {
        const timeout = step.listenTimeout ?? 15000;
        const condition = step.listenFor ?? "appear";
        try {
          if (condition === "networkIdle") {
            await page.waitForLoadState("networkidle", { timeout });
          } else if (step.selector?.trim()) {
            const sel = step.selector.trim();
            await page.waitForSelector(sel, {
              state: condition === "appear" ? "visible" : "hidden",
              timeout,
            });
          }
        } catch {
          ok = false;
        }
        if (step.waitMs) await page.waitForTimeout(step.waitMs);

      } else if (step.type === "click" && step.selector?.trim()) {
        const selector = step.selector.trim();
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          if (step.waitForPopupClose) {
            const popupTimeout = step.popupTimeoutMs ?? 30000;
            const popupPromise = page.context().waitForEvent("page", { timeout: popupTimeout });
            await page.click(selector);
            clickedElement = selector;
            try {
              const popup = await popupPromise;
              await popup.waitForEvent("close", { timeout: popupTimeout });
            } catch { ok = false; }
          } else {
            await page.click(selector);
            clickedElement = selector;
          }
          if (step.waitMs) await page.waitForTimeout(step.waitMs);
        } catch { ok = false; }

      } else if (step.type === "navigate" && step.url?.trim()) {
        const targetUrl = resolveVars(step.url.trim());
        if (step.incognito !== false) {
          await ctx.close();
          ctx = await newCtx();
          const newPage = await ctx.newPage();
          tabs.length = 0; tabs.push(newPage);
          setActivePage(newPage);
        }
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(step.waitMs ?? 1500);
        emit({ t: "navigated", url: targetUrl });

      } else if (step.type === "capture" && step.selector?.trim() && step.varName?.trim()) {
        const selector = step.selector.trim();
        const varName = step.varName.trim();
        try {
          let captured = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
              return el.value?.trim() || el.getAttribute("placeholder") || "";
            return el.textContent?.trim() || "";
          }, selector);

          if (!captured) {
            for (const frame of page.frames()) {
              if (frame === page.mainFrame()) continue;
              try {
                const v = await frame.evaluate((sel) => {
                  const el = document.querySelector(sel);
                  if (!el) return null;
                  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
                    return el.value?.trim() || "";
                  return el.textContent?.trim() || "";
                }, selector);
                if (v) { captured = v; break; }
              } catch { /* cross-origin */ }
            }
          }

          if (captured) {
            vars[varName] = captured;
            emit({ t: "captured", varName, value: captured });
          } else {
            ok = false;
          }
          if (step.waitMs) await page.waitForTimeout(step.waitMs);
        } catch { ok = false; }

      } else if (step.type === "type" && step.selector?.trim() && step.text) {
        const selector = step.selector.trim();
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          await page.fill(selector, resolveVars(step.text));
          if (step.waitMs) await page.waitForTimeout(step.waitMs);
        } catch { ok = false; }

      } else if (step.type === "key" && step.key) {
        await page.keyboard.press(step.key);
        if (step.waitMs) await page.waitForTimeout(step.waitMs);

      } else if (step.type === "select" && step.selector?.trim() && step.value) {
        const selector = step.selector.trim();
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          await page.selectOption(selector, { label: step.value }).catch(() =>
            page.selectOption(selector, { value: step.value! })
          );
          if (step.waitMs) await page.waitForTimeout(step.waitMs);
        } catch { ok = false; }

      } else if (step.type === "scroll") {
        if (step.selector?.trim()) {
          try {
            await page.locator(step.selector.trim()).first().scrollIntoViewIfNeeded();
          } catch { ok = false; }
        } else {
          await page.mouse.wheel(0, step.waitMs ?? 300);
        }
        if (step.waitMs) await page.waitForTimeout(step.waitMs);

      } else if (step.type === "hover" && step.selector?.trim()) {
        const selector = step.selector.trim();
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          await page.hover(selector);
          if (step.waitMs) await page.waitForTimeout(step.waitMs);
        } catch { ok = false; }

      } else if (step.type === "goback") {
        try {
          await page.goBack({ timeout: 10000, waitUntil: "domcontentloaded" });
          await page.waitForTimeout(step.waitMs ?? 1500);
        } catch { ok = false; }

      } else if (step.type === "goforward") {
        try {
          await page.goForward({ timeout: 10000, waitUntil: "domcontentloaded" });
          await page.waitForTimeout(step.waitMs ?? 1500);
        } catch { ok = false; }

      } else if (step.type === "reload") {
        try {
          await page.reload({ timeout: 15000, waitUntil: "domcontentloaded" });
          await page.waitForTimeout(step.waitMs ?? 1500);
        } catch { ok = false; }

      } else if (step.type === "wait") {
        await page.waitForTimeout(step.waitMs ?? 1000);

      } else if (step.type === "screenshot") {
        // Live watch already streams screenshots; this step just pauses for a moment
        // so the screenshot appears clearly in the watch view
        await page.waitForTimeout(step.waitMs ?? 800);

      } else if (step.type === "rightclick" && step.selector?.trim()) {
        const selector = step.selector.trim();
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          await page.click(selector, { button: "right" });
          if (step.waitMs) await page.waitForTimeout(step.waitMs);
        } catch { ok = false; }

      } else if (step.type === "doubleclick" && step.selector?.trim()) {
        const selector = step.selector.trim();
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          await page.dblclick(selector);
          if (step.waitMs) await page.waitForTimeout(step.waitMs);
        } catch { ok = false; }

      } else if (step.type === "newtab") {
        // Open a new tab in the same browser context, navigate to URL if provided
        try {
          const newTab = await ctx.newPage();
          tabs.push(newTab);
          setActivePage(newTab);
          if (step.url?.trim()) {
            const targetUrl = resolveVars(step.url.trim());
            await newTab.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
            emit({ t: "navigated", url: targetUrl });
          }
          await newTab.waitForTimeout(step.waitMs ?? 1500);
        } catch { ok = false; }

      } else if (step.type === "switchtab") {
        // Switch active tab by index (0 = first/original tab)
        const idx = step.tabIndex ?? 0;
        if (idx >= 0 && idx < tabs.length && !tabs[idx].isClosed()) {
          setActivePage(tabs[idx]);
          await page.bringToFront();
          await page.waitForTimeout(step.waitMs ?? 500);
        } else {
          ok = false;
        }

      } else if (step.type === "closetab") {
        // Close current tab and switch to the previous one
        try {
          const closedPage = page;
          const prevIdx = Math.max(0, tabs.indexOf(closedPage) - 1);
          tabs.splice(tabs.indexOf(closedPage), 1);
          await closedPage.close();
          if (tabs.length > 0) {
            setActivePage(tabs[prevIdx] ?? tabs[tabs.length - 1]);
            await page.bringToFront();
          }
          await page.waitForTimeout(step.waitMs ?? 500);
        } catch { ok = false; }
      }

      emit({ t: "step_done", i, ok });
    }

    const title = await page.title();

    const headings = options.headings
      ? await page.evaluate(() =>
          Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
            .map((el) => ({ level: el.tagName.toLowerCase(), text: el.textContent?.trim() || "" }))
            .filter((h) => h.text.length > 0)
            .slice(0, 50)
        )
      : [];

    const links = options.links
      ? await page.evaluate(() =>
          Array.from(document.querySelectorAll("a[href]"))
            .map((el) => ({ text: el.textContent?.trim() || "", href: (el as HTMLAnchorElement).href || "" }))
            .filter((l) => l.text.length > 0 && l.href.startsWith("http"))
            .slice(0, 50)
        )
      : [];

    const paragraphs = options.paragraphs
      ? await page.evaluate(() =>
          Array.from(document.querySelectorAll("p"))
            .map((el) => el.textContent?.trim() || "")
            .filter((t) => t.length > 20)
            .slice(0, 30)
        )
      : [];

    const images = options.images
      ? await page.evaluate(() =>
          Array.from(document.querySelectorAll("img[src]"))
            .map((el) => ({ src: (el as HTMLImageElement).src || "", alt: (el as HTMLImageElement).alt || "" }))
            .filter((img) => img.src.startsWith("http"))
            .slice(0, 30)
        )
      : [];

    const metaTags = options.metaTags
      ? await page.evaluate(() =>
          Array.from(document.querySelectorAll("meta[name],meta[property]"))
            .map((el) => ({
              name: el.getAttribute("name") || el.getAttribute("property") || "",
              content: el.getAttribute("content") || "",
            }))
            .filter((m) => m.name.length > 0 && m.content.length > 0)
            .slice(0, 30)
        )
      : [];

    async function extractFromFrame(
      frame: import("playwright-core").Frame,
      selector: string
    ): Promise<string[]> {
      return frame.evaluate((sel) => {
        const els = document.querySelectorAll(sel);
        return Array.from(els)
          .map((el) => {
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
              return el.value?.trim() || el.getAttribute("placeholder")?.trim() || "";
            return el.textContent?.trim() || "";
          })
          .filter((t) => t.length > 0)
          .slice(0, 50);
      }, selector);
    }

    const customResults: { name: string; selector: string; values: string[]; foundIn?: string }[] = [];
    if (options.customSelectors && options.customSelectors.length > 0) {
      for (const cs of options.customSelectors) {
        if (!cs.selector.trim()) continue;
        let values = await extractFromFrame(page.mainFrame(), cs.selector);
        let foundIn = "main";
        if (values.length === 0) {
          for (const frame of page.frames()) {
            if (frame === page.mainFrame()) continue;
            try {
              const iframeVals = await extractFromFrame(frame, cs.selector);
              if (iframeVals.length > 0) { values = iframeVals; foundIn = `iframe(${frame.url()})`; break; }
            } catch { /* cross-origin */ }
          }
        }
        customResults.push({ name: cs.name, selector: cs.selector, values });
      }
    }

    await browser.close();

    const duration = Date.now() - startTime;
    const id = randomUUID();
    const scrapedAt = new Date().toISOString();
    const itemCount =
      headings.length + links.length + paragraphs.length + images.length + metaTags.length +
      customResults.reduce((s, r) => s + r.values.length, 0);

    history.unshift({ id, url, title, scrapedAt, duration, itemCount, capturedVars: vars, customResults });
    if (history.length > 50) history.pop();

    return { id, url, title, scrapedAt, duration, headings, links, paragraphs, images, metaTags, customResults, clickedElement, capturedVars: vars };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

// ─── POST /scrape  (regular, waits for full result) ──────────────────────────

router.post("/scrape", async (req, res) => {
  const parsed = ScrapeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "bad_request", message: "Invalid request body" });
    return;
  }
  try {
    const result = await runScrapeSession(parsed.data.url, parsed.data.options, () => {});
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: "scrape_failed", message });
  }
});

// ─── GET /scrape/watch/:id  (SSE screenshot stream during execution) ──────────

router.get("/scrape/watch/:id", async (req, res) => {
  // Wait up to 8s for the session to be registered (browser startup lag)
  const id = req.params.id;
  const deadline = Date.now() + 8000;
  while (!watchSessions.has(id) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!watchSessions.has(id)) return res.status(404).json({ error: "Watch session not found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let alive = true;
  const send = (obj: object) => {
    if (!alive) return;
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { alive = false; }
  };

  const loop = setInterval(async () => {
    const session = watchSessions.get(id);
    if (!session) { alive = false; clearInterval(loop); send({ type: "done" }); return; }
    const page = session.page;
    if (!page) return; // browser still starting up
    try {
      const shot = await page.screenshot({ type: "jpeg", quality: 70 });
      send({ type: "screenshot", data: shot.toString("base64"), url: page.url() });
    } catch { /* page navigating or closed */ }
  }, 300);

  req.on("close", () => { alive = false; clearInterval(loop); });
});

// ─── POST /scrape/stream  (NDJSON streaming, real-time step events) ───────────

router.post("/scrape/stream", async (req, res) => {
  const parsed = ScrapeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "bad_request", message: "Invalid request body" });
    return;
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  let lastWriteAt = Date.now();
  const write = (event: StreamEvent) => {
    try { res.write(JSON.stringify(event) + "\n"); lastWriteAt = Date.now(); } catch { /* client disconnected */ }
  };

  // Keepalive: send a comment line every 8 s during long steps to prevent proxy idle-timeout
  const keepalive = setInterval(() => {
    if (Date.now() - lastWriteAt > 8000) {
      try { res.write(": ping\n"); lastWriteAt = Date.now(); } catch { /* closed */ }
    }
  }, 8000);

  // Register watch session slot so the SSE stream can start connecting immediately
  const watchId = randomUUID();
  watchSessions.set(watchId, { page: null });
  write({ t: "watch_ready", watchId });

  try {
    const result = await runScrapeSession(parsed.data.url, parsed.data.options, write, watchId, parsed.data.proxy, parsed.data.headed);
    write({ t: "result", ...result });
  } catch (err) {
    write({ t: "error", message: err instanceof Error ? err.message : "Unknown error" });
  } finally {
    clearInterval(keepalive);
    watchSessions.delete(watchId);
  }
  res.end();
});

// ─── POST /parallel/stream  (run multiple tracks simultaneously) ──────────────

const ParallelTrackSchema = z.object({
  url: z.string().url(),
  options: ScrapeOptionsSchema,
  proxy: z.string().optional(),
  headed: z.boolean().optional(),
  label: z.string().optional(),
});

router.post("/parallel/stream", async (req, res) => {
  const schema = z.object({
    tracks: z.array(ParallelTrackSchema).min(2).max(6),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "bad_request", message: "Invalid request body" });
    return;
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const write = (obj: object) => {
    try { res.write(JSON.stringify(obj) + "\n"); } catch { /* client disconnected */ }
  };

  const keepalive = setInterval(() => {
    try { res.write(": ping\n"); } catch { /* closed */ }
  }, 8000);

  // Pre-register a watch slot per track so the screenshot SSE can start immediately
  const watchIds = parsed.data.tracks.map(() => {
    const wid = randomUUID();
    watchSessions.set(wid, { page: null });
    return wid;
  });
  watchIds.forEach((wid, idx) => write({ track: idx, t: "watch_ready", watchId: wid }));

  await Promise.all(
    parsed.data.tracks.map(async (track, idx) => {
      try {
        const result = await runScrapeSession(
          track.url,
          track.options,
          (event) => write({ track: idx, ...event }),
          watchIds[idx],
          track.proxy,
          track.headed,
        );
        write({ track: idx, t: "result", ...result });
      } catch (err) {
        write({ track: idx, t: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        watchSessions.delete(watchIds[idx]);
      }
    })
  );

  clearInterval(keepalive);
  write({ t: "all_done" });
  res.end();
});

// ─── GET /scrape/history ──────────────────────────────────────────────────────

router.get("/scrape/history", (_req, res) => {
  res.json(history);
});

export default router;
