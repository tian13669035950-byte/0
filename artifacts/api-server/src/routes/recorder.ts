import { Router } from "express";
import { randomUUID } from "crypto";
import { launchStealthBrowser, newStealthContext } from "../lib/stealth-browser";
import { humanClick, humanRightClick, humanDoubleClick, humanType } from "../lib/human-actions";

const router = Router();

const VIEWPORT = { width: 1280, height: 800 };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecordedStep {
  type: string;
  selector?: string;
  url?: string;
  text?: string;
  key?: string;
  value?: string;
  waitMs?: number;
  tabIndex?: number;
  listenFor?: string;
  listenTimeout?: number;
  varName?: string;
  incognito?: boolean;
  label?: string;
  navigatedTo?: string;
}

interface RecorderSession {
  browser: import("playwright-core").Browser;
  page: import("playwright-core").Page;
  tabs: import("playwright-core").Page[];
  lastActivity: number;
  steps: RecordedStep[];
  currentUrl: string;
  vars: Record<string, string>;  // captured variables, e.g. { price: "¥128" }
}

// ─── Session registry ─────────────────────────────────────────────────────────

const sessions = new Map<string, RecorderSession>();

setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [id, s] of sessions) {
    if (s.lastActivity < cutoff) {
      s.browser.close().catch(() => {});
      sessions.delete(id);
    }
  }
}, 60_000);

// ─── POST /api/record/session/start ──────────────────────────────────────────
// Parse "http://user:pass@host:port" → Playwright proxy config
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

router.post("/record/session/start", async (req, res) => {
  let { url, proxy: proxyRaw, headed } = req.body as { url?: string; proxy?: string; headed?: boolean };
  if (!url?.trim()) return res.status(400).json({ error: "Missing url" });
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  const proxy = parseProxy(proxyRaw);

  try {
    const browser = await launchStealthBrowser(headed ?? false);
    const ctx = await newStealthContext(browser, { viewport: VIEWPORT, ...(proxy ? { proxy } : {}) });
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
      tabs: [page],
      lastActivity: Date.now(),
      steps: [],
      currentUrl: page.url(),
      vars: {},
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
  let lastHash = "";
  let loopTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSentAt = Date.now();

  const send = (obj: object) => {
    if (!alive) return;
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); lastSentAt = Date.now(); } catch { alive = false; }
  };

  // Send an SSE comment every 8 s when page is unchanged — keeps Replit proxy from closing idle connections
  const keepaliveTimer = setInterval(() => {
    if (!alive) { clearInterval(keepaliveTimer); return; }
    if (Date.now() - lastSentAt > 8000) {
      try { res.write(": ping\n\n"); lastSentAt = Date.now(); } catch { alive = false; }
    }
  }, 8000);

  // Recursive loop: wait for screenshot to finish, then schedule next frame.
  // This avoids concurrent screenshots piling up when the page is slow.
  const scheduleLoop = () => {
    if (!alive) return;
    loopTimer = setTimeout(loop, 80); // 80ms gap between frames
  };

  const loop = async () => {
    if (!alive) return;
    session.lastActivity = Date.now();
    try {
      const shot = await session.page.screenshot({ type: "jpeg", quality: 55, timeout: 4000 });

      // Skip sending if the page is visually identical to the last frame
      const hash = shot.length + "-" + shot[0] + shot[shot.length >> 1] + shot[shot.length - 1];
      const changed = hash !== lastHash;
      lastHash = hash;

      const url = session.page.url();
      if (url !== session.currentUrl) {
        session.currentUrl = url;
        send({ type: "navigated", url });
      }
      if (changed) {
        send({ type: "screenshot", data: shot.toString("base64"), url });
      }
    } catch {
      // Page may be navigating — skip this frame and try again
    }
    scheduleLoop();
  };

  // Send first frame immediately, then start loop
  try {
    const shot = await session.page.screenshot({ type: "jpeg", quality: 55, timeout: 4000 });
    lastHash = shot.length + "-" + shot[0] + shot[shot.length >> 1] + shot[shot.length - 1];
    send({ type: "screenshot", data: shot.toString("base64"), url: session.page.url() });
  } catch {}
  scheduleLoop();

  req.on("close", () => {
    alive = false;
    clearInterval(keepaliveTimer);
    if (loopTimer) clearTimeout(loopTimer);
  });
});

// ─── CSS selector / label helpers (run inside page context) ──────────────────

const GET_SELECTOR = `(el) => {
  if (!el || el.nodeType !== 1) return '';
  if (el === document.body) return 'body';

  // ── Strategy 1: stable ID (not a React Aria / Radix / long-number ID) ─────
  const isStableId = (id) =>
    id && !/react-aria|radix-|\\d{4,}|:\\w*:/.test(id) && /^[a-zA-Z][\\w-]*$/.test(id);

  if (isStableId(el.id)) return '#' + CSS.escape(el.id);

  // ── Strategy 2: unique stable attribute on the element itself ─────────────
  const stableAttr = (e) => {
    if (e.getAttribute('data-testid')) return '[data-testid=' + JSON.stringify(e.getAttribute('data-testid')) + ']';
    if (e.getAttribute('aria-label'))  return '[aria-label='  + JSON.stringify(e.getAttribute('aria-label'))  + ']';
    if (e.getAttribute('name'))        return '[name='        + JSON.stringify(e.getAttribute('name'))        + ']';
    if (e.getAttribute('placeholder')) return '[placeholder=' + JSON.stringify(e.getAttribute('placeholder')) + ']';
    if (e.getAttribute('role') && e.getAttribute('aria-label'))
      return '[role=' + JSON.stringify(e.getAttribute('role')) + '][aria-label=' + JSON.stringify(e.getAttribute('aria-label')) + ']';
    return null;
  };

  const direct = stableAttr(el);
  if (direct) {
    // Verify it uniquely identifies the element
    try { if (document.querySelectorAll(direct).length === 1) return direct; } catch {}
  }

  // ── Strategy 3: walk up the DOM, prefer stable anchors ────────────────────
  const parts = [];
  let cur = el;
  for (let d = 0; d < 8; d++) {
    if (!cur || cur === document.documentElement) break;

    // If this ancestor has a stable ID, use it as an anchor
    if (isStableId(cur.id)) {
      parts.unshift('#' + CSS.escape(cur.id));
      break;
    }

    // Try a stable attribute as an anchor
    const anchor = stableAttr(cur);
    if (anchor) {
      try {
        if (document.querySelectorAll(anchor).length === 1) {
          parts.unshift(anchor);
          break;
        }
      } catch {}
    }

    // Fall back to tag + nth-of-type
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

// ─── POST /api/record/session/:id/screenshot  (force immediate screenshot)
router.post("/record/session/:id/screenshot", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  session.lastActivity = Date.now();
  try {
    const shot = await session.page.screenshot({ type: "jpeg", quality: 55, timeout: 4000 });
    res.json({ data: shot.toString("base64"), url: session.page.url() });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/record/session/:id/detect  (detect element at coords, NO action)
router.post("/record/session/:id/detect", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  session.lastActivity = Date.now();

  const { x, y } = req.body as { x: number; y: number };
  const page = session.page;
  const px = Math.round(x * VIEWPORT.width);
  const py = Math.round(y * VIEWPORT.height);

  try {
    const info = await page.evaluate(
      ({ selectorFn, labelFn, px, py }) => {
        const el = document.elementFromPoint(px, py) as Element | null;
        if (!el) return null;
        const getSelector = new Function("el", `return (${selectorFn})(el);`) as (el: Element) => string;
        const getLabel    = new Function("el", `return (${labelFn})(el);`)    as (el: Element) => string;
        return { selector: getSelector(el), label: getLabel(el) };
      },
      { selectorFn: GET_SELECTOR, labelFn: GET_LABEL, px, py }
    );
    res.json({ selector: info?.selector ?? "", label: info?.label ?? "" });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/record/session/:id/click  (click at coords, auto-detect selector)
router.post("/record/session/:id/click", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  session.lastActivity = Date.now();

  const { action = "click", x, y } = req.body as {
    action?: "click" | "doubleclick" | "rightclick" | "hover";
    x: number; // normalized 0-1
    y: number;
  };

  const page = session.page;
  const px = Math.round(x * VIEWPORT.width);
  const py = Math.round(y * VIEWPORT.height);

  try {
    // Get element info BEFORE acting
    const info = await page.evaluate(
      ({ selectorFn, labelFn, px, py }) => {
        const el = document.elementFromPoint(px, py) as Element | null;
        if (!el) return null;
        const getSelector = new Function("el", `return (${selectorFn})(el);`) as (el: Element) => string;
        const getLabel    = new Function("el", `return (${labelFn})(el);`)    as (el: Element) => string;
        return { selector: getSelector(el), label: getLabel(el) };
      },
      { selectorFn: GET_SELECTOR, labelFn: GET_LABEL, px, py }
    );

    const prevUrl = page.url();

    switch (action) {
      case "doubleclick": await page.mouse.dblclick(px, py); break;
      case "rightclick":  await page.mouse.click(px, py, { button: "right" }); break;
      case "hover":       await page.mouse.move(px, py); break;
      default:            await page.mouse.click(px, py);
    }

    await page.waitForTimeout(400);
    const newUrl = page.url();
    if (newUrl !== session.currentUrl) session.currentUrl = newUrl;

    const step: RecordedStep = {
      type: action,
      selector: info?.selector ?? "",
      label: info?.label ?? "",
      ...(newUrl !== prevUrl ? { navigatedTo: newUrl } : {}),
    };
    session.steps.push(step);
    res.json({ step, url: newUrl, tabCount: session.tabs.length });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/record/session/:id/step  (execute + record a step) ─────────────
router.post("/record/session/:id/step", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  session.lastActivity = Date.now();

  const step = req.body as RecordedStep;
  let page = session.page;
  let ok = true;

  // Resolve ${varName} placeholders using captured variables
  const rv = (s: string) => s.replace(/\$\{([^}]+)\}/g, (_, n) => session.vars[n.trim()] ?? "");

  try {
    switch (step.type) {
      case "click":
        await page.waitForSelector(step.selector!, { timeout: 8000 });
        await humanClick(page, step.selector!);
        await page.waitForTimeout(step.waitMs ?? 1000);
        break;

      case "doubleclick":
        await page.waitForSelector(step.selector!, { timeout: 8000 });
        await humanDoubleClick(page, step.selector!);
        await page.waitForTimeout(step.waitMs ?? 500);
        break;

      case "rightclick":
        await page.waitForSelector(step.selector!, { timeout: 8000 });
        await humanRightClick(page, step.selector!);
        await page.waitForTimeout(step.waitMs ?? 500);
        break;

      case "type":
        await page.waitForSelector(step.selector!, { timeout: 8000 });
        await humanType(page, step.selector!, rv(step.text ?? ""));
        await page.waitForTimeout(step.waitMs ?? 300);
        break;

      case "key":
        await page.keyboard.press(step.key ?? "Enter");
        await page.waitForTimeout(step.waitMs ?? 300);
        break;

      case "select":
        await page.waitForSelector(step.selector!, { timeout: 8000 });
        await page.selectOption(step.selector!, rv(step.value ?? ""));
        await page.waitForTimeout(step.waitMs ?? 300);
        break;

      case "scroll":
        if (step.selector?.trim()) {
          const el = await page.$(step.selector);
          if (el) await el.scrollIntoViewIfNeeded();
          else await page.mouse.wheel(0, step.waitMs ?? 300);
        } else {
          await page.mouse.wheel(0, step.waitMs ?? 300);
        }
        break;

      case "hover":
        await page.waitForSelector(step.selector!, { timeout: 8000 });
        await page.hover(step.selector!);
        await page.waitForTimeout(step.waitMs ?? 300);
        break;

      case "navigate":
        await page.goto(rv(step.url!), { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(step.waitMs ?? 1500);
        break;

      case "goback":
        await page.goBack({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(step.waitMs ?? 1500);
        break;

      case "goforward":
        await page.goForward({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(step.waitMs ?? 1500);
        break;

      case "reload":
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(step.waitMs ?? 1500);
        break;

      case "wait":
        await page.waitForTimeout(step.waitMs ?? 1000);
        break;

      case "screenshot":
        await page.waitForTimeout(step.waitMs ?? 500);
        break;

      case "listen":
        if (step.listenFor === "networkIdle") {
          await page.waitForLoadState("networkidle", { timeout: step.listenTimeout ?? 15000 });
        } else if (step.selector?.trim()) {
          const state = step.listenFor === "disappear" ? "hidden" : "visible";
          await page.waitForSelector(step.selector, { state, timeout: step.listenTimeout ?? 15000 });
        }
        break;

      case "capture": {
        if (step.selector?.trim()) {
          const sel = step.selector.trim();
          let captured: string | null = await page.evaluate((s) => {
            const el = document.querySelector(s);
            if (!el) return null;
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
              return el.value?.trim() || "";
            return el.textContent?.trim() || "";
          }, sel);
          // Fallback: search iframes
          if (!captured) {
            for (const frame of page.frames()) {
              if (frame === page.mainFrame()) continue;
              try {
                const v = await frame.evaluate((s) => {
                  const el = document.querySelector(s);
                  if (!el) return null;
                  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
                    return el.value?.trim() || "";
                  return el.textContent?.trim() || "";
                }, sel);
                if (v) { captured = v; break; }
              } catch { /* cross-origin, skip */ }
            }
          }
          if (captured) {
            step.label = captured.slice(0, 80);
            if (step.varName?.trim()) {
              session.vars[step.varName.trim()] = captured;
            }
          }
        }
        break;
      }

      case "newtab": {
        const ctx = page.context();
        const newTab = await ctx.newPage();
        session.tabs.push(newTab);
        session.page = newTab;
        page = newTab;
        if (step.url?.trim()) {
          await newTab.goto(rv(step.url), { waitUntil: "domcontentloaded", timeout: 20000 });
        }
        await newTab.waitForTimeout(step.waitMs ?? 1500);
        break;
      }

      case "switchtab": {
        const idx = step.tabIndex ?? 0;
        if (idx >= 0 && idx < session.tabs.length && !session.tabs[idx].isClosed()) {
          session.page = session.tabs[idx];
          page = session.page;
          await page.bringToFront();
          await page.waitForTimeout(step.waitMs ?? 500);
        } else {
          ok = false;
        }
        break;
      }

      case "closetab": {
        const closedPage = session.page;
        const prevIdx = Math.max(0, session.tabs.indexOf(closedPage) - 1);
        session.tabs.splice(session.tabs.indexOf(closedPage), 1);
        await closedPage.close();
        if (session.tabs.length > 0) {
          session.page = session.tabs[prevIdx] ?? session.tabs[session.tabs.length - 1];
          page = session.page;
          await page.bringToFront();
        }
        await page.waitForTimeout(step.waitMs ?? 500);
        break;
      }

      default:
        ok = false;
    }
  } catch (err) {
    ok = false;
  }

  const newUrl = session.page.url();
  if (newUrl !== session.currentUrl) {
    step.navigatedTo = newUrl;
    session.currentUrl = newUrl;
  }

  session.steps.push(step);
  res.json({ ok, step, url: newUrl, tabCount: session.tabs.length, vars: session.vars });
});

// ─── GET /api/record/session/:id/text  (copy visible text) ──────────────────
router.get("/record/session/:id/text", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  try {
    const text = await session.page.evaluate(() =>
      (document.body.innerText || "").replace(/\s{3,}/g, "\n\n").trim()
    );
    res.json({ text });
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
