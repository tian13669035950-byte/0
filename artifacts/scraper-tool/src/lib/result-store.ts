import type { ScrapeResult } from "@workspace/api-client-react/src/generated/api.schemas";

export interface CollectedItem {
  id: string;
  source: "single" | "parallel";
  trackLabel?: string;
  url: string;
  title: string;
  scrapedAt: string;
  duration: number;
  capturedVars: Record<string, string>;
  customResults: Array<{ name: string; selector: string; values: string[] }>;
  headings: Array<{ level: string; text: string }>;
  paragraphs: string[];
  links: Array<{ text: string; href: string }>;
  note: string;
}

const KEY = "scraper-collected-v1";
const BACKUP_API = "/api/store/backup";

export const loadItems = (): CollectedItem[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
};

// Write to localStorage then fire-and-forget sync to backend file
const save = (items: CollectedItem[]) => {
  localStorage.setItem(KEY, JSON.stringify(items));
  syncToBackend(items).catch(() => {});
};

// ── Backend file sync ─────────────────────────────────────────────────────────

export const syncToBackend = async (items?: CollectedItem[]): Promise<void> => {
  try {
    await fetch(BACKUP_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items ?? loadItems()),
    });
  } catch { /* backend unreachable — silent */ }
};

// On startup: load from backend file, merge with whatever is in localStorage
// (items already in localStorage take precedence; new items from file are appended)
export const syncFromBackend = async (): Promise<void> => {
  try {
    const resp = await fetch(BACKUP_API);
    if (!resp.ok) return;
    const fileItems: CollectedItem[] = await resp.json();
    if (!Array.isArray(fileItems) || fileItems.length === 0) return;

    const local = loadItems();
    const localIds = new Set(local.map(i => i.id));
    const merged = [...local];
    for (const item of fileItems) {
      if (!localIds.has(item.id)) merged.push(item);
    }
    merged.sort((a, b) => new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime());
    localStorage.setItem(KEY, JSON.stringify(merged));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
  } catch { /* backend unreachable — silent */ }
};

// ── CRUD ──────────────────────────────────────────────────────────────────────

export const addItemToStore = (item: Omit<CollectedItem, "id" | "note">): CollectedItem => {
  const full: CollectedItem = {
    ...item,
    id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    note: "",
  };
  save([full, ...loadItems()]);
  return full;
};

export const addRawItemToStore = (item: CollectedItem): void => save([item, ...loadItems()]);

export const deleteItemFromStore = (id: string) => save(loadItems().filter(i => i.id !== id));

export const updateItemInStore = (id: string, patch: Partial<Pick<CollectedItem, "note" | "capturedVars">>) =>
  save(loadItems().map(i => i.id === id ? { ...i, ...patch } : i));

export const clearStore = () => {
  localStorage.removeItem(KEY);
  syncToBackend([]).catch(() => {});
};

export const fromScrapeResult = (
  result: ScrapeResult,
  source: "single" | "parallel",
  trackLabel?: string,
): Omit<CollectedItem, "id" | "note"> => ({
  source,
  trackLabel,
  url: (result.url as string) ?? "",
  title: (result.title as string) ?? "",
  scrapedAt: (result.scrapedAt as string) ?? new Date().toISOString(),
  duration: (result.duration as number) ?? 0,
  capturedVars: (result.capturedVars as Record<string, string>) ?? {},
  customResults: (result.customResults as Array<{ name: string; selector: string; values: string[] }>) ?? [],
  headings: (result.headings as Array<{ level: string; text: string }>) ?? [],
  paragraphs: (result.paragraphs as string[]) ?? [],
  links: (result.links as Array<{ text: string; href: string }>) ?? [],
});
