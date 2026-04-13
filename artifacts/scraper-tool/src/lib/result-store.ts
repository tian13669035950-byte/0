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
  category?: string; // undefined / "" = 未分类
}

const KEY = "scraper-collected-v1";
const CAT_KEY = "scraper-categories-v1";
const BACKUP_API = "/api/store/backup";

export const loadItems = (): CollectedItem[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
};

// Write to localStorage then fire-and-forget sync to backend file
const save = (items: CollectedItem[]) => {
  localStorage.setItem(KEY, JSON.stringify(items));
  syncToBackend(items).catch(() => {});
};

// ── Category management ────────────────────────────────────────────────────────

export const loadCategories = (): string[] => {
  try { return JSON.parse(localStorage.getItem(CAT_KEY) ?? "[]"); } catch { return []; }
};

const saveCats = (cats: string[]) => localStorage.setItem(CAT_KEY, JSON.stringify(cats));

export const addCategory = (name: string): void => {
  const cats = loadCategories();
  if (!cats.includes(name)) saveCats([...cats, name]);
};

export const renameCategory = (oldName: string, newName: string): void => {
  saveCats(loadCategories().map(c => c === oldName ? newName : c));
  save(loadItems().map(i => i.category === oldName ? { ...i, category: newName } : i));
};

export const deleteCategory = (name: string): void => {
  saveCats(loadCategories().filter(c => c !== name));
  // Remove category tag from items (they become uncategorized)
  save(loadItems().map(i => i.category === name ? { ...i, category: undefined } : i));
};

export const moveItemsToCategory = (ids: Set<string>, category: string): void => {
  const cat = category === "" ? undefined : category;
  save(loadItems().map(i => ids.has(i.id) ? { ...i, category: cat } : i));
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

export const updateItemInStore = (
  id: string,
  patch: Partial<Pick<CollectedItem, "note" | "capturedVars" | "category">>,
) => save(loadItems().map(i => i.id === id ? { ...i, ...patch } : i));

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
