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

export const loadItems = (): CollectedItem[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
};

const save = (items: CollectedItem[]) => localStorage.setItem(KEY, JSON.stringify(items));

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

export const clearStore = () => localStorage.removeItem(KEY);

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
