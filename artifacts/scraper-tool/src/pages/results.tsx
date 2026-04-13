import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Trash2, Globe, Clock, ExternalLink, ChevronDown, ChevronUp,
  Search, Download, RotateCcw, Pencil, Check, X, Database,
  Crosshair, Link2, AlignLeft, Heading1, Upload, GitFork, Terminal,
} from "lucide-react";
import { format } from "date-fns";
import {
  loadItems, deleteItemFromStore, updateItemInStore, clearStore,
  addRawItemToStore, type CollectedItem,
} from "@/lib/result-store";

// ─── Editable text cell ───────────────────────────────────────────────────────
function EditableText({ value, onSave, multiline }: { value: string; onSave: (v: string) => void; multiline?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const confirm = () => { onSave(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };
  if (!editing) return (
    <span className="group flex items-start gap-1.5">
      <span className="break-all">{value || <span className="text-muted-foreground italic text-xs">（空）</span>}</span>
      <button type="button" onClick={() => { setDraft(value); setEditing(true); }} className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" title="编辑">
        <Pencil className="h-3 w-3 text-muted-foreground hover:text-primary" />
      </button>
    </span>
  );
  return (
    <span className="flex items-start gap-1.5 w-full">
      {multiline
        ? <Textarea value={draft} onChange={e => setDraft(e.target.value)} className="text-xs font-mono h-20 min-w-0 flex-1" autoFocus onKeyDown={e => { if (e.key === "Escape") cancel(); }} />
        : <Input value={draft} onChange={e => setDraft(e.target.value)} className="text-xs font-mono h-7 min-w-0 flex-1" autoFocus onKeyDown={e => { if (e.key === "Enter") confirm(); if (e.key === "Escape") cancel(); }} />}
      <button type="button" onClick={confirm} className="shrink-0 mt-0.5" title="保存"><Check className="h-4 w-4 text-emerald-500" /></button>
      <button type="button" onClick={cancel} className="shrink-0 mt-0.5" title="取消"><X className="h-4 w-4 text-destructive" /></button>
    </span>
  );
}

// ─── Item card ────────────────────────────────────────────────────────────────
function ItemCard({ item, onDelete, onUpdate }: { item: CollectedItem; onDelete: () => void; onUpdate: (p: Partial<Pick<CollectedItem, "note" | "capturedVars">>) => void }) {
  const [open, setOpen] = useState(false);
  const hasVars = Object.keys(item.capturedVars).length > 0;
  const hasCustom = item.customResults.some(r => r.values.length > 0);
  const hasHeadings = item.headings.length > 0;
  const hasParagraphs = item.paragraphs.length > 0;
  const hasLinks = item.links.length > 0;
  const hasContent = hasVars || hasCustom || hasHeadings || hasParagraphs || hasLinks || item.note;
  const varCount = Object.keys(item.capturedVars).length;
  const customCount = item.customResults.reduce((s, r) => s + r.values.length, 0);

  return (
    <Card className="border-border/60 shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => hasContent && setOpen(o => !o)}>
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="mt-1.5 h-2 w-2 rounded-full shrink-0 bg-primary/60" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-medium text-sm truncate max-w-[240px]">{item.title || "无标题"}</span>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${item.source === "parallel" ? "border-violet-300 text-violet-600" : "border-sky-300 text-sky-600"}`}>
                {item.source === "parallel" ? `并行${item.trackLabel ? ` · ${item.trackLabel}` : ""}` : "单独"}
              </Badge>
              {varCount > 0 && <Badge className="text-[10px] px-1.5 py-0 h-4 bg-teal-100 text-teal-700 border-teal-200">{varCount} 个变量</Badge>}
              {customCount > 0 && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{customCount} 条数据</Badge>}
              {item.note && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-300 text-amber-600">有备注</Badge>}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1 truncate max-w-[260px]">
                <Globe className="h-3 w-3 shrink-0" />
                <a href={item.url} target="_blank" rel="noreferrer" className="truncate hover:text-primary transition-colors" onClick={e => e.stopPropagation()}>{item.url}</a>
                <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
              </span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{format(new Date(item.scrapedAt), "MM-dd HH:mm:ss")}</span>
              <span className="font-mono">{item.duration}ms</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {hasContent && (open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />)}
          <button type="button" onClick={e => { e.stopPropagation(); onDelete(); }} className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors ml-1" title="删除"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {open && hasContent && (
        <CardContent className="px-4 pb-4 pt-0 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="space-y-3 ml-5">
            {/* Note */}
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600 mb-1.5"><Pencil className="h-3.5 w-3.5" />备注（可编辑）</div>
              <div className="text-sm px-2 py-1 rounded border bg-amber-50/50 border-amber-100">
                <EditableText value={item.note} multiline onSave={v => onUpdate({ note: v })} />
              </div>
            </div>
            {/* Captured vars */}
            {hasVars && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-teal-700 mb-1.5"><Crosshair className="h-3.5 w-3.5" />读取的变量（可编辑）</div>
                <div className="border border-teal-200 rounded-lg overflow-hidden divide-y divide-teal-100">
                  {Object.entries(item.capturedVars).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-3 px-3 py-2 bg-teal-50/50">
                      <code className="text-xs font-mono bg-white border border-teal-200 px-2 py-0.5 rounded text-teal-600 shrink-0">{k}</code>
                      <div className="flex-1 font-mono text-sm font-semibold text-teal-800 min-w-0">
                        <EditableText value={v} onSave={val => onUpdate({ capturedVars: { ...item.capturedVars, [k]: val } })} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Custom */}
            {hasCustom && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5"><Search className="h-3.5 w-3.5" />自定义数据</div>
                <div className="space-y-2">
                  {item.customResults.filter(r => r.values.length > 0).map((cr, ci) => (
                    <div key={ci} className="border rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b flex-wrap">
                        <span className="font-medium text-xs shrink-0">{cr.name}</span>
                        <code className="text-xs font-mono text-muted-foreground truncate max-w-full">{cr.selector}</code>
                      </div>
                      {cr.values.map((val, vi) => <div key={vi} className="px-3 py-2 font-mono text-sm border-b last:border-b-0 break-all">{val}</div>)}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Headings */}
            {hasHeadings && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5"><Heading1 className="h-3.5 w-3.5" />标题（{item.headings.length} 条）</div>
                <div className="border rounded-lg overflow-hidden divide-y">
                  {item.headings.slice(0, 20).map((h, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <Badge variant="outline" className="text-[10px] shrink-0 font-mono">{h.level}</Badge>
                      <span className="truncate">{h.text}</span>
                    </div>
                  ))}
                  {item.headings.length > 20 && <div className="px-3 py-1.5 text-xs text-muted-foreground">…还有 {item.headings.length - 20} 条</div>}
                </div>
              </div>
            )}
            {/* Paragraphs */}
            {hasParagraphs && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5"><AlignLeft className="h-3.5 w-3.5" />段落文本（{item.paragraphs.length} 条）</div>
                <div className="border rounded-lg overflow-hidden divide-y max-h-48 overflow-y-auto">
                  {item.paragraphs.slice(0, 30).map((p, i) => <div key={i} className="px-3 py-1.5 text-sm break-all">{p}</div>)}
                  {item.paragraphs.length > 30 && <div className="px-3 py-1.5 text-xs text-muted-foreground sticky bottom-0 bg-background">…还有 {item.paragraphs.length - 30} 条</div>}
                </div>
              </div>
            )}
            {/* Links */}
            {hasLinks && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5"><Link2 className="h-3.5 w-3.5" />链接（{item.links.length} 条）</div>
                <div className="border rounded-lg overflow-hidden divide-y max-h-40 overflow-y-auto">
                  {item.links.slice(0, 30).map((lk, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="shrink-0 text-muted-foreground truncate max-w-[100px]">{lk.text}</span>
                      <a href={lk.href} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate flex-1 font-mono">{lk.href}</a>
                    </div>
                  ))}
                  {item.links.length > 30 && <div className="px-3 py-1.5 text-xs text-muted-foreground sticky bottom-0 bg-background">…还有 {item.links.length - 30} 条</div>}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Track group (for parallel view) ─────────────────────────────────────────
function TrackGroup({ label, items, onDelete, onUpdate }: { label: string; items: CollectedItem[]; onDelete: (id: string) => void; onUpdate: (id: string, p: Partial<Pick<CollectedItem, "note" | "capturedVars">>) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" className="flex items-center gap-2 mb-2 w-full text-left group" onClick={() => setOpen(v => !v)}>
        <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs flex items-center justify-center font-bold shrink-0">{label.replace("轨道 ", "")}</span>
        <span className="text-sm font-semibold text-violet-700">{label}</span>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-violet-200 text-violet-600">{items.length} 条</Badge>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-violet-400 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 text-violet-400 ml-auto" />}
      </button>
      {open && (
        <div className="space-y-2 pl-8 mb-4">
          {items.map(item => (
            <ItemCard key={item.id} item={item} onDelete={() => onDelete(item.id)} onUpdate={p => onUpdate(item.id, p)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type SourceTab = "all" | "single" | "parallel";

export default function Results() {
  const [items, setItems] = useState<CollectedItem[]>(() => loadItems());
  const [query, setQuery] = useState("");
  const [sourceTab, setSourceTab] = useState<SourceTab>("all");
  const importRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => setItems(loadItems()), []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === "scraper-collected-v1") refresh(); };
    window.addEventListener("storage", onStorage);
    const iv = setInterval(refresh, 3000);
    return () => { window.removeEventListener("storage", onStorage); clearInterval(iv); };
  }, [refresh]);

  const handleDelete = (id: string) => { deleteItemFromStore(id); refresh(); };
  const handleUpdate = (id: string, patch: Partial<Pick<CollectedItem, "note" | "capturedVars">>) => { updateItemInStore(id, patch); refresh(); };
  const handleClear = () => {
    if (!window.confirm(`确定要清空全部 ${items.length} 条数据吗？此操作不可撤销。`)) return;
    clearStore(); refresh();
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `scraper-results-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const rows: string[][] = [["时间", "来源", "轨道", "URL", "标题", "耗时(ms)", "变量", "备注"]];
    for (const item of items) {
      rows.push([item.scrapedAt, item.source === "parallel" ? "并行" : "单独", item.trackLabel ?? "", item.url, item.title, String(item.duration), JSON.stringify(item.capturedVars), item.note]);
    }
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `scraper-results-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as CollectedItem[];
        if (!Array.isArray(data)) throw new Error();
        let added = 0;
        const existing = loadItems();
        const existingIds = new Set(existing.map(i => i.id));
        for (const item of data) {
          if (!existingIds.has(item.id)) { addRawItemToStore(item); added++; }
        }
        window.dispatchEvent(new StorageEvent("storage", { key: "scraper-collected-v1" }));
        refresh();
        alert(`导入成功，新增 ${added} 条（重复的已跳过）`);
      } catch { alert("导入失败，文件格式不正确"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── Filter & group ──────────────────────────────────────────────────────────
  const bySource = sourceTab === "all" ? items : items.filter(i => i.source === (sourceTab === "single" ? "single" : "parallel"));
  const filtered = query.trim()
    ? bySource.filter(i =>
        i.url.toLowerCase().includes(query.toLowerCase()) ||
        i.title.toLowerCase().includes(query.toLowerCase()) ||
        i.note.toLowerCase().includes(query.toLowerCase()) ||
        Object.values(i.capturedVars).some(v => v.toLowerCase().includes(query.toLowerCase()))
      )
    : bySource;

  const singleCount = items.filter(i => i.source === "single").length;
  const parallelCount = items.filter(i => i.source === "parallel").length;

  // Group parallel items by track label
  const parallelGroups: Record<string, CollectedItem[]> = {};
  if (sourceTab === "parallel") {
    for (const item of filtered) {
      const key = item.trackLabel ?? "未知轨道";
      if (!parallelGroups[key]) parallelGroups[key] = [];
      parallelGroups[key].push(item);
    }
  }

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-4xl">
      {/* Title */}
      <div className="mb-4 space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">数据汇总</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">单独抓取与并行抓取的所有结果，支持分类查看、编辑变量和备注、导入导出。</p>
      </div>

      {/* Source tabs */}
      <Tabs value={sourceTab} onValueChange={v => setSourceTab(v as SourceTab)} className="mb-4">
        <TabsList className="h-8">
          <TabsTrigger value="all" className="text-xs h-7 gap-1.5">
            <Database className="h-3.5 w-3.5" />全部
            <span className="ml-0.5 text-muted-foreground">({items.length})</span>
          </TabsTrigger>
          <TabsTrigger value="single" className="text-xs h-7 gap-1.5">
            <Terminal className="h-3.5 w-3.5" />单独抓取
            <span className="ml-0.5 text-muted-foreground">({singleCount})</span>
          </TabsTrigger>
          <TabsTrigger value="parallel" className="text-xs h-7 gap-1.5">
            <GitFork className="h-3.5 w-3.5" />并行执行
            <span className="ml-0.5 text-muted-foreground">({parallelCount})</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Search + actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-4">
        <div className="relative flex-1 w-full sm:w-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="搜索 URL、标题、变量、备注…" value={query} onChange={e => setQuery(e.target.value)} className="pl-8 h-8 text-sm" />
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleExportCsv} disabled={items.length === 0}>
            <Download className="h-3.5 w-3.5" />CSV
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleExportJson} disabled={items.length === 0}>
            <Download className="h-3.5 w-3.5" />JSON
          </Button>
          <label className="cursor-pointer">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 pointer-events-none" asChild>
              <span><Upload className="h-3.5 w-3.5" />导入</span>
            </Button>
            <input type="file" accept=".json" className="hidden" ref={importRef} onChange={handleImport} />
          </label>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive" onClick={handleClear} disabled={items.length === 0}>
            <RotateCcw className="h-3.5 w-3.5" />清空
          </Button>
        </div>
      </div>

      {/* Content */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground border-2 border-dashed rounded-xl">
          <Database className="h-12 w-12 mb-4 opacity-20" />
          <h3 className="text-lg font-medium text-foreground mb-1">还没有数据</h3>
          <p className="text-sm">去抓取面板或并行执行页执行任务，结果会自动汇总到这里</p>
          <p className="text-xs mt-2 opacity-60">也可以点「导入」按钮从文件恢复数据</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Search className="h-8 w-8 mb-3 opacity-30" />
          <p className="text-sm">没有匹配"{query}"的结果</p>
        </div>
      ) : sourceTab === "parallel" ? (
        // Grouped by track label
        <div>
          {Object.entries(parallelGroups).map(([label, groupItems]) => (
            <TrackGroup key={label} label={label} items={groupItems} onDelete={handleDelete} onUpdate={handleUpdate} />
          ))}
        </div>
      ) : (
        // Flat list (all / single)
        <div className="space-y-2">
          {sourceTab === "all" && singleCount > 0 && parallelCount > 0 && (
            // Show section separators in "all" view
            (() => {
              const singleItems = filtered.filter(i => i.source === "single");
              const parallelItems = filtered.filter(i => i.source === "parallel");
              return (
                <>
                  {singleItems.length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center gap-2 mb-2 pb-1 border-b">
                        <Terminal className="h-3.5 w-3.5 text-sky-500" />
                        <span className="text-xs font-semibold text-sky-600">单独抓取</span>
                        <span className="text-xs text-muted-foreground">{singleItems.length} 条</span>
                      </div>
                      <div className="space-y-2">
                        {singleItems.map(item => <ItemCard key={item.id} item={item} onDelete={() => handleDelete(item.id)} onUpdate={p => handleUpdate(item.id, p)} />)}
                      </div>
                    </div>
                  )}
                  {parallelItems.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2 pb-1 border-b">
                        <GitFork className="h-3.5 w-3.5 text-violet-500" />
                        <span className="text-xs font-semibold text-violet-600">并行执行</span>
                        <span className="text-xs text-muted-foreground">{parallelItems.length} 条</span>
                      </div>
                      <div className="space-y-2">
                        {parallelItems.map(item => <ItemCard key={item.id} item={item} onDelete={() => handleDelete(item.id)} onUpdate={p => handleUpdate(item.id, p)} />)}
                      </div>
                    </div>
                  )}
                </>
              );
            })()
          )}
          {(sourceTab !== "all" || singleCount === 0 || parallelCount === 0) && filtered.map(item => (
            <ItemCard key={item.id} item={item} onDelete={() => handleDelete(item.id)} onUpdate={p => handleUpdate(item.id, p)} />
          ))}
        </div>
      )}
    </div>
  );
}
