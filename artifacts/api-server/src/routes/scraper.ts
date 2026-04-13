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
  type: z.enum(["click", "wait"]),
  selector: z.string().optional(),
  waitMs: z.number().optional(),
  waitForPopupClose: z.boolean().optional(),
  popupTimeoutMs: z.number().optional(),
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

    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);

    let clickedElement: string | undefined;

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
      if (step.type === "wait") {
        const ms = step.waitMs ?? 1000;
        req.log.info({ ms }, "Executing wait step");
        await page.waitForTimeout(ms);
      } else if (step.type === "click" && step.selector?.trim()) {
        const selector = step.selector.trim();
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          if (step.waitForPopupClose) {
            const popupTimeout = step.popupTimeoutMs ?? 30000;
            const popupPromise = page.context().waitForEvent("page", { timeout: popupTimeout });
            await page.click(selector);
            clickedElement = selector;
            req.log.info({ selector }, "Clicked element, waiting for popup");
            try {
              const popup = await popupPromise;
              req.log.info({ url: popup.url() }, "Popup detected, waiting for close");
              await popup.waitForEvent("close", { timeout: popupTimeout });
              req.log.info("Popup closed");
            } catch {
              req.log.warn("Popup timed out, using fixed wait");
            }
          } else {
            await page.click(selector);
            clickedElement = selector;
            req.log.info({ selector }, "Clicked element");
          }
          const waitMs = step.waitMs ?? 2000;
          await page.waitForTimeout(waitMs);
        } catch {
          req.log.warn({ selector }, "Click step failed: element not found");
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
