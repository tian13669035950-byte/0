import { Router } from "express";
import { chromium } from "playwright-core";
import { randomUUID } from "crypto";
import { z } from "zod";

const router = Router();

const CustomSelectorSchema = z.object({
  name: z.string(),
  selector: z.string(),
});

const ScrapeStepSchema = z.object({
  type: z.enum(["click", "listen", "type", "key", "select", "scroll", "hover", "navigate", "capture"]),
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
});

interface ScrapeHistoryItem {
  id: string;
  url: string;
  title: string;
  scrapedAt: string;
  duration: number;
  itemCount: number;
}

const history: ScrapeHistoryItem[] = [];

router.post("/scrape", async (req, res) => {
  const parsed = ScrapeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "bad_request", message: "Invalid request body" });
    return;
  }

  const { url, options } = parsed.data;
  const startTime = Date.now();
  let browser;

  try {
    const executablePath = process.env.CHROMIUM_PATH ||
      "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    // Helper: open a fresh browser context (optionally incognito = new isolated context)
    const newContext = () => browser!.newContext({ userAgent: UA });

    let ctx = await newContext();
    let page = await ctx.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);

    let clickedElement: string | undefined;
    // Captured variables: populated by "capture" steps, consumed by "type" steps via ${varName}
    const vars: Record<string, string> = {};

    // Resolve ${varName} placeholders in a string
    const resolveVars = (str: string): string =>
      str.replace(/\$\{([^}]+)\}/g, (_, name) => vars[name.trim()] ?? "");

    // Build the effective step list: prefer `steps` array; fall back to legacy clickSelector
    const effectiveSteps = options.steps && options.steps.length > 0
      ? options.steps
      : options.clickSelector && options.clickSelector.trim()
        ? [{
            type: "click" as const,
            selector: options.clickSelector.trim(),
            waitMs: options.clickWaitMs ?? 2000,
            waitForPopupClose: options.waitForPopupClose,
            popupTimeoutMs: options.popupTimeoutMs,
          }]
        : [];

    for (const step of effectiveSteps) {
      req.log.info({ type: step.type }, "Executing step");

      if (step.type === "listen") {
        const timeout = step.listenTimeout ?? 15000;
        const condition = step.listenFor ?? "appear";
        try {
          if (condition === "networkIdle") {
            await page.waitForLoadState("networkidle", { timeout });
          } else if (step.selector?.trim()) {
            const sel = step.selector.trim();
            if (condition === "appear") {
              await page.waitForSelector(sel, { state: "visible", timeout });
            } else if (condition === "disappear") {
              await page.waitForSelector(sel, { state: "hidden", timeout });
            }
          }
          req.log.info({ condition, selector: step.selector }, "Listen condition met");
        } catch {
          req.log.warn({ condition, selector: step.selector }, "Listen timed out, continuing");
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
              req.log.info({ url: popup.url() }, "Popup detected, waiting for close");
              await popup.waitForEvent("close", { timeout: popupTimeout });
              req.log.info("Popup closed");
            } catch {
              req.log.warn("Popup wait timed out");
            }
          } else {
            await page.click(selector);
            clickedElement = selector;
          }
          if (step.waitMs) await page.waitForTimeout(step.waitMs);
        } catch {
          req.log.warn({ selector }, "Click step: element not found");
        }

      } else if (step.type === "navigate" && step.url?.trim()) {
        const targetUrl = resolveVars(step.url.trim());
        const useIncognito = step.incognito !== false; // default true
        req.log.info({ url: targetUrl, incognito: useIncognito }, "Navigating to new URL");
        if (useIncognito) {
          // Close current context and open a brand-new isolated one (no cookies/storage from before)
          await ctx.close();
          ctx = await newContext();
          page = await ctx.newPage();
        }
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(step.waitMs ?? 1500);

      } else if (step.type === "capture" && step.selector?.trim() && step.varName?.trim()) {
        const selector = step.selector.trim();
        const varName = step.varName.trim();
        try {
          // Check main page first, then iframes
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
            req.log.info({ selector, varName, value: captured }, "Captured variable");
          } else {
            req.log.warn({ selector, varName }, "Capture: element not found");
          }
          if (step.waitMs) await page.waitForTimeout(step.waitMs);
        } catch {
          req.log.warn({ selector }, "Capture step failed");
        }

      } else if (step.type === "type" && step.selector?.trim() && step.text) {
        const selector = step.selector.trim();
        const resolvedText = resolveVars(step.text);
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          await page.fill(selector, resolvedText);
          req.log.info({ selector, text: resolvedText }, "Typed text");
          if (step.waitMs) await page.waitForTimeout(step.waitMs);
        } catch {
          req.log.warn({ selector }, "Type step: element not found");
        }

      } else if (step.type === "key" && step.key) {
        await page.keyboard.press(step.key);
        req.log.info({ key: step.key }, "Pressed key");
        if (step.waitMs) await page.waitForTimeout(step.waitMs);

      } else if (step.type === "select" && step.selector?.trim() && step.value) {
        const selector = step.selector.trim();
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          await page.selectOption(selector, { label: step.value }).catch(() =>
            page.selectOption(selector, { value: step.value! })
          );
          req.log.info({ selector, value: step.value }, "Selected option");
          if (step.waitMs) await page.waitForTimeout(step.waitMs);
        } catch {
          req.log.warn({ selector }, "Select step: element not found");
        }

      } else if (step.type === "scroll") {
        if (step.selector?.trim()) {
          try {
            const el = page.locator(step.selector.trim()).first();
            await el.scrollIntoViewIfNeeded();
            req.log.info({ selector: step.selector }, "Scrolled to element");
          } catch {
            req.log.warn({ selector: step.selector }, "Scroll: element not found");
          }
        } else {
          await page.mouse.wheel(0, step.waitMs ?? 300);
          req.log.info("Scrolled page");
        }
        if (step.waitMs) await page.waitForTimeout(step.waitMs);

      } else if (step.type === "hover" && step.selector?.trim()) {
        const selector = step.selector.trim();
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          await page.hover(selector);
          req.log.info({ selector }, "Hovered");
          if (step.waitMs) await page.waitForTimeout(step.waitMs);
        } catch {
          req.log.warn({ selector }, "Hover: element not found");
        }
      }
    }

    const title = await page.title();

    const headings = options.headings
      ? await page.evaluate(() => {
          const els = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
          return Array.from(els)
            .map((el) => ({ level: el.tagName.toLowerCase(), text: el.textContent?.trim() || "" }))
            .filter((h) => h.text.length > 0)
            .slice(0, 50);
        })
      : [];

    const links = options.links
      ? await page.evaluate(() => {
          const els = document.querySelectorAll("a[href]");
          return Array.from(els)
            .map((el) => ({
              text: el.textContent?.trim() || "",
              href: (el as HTMLAnchorElement).href || "",
            }))
            .filter((l) => l.text.length > 0 && l.href.startsWith("http"))
            .slice(0, 50);
        })
      : [];

    const paragraphs = options.paragraphs
      ? await page.evaluate(() => {
          const els = document.querySelectorAll("p");
          return Array.from(els)
            .map((el) => el.textContent?.trim() || "")
            .filter((t) => t.length > 20)
            .slice(0, 30);
        })
      : [];

    const images = options.images
      ? await page.evaluate(() => {
          const els = document.querySelectorAll("img[src]");
          return Array.from(els)
            .map((el) => ({
              src: (el as HTMLImageElement).src || "",
              alt: (el as HTMLImageElement).alt || "",
            }))
            .filter((img) => img.src.startsWith("http"))
            .slice(0, 30);
        })
      : [];

    const metaTags = options.metaTags
      ? await page.evaluate(() => {
          const els = document.querySelectorAll("meta[name], meta[property]");
          return Array.from(els)
            .map((el) => ({
              name: el.getAttribute("name") || el.getAttribute("property") || "",
              content: el.getAttribute("content") || "",
            }))
            .filter((m) => m.name.length > 0 && m.content.length > 0)
            .slice(0, 30);
        })
      : [];

    // Helper: extract values from a frame (page or iframe)
    async function extractFromFrame(
      frame: import("playwright-core").Frame,
      selector: string
    ): Promise<string[]> {
      return frame.evaluate((sel) => {
        const els = document.querySelectorAll(sel);
        return Array.from(els)
          .map((el) => {
            // For inputs/selects/textareas return their value
            if (
              el instanceof HTMLInputElement ||
              el instanceof HTMLTextAreaElement ||
              el instanceof HTMLSelectElement
            ) {
              return el.value?.trim() || el.getAttribute("placeholder")?.trim() || "";
            }
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

        // 1. Try main page first
        let values = await extractFromFrame(page.mainFrame(), cs.selector);
        let foundIn = "main";

        // 2. If not found, search all iframes
        if (values.length === 0) {
          for (const frame of page.frames()) {
            if (frame === page.mainFrame()) continue;
            try {
              const iframeValues = await extractFromFrame(frame, cs.selector);
              if (iframeValues.length > 0) {
                values = iframeValues;
                foundIn = `iframe(${frame.url()})`;
                req.log.info({ selector: cs.selector, frame: frame.url() }, "Found selector inside iframe");
                break;
              }
            } catch {
              // iframe may be cross-origin, skip
            }
          }
        }

        customResults.push({ name: cs.name, selector: cs.selector, values });
        if (values.length === 0) {
          req.log.warn({ selector: cs.selector }, "Selector not found in main page or any iframe");
        } else {
          req.log.info({ selector: cs.selector, foundIn, count: values.length }, "Selector matched");
        }
      }
    }

    await browser.close();

    const duration = Date.now() - startTime;
    const id = randomUUID();
    const scrapedAt = new Date().toISOString();

    const itemCount =
      headings.length + links.length + paragraphs.length + images.length + metaTags.length +
      customResults.reduce((sum, r) => sum + r.values.length, 0);

    history.unshift({ id, url, title, scrapedAt, duration, itemCount });
    if (history.length > 50) history.pop();

    res.json({
      id, url, title, scrapedAt, duration,
      headings, links, paragraphs, images, metaTags,
      customResults,
      clickedElement,
      capturedVars: vars,
    });
  } catch (err: unknown) {
    if (browser) await browser.close().catch(() => {});
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "Scrape failed");
    res.status(500).json({ error: "scrape_failed", message });
  }
});

router.get("/scrape/history", (_req, res) => {
  res.json(history);
});

export default router;
