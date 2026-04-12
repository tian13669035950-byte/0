import { Router } from "express";
import { chromium } from "playwright-core";
import { randomUUID } from "crypto";
import { z } from "zod";

const router = Router();

const ScrapeOptionsSchema = z.object({
  headings: z.boolean(),
  links: z.boolean(),
  paragraphs: z.boolean(),
  images: z.boolean(),
  metaTags: z.boolean(),
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

    await browser.close();

    const duration = Date.now() - startTime;
    const id = randomUUID();
    const scrapedAt = new Date().toISOString();

    const itemCount =
      headings.length + links.length + paragraphs.length + images.length + metaTags.length;

    history.unshift({ id, url, title, scrapedAt, duration, itemCount });
    if (history.length > 50) history.pop();

    res.json({ id, url, title, scrapedAt, duration, headings, links, paragraphs, images, metaTags });
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
