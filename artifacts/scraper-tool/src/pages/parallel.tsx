import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Square, Plus, Trash2, CheckCircle2, AlertCircle, Loader2,
  GitFork, Monitor, Save, Upload, Download, RefreshCw, Repeat,
  FolderOpen, X, ChevronDown, ChevronUp,
} from "lucide-react";
import { addItemToStore, fromScrapeResult } from "@/lib/result-store";
import type { ScrapeResult } from "@workspace/api-client-react/src/generated/api.schemas";

// ─── Types ───────────────────────────────────────────────────────────────────
interface Step {
  type: string; selector?: string; url?: string; text?: string; key?: string;
  value?: string; waitMs?: number; listenFor?: string; listenTimeout?: number;
  varName?: string; incognito?: boolean; tabIndex?: number;
  waitForPopupClose?: boolean; popupTimeoutMs?: number;
}
interface SavedSequence { name: string; steps: Step[]; savedAt: string; url?: string; }
interface TrackConfig { id: string; seqName: string; urlOverride: string; }
interface TrackState {
  activeStep: number | null; doneSteps: Record<number, boolean>;
  capturedVars: Record<string, string>; done: boolean;
  error?: string; duration?: number; screenshot?: string; liveUrl?: string;
}
interface ParallelPreset {
  name: string; savedAt: string;
  tracks: Array<{ seqName: string; urlOverride: string }>;
  loopEnabled: boolean; loopCount: number; loopDelayMs: number;
  raceMode?: boolean;
}

// ─── Storage ──────────────────────────────────────────────────────────────────
const SEQ_KEY = "scraper-sequences-v3";
const PRESET_KEY = "scraper-parallel-presets-v1";
const loadSequences = (): SavedSequence[] => { try { return JSON.parse(localStorage.getItem(SEQ_KEY) || "[]"); } catch { return []; } };
const loadPresets = (): ParallelPreset[] => { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "[]"); } catch { return []; } };
const savePresets = (p: ParallelPreset[]) => localStorage.setItem(PRESET_KEY, JSON.stringify(p));

const TRACK_LABELS = ["A", "B", "C", "D", "E", "F"];
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function normalizeUrl(url: string): string {
  const t = url.trim();
  if (!t || /^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}
function cleanStep(step: Step): Step {
  const s = { ...step };
  (["listenFor","selector","url","text","key","value","varName"] as const).forEach(k => { if (s[k] === "") delete s[k]; });
  (["waitMs","listenTimeout","popupTimeoutMs","tabIndex"] as (keyof Step)[]).forEach(k => { if (s[k] == null || Number.isNaN(s[k])) delete s[k]; });
  return s;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Parallel() {
  const { toast } = useToast();
  const [sequences, setSequences] = useState<SavedSequence[]>(loadSequences);
  const [tracks, setTracks] = useState<TrackConfig[]>([
    { id: "a", seqName: "", urlOverride: "" },
    { id: "b", seqName: "", urlOverride: "" },
  ]);
  const [running, setRunning] = useState(false);
  const [trackStates, setTrackStates] = useState<TrackState[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const watchEsRefs = useRef<Map<number, EventSource>>(new Map());
  const closeWatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Race mode ────────────────────────────────────────────────────────────────
  const [raceMode, setRaceMode] = useState(false);

  // ── Loop state ──────────────────────────────────────────────────────────────
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopCount, setLoopCount] = useState(3);
  const [loopDelayMs, setLoopDelayMs] = useState(3000);
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopProgress, setLoopProgress] = useState<{ cur: number; tot: number; ok: number; fail: number } | null>(null);
  const stopLoopRef = useRef(false);

  // ── Preset state ────────────────────────────────────────────────────────────
  const [presets, setPresets] = useState<ParallelPreset[]>(loadPresets);
  const [presetName, setPresetName] = useState("");
  const [showPresets, setShowPresets] = useState(false);
  const importPresetRef = useRef<HTMLInputElement>(null);

  const proxyUrl = localStorage.getItem("scraper-proxy") ?? "";
  const headedMode = localStorage.getItem("scraper-headed") === "1";

  // ── Watch helpers ────────────────────────────────────────────────────────────
  const closeAllWatch = useCallback(() => { watchEsRefs.current.forEach(es => es.close()); watchEsRefs.current.clear(); }, []);
  useEffect(() => () => closeAllWatch(), [closeAllWatch]);

  const openWatch = useCallback((trackIdx: number, watchId: string) => {
    watchEsRefs.current.get(trackIdx)?.close();
    const es = new EventSource(`/api/scrape/watch/${watchId}`);
    es.onmessage = (e) => {
      const d = JSON.parse(e.data) as { type: string; data?: string; url?: string };
      if (d.type === "screenshot" && d.data) {
        setTrackStates(prev => {
          const next = [...prev];
          if (!next[trackIdx]) return prev;
          next[trackIdx] = { ...next[trackIdx], screenshot: `data:image/jpeg;base64,${d.data}`, liveUrl: d.url };
          return next;
        });
      }
      if (d.type === "done") { es.close(); watchEsRefs.current.delete(trackIdx); }
    };
    es.onerror = () => { es.close(); watchEsRefs.current.delete(trackIdx); };
    watchEsRefs.current.set(trackIdx, es);
  }, []);

  // ── Track helpers ────────────────────────────────────────────────────────────
  const addTrack = () => { if (tracks.length < 6) setTracks(t => [...t, { id: crypto.randomUUID(), seqName: "", urlOverride: "" }]); };
  const removeTrack = (id: string) => { if (tracks.length > 2) setTracks(t => t.filter(tr => tr.id !== id)); };
  const updateTrack = (id: string, patch: Partial<TrackConfig>) => setTracks(t => t.map(tr => tr.id === id ? { ...tr, ...patch } : tr));

  // ── Core execution (one round) ───────────────────────────────────────────────
  const executeOnce = useCallback(async (): Promise<boolean> => {
    const resolvedTracks = tracks.map((track, idx) => {
      const seq = sequences.find(s => s.name === track.seqName);
      const url = track.urlOverride.trim() || seq?.url;
      return { track, seq, url, idx };
    });
    for (const { seq, url, idx } of resolvedTracks) {
      if (!seq) { toast({ title: `轨道 ${TRACK_LABELS[idx]} 没有选择方案`, variant: "destructive" }); return false; }
      if (!url) { toast({ title: `轨道 ${TRACK_LABELS[idx]} 没有 URL`, variant: "destructive" }); return false; }
    }

    closeAllWatch();
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setTrackStates(tracks.map(() => ({ activeStep: null, doneSteps: {}, capturedVars: {}, done: false })));

    const payload = {
      tracks: resolvedTracks.map(({ seq, url, idx }) => ({
        url: normalizeUrl(url!), label: `轨道 ${TRACK_LABELS[idx]}`,
        proxy: proxyUrl || undefined, headed: headedMode || undefined,
        options: { headings: false, links: false, paragraphs: false, images: false, metaTags: false, steps: (seq!.steps ?? []).map(cleanStep) },
      })),
    };

    let succeeded = false;
    // raceWon: set when race mode triggers so we don't show an error toast for the abort
    let raceWon = false;
    try {
      const resp = await fetch("/api/parallel/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ac.signal });
      if (!resp.ok) throw new Error(await resp.text());

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop()!;
        for (const line of lines) {
          if (!line.trim() || line.startsWith(":")) continue;
          try {
            const ev = JSON.parse(line) as { track?: number; t: string; [k: string]: unknown };
            if (ev.t === "all_done") continue;
            const idx = ev.track;
            if (idx === undefined) continue;
            if (ev.t === "watch_ready" && ev.watchId) openWatch(idx, ev.watchId as string);
            setTrackStates(prev => {
              const next = [...prev];
              if (!next[idx]) return prev;
              const ts = { ...next[idx] };
              if (ev.t === "step_start") ts.activeStep = ev.i as number;
              if (ev.t === "step_done") { ts.activeStep = null; ts.doneSteps = { ...ts.doneSteps, [ev.i as number]: ev.ok as boolean }; }
              if (ev.t === "captured") ts.capturedVars = { ...ts.capturedVars, [ev.varName as string]: ev.value as string };
              if (ev.t === "result") {
                ts.done = true; ts.duration = (ev as { duration?: number }).duration;
                addItemToStore(fromScrapeResult(ev as unknown as ScrapeResult, "parallel", `轨道 ${TRACK_LABELS[idx]}`));
                window.dispatchEvent(new StorageEvent("storage", { key: "scraper-collected-v1" }));
                // Race mode: first track to finish wins — abort all others immediately
                if (raceMode && !raceWon) {
                  raceWon = true;
                  abortRef.current?.abort();
                }
              }
              if (ev.t === "error") { ts.done = true; ts.error = ev.message as string; }
              next[idx] = ts;
              return next;
            });
          } catch { /* parse error */ }
        }
      }
      succeeded = true;
    } catch (e) {
      // Race mode abort is intentional — don't show an error toast, count as success
      if (raceWon) {
        succeeded = true;
      } else if (!(e instanceof DOMException && e.name === "AbortError")) {
        toast({ title: "执行失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" });
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      // Cancel any pending close-watch timer from a previous run, then schedule a new one.
      // This prevents a previous timer from closing watch windows opened by the next loop iteration.
      if (closeWatchTimerRef.current) clearTimeout(closeWatchTimerRef.current);
      closeWatchTimerRef.current = setTimeout(() => closeAllWatch(), 3000);
    }
    return succeeded;
  }, [tracks, sequences, proxyUrl, headedMode, raceMode, toast, openWatch, closeAllWatch]);

  // ── Single run ───────────────────────────────────────────────────────────────
  const runParallel = useCallback(async () => {
    const ok = await executeOnce();
    if (ok) toast({ title: "并行执行完成", description: `共 ${tracks.length} 条轨道` });
  }, [executeOnce, tracks.length, toast]);

  // ── Loop run ─────────────────────────────────────────────────────────────────
  // Fixed-interval mode: each cycle starts exactly loopDelayMs after the previous
  // cycle started. A hard timeout aborts the current execution if it exceeds the
  // interval — the loop always moves on regardless of how long scraping takes.
  const runLoop = useCallback(async () => {
    stopLoopRef.current = false;
    setLoopRunning(true);
    let ok = 0, fail = 0;
    for (let i = 0; i < loopCount; i++) {
      if (stopLoopRef.current) break;
      setLoopProgress({ cur: i + 1, tot: loopCount, ok, fail });
      const cycleStart = Date.now();

      // Hard deadline: forcibly abort the current execution when the interval expires.
      // This guarantees the loop never gets stuck waiting for a slow/hung page.
      let cycleTimer: ReturnType<typeof setTimeout> | null = null;
      if (loopDelayMs > 0) {
        cycleTimer = setTimeout(() => {
          abortRef.current?.abort();
        }, loopDelayMs);
      }

      const succeeded = await executeOnce();
      if (cycleTimer) { clearTimeout(cycleTimer); cycleTimer = null; }

      if (succeeded) ok++; else fail++;

      if (i < loopCount - 1 && !stopLoopRef.current) {
        const remaining = loopDelayMs - (Date.now() - cycleStart);
        // Always wait at least 300ms so React state from the previous run
        // settles before the next executeOnce() begins.
        await sleep(Math.max(300, remaining));
      }
    }
    setLoopRunning(false);
    setLoopProgress(null);
    toast({
      title: stopLoopRef.current ? "循环已停止" : "循环完成",
      description: `成功 ${ok} 次${fail > 0 ? `，失败 ${fail} 次` : ""}`,
    });
  }, [executeOnce, loopCount, loopDelayMs, toast]);

  const cancel = () => {
    stopLoopRef.current = true;
    abortRef.current?.abort();
    // Close watch windows immediately instead of waiting for the 3-second timer
    if (closeWatchTimerRef.current) clearTimeout(closeWatchTimerRef.current);
    closeAllWatch();
  };
  const isRunning = running || loopRunning;

  // ── Preset management ────────────────────────────────────────────────────────
  const savePreset = () => {
    const n = presetName.trim();
    if (!n) { toast({ title: "请输入配置名称", variant: "destructive" }); return; }
    const preset: ParallelPreset = {
      name: n, savedAt: new Date().toISOString(),
      tracks: tracks.map(t => ({ seqName: t.seqName, urlOverride: t.urlOverride })),
      loopEnabled, loopCount, loopDelayMs, raceMode,
    };
    const updated = [preset, ...presets.filter(p => p.name !== n)];
    savePresets(updated); setPresets(updated); setPresetName("");
    toast({ title: `配置「${n}」已保存` });
  };

  const loadPreset = (preset: ParallelPreset) => {
    setTracks(preset.tracks.map((t, i) => ({ id: String(i), seqName: t.seqName, urlOverride: t.urlOverride })));
    setLoopEnabled(preset.loopEnabled ?? false);
    setLoopCount(preset.loopCount ?? 3);
    setLoopDelayMs(preset.loopDelayMs ?? 3000);
    setRaceMode(preset.raceMode ?? false);
    toast({ title: `已加载配置「${preset.name}」` });
  };

  const deletePreset = (name: string) => {
    const updated = presets.filter(p => p.name !== name);
    savePresets(updated); setPresets(updated);
  };

  const exportPresets = () => {
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `parallel-presets-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importPresets = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as ParallelPreset[];
        if (!Array.isArray(data)) throw new Error("格式错误");
        const merged = [...data, ...presets.filter(p => !data.find(d => d.name === p.name))];
        savePresets(merged); setPresets(merged);
        toast({ title: `导入成功，共 ${data.length} 个配置` });
      } catch { toast({ title: "导入失败，文件格式不正确", variant: "destructive" }); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <GitFork className="h-5 w-5 text-primary" />并行执行
          </h1>
          <p className="text-sm text-muted-foreground mt-1">多条轨道同时运行——适合「A 监听等待，B 同时触发」场景</p>
        </div>
        {/* Preset quick actions */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setShowPresets(v => !v)}>
            <FolderOpen className="h-3.5 w-3.5" />
            配置列表{presets.length > 0 && <span className="ml-0.5 text-primary font-bold">({presets.length})</span>}
            {showPresets ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={exportPresets} disabled={presets.length === 0}>
            <Download className="h-3.5 w-3.5" />导出
          </Button>
          <label className="cursor-pointer">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 pointer-events-none" asChild>
              <span><Upload className="h-3.5 w-3.5" />导入</span>
            </Button>
            <input type="file" accept=".json" className="hidden" ref={importPresetRef} onChange={importPresets} />
          </label>
        </div>
      </div>

      {/* Preset list panel */}
      {showPresets && (
        <Card className="mb-4 border-violet-200 bg-violet-50/30 animate-in fade-in slide-in-from-top-2 duration-150">
          <CardContent className="p-3">
            {presets.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">还没有保存的配置，配置好轨道后点「保存配置」</p>
            ) : (
              <div className="space-y-1.5">
                {presets.map(preset => (
                  <div key={preset.name} className="flex items-center gap-2 bg-background rounded-md border px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm">{preset.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {preset.tracks.length} 条轨道
                        {preset.loopEnabled ? ` · 循环 ${preset.loopCount} 次 / ${Math.round((preset.loopDelayMs ?? 0) / 1000)}s` : ""}
                        {" · "}{new Date(preset.savedAt).toLocaleDateString("zh-CN")}
                      </span>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => loadPreset(preset)}>
                      <FolderOpen className="h-3 w-3" />加载
                    </Button>
                    <button className="text-muted-foreground hover:text-destructive transition-colors p-1" onClick={() => deletePreset(preset.name)}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sequences.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center">
          <p className="text-sm text-amber-700 font-medium">还没有保存的方案</p>
          <p className="text-xs text-amber-600 mt-1">请先在「抓取面板」配置好步骤，点「保存方案」后再来这里</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setSequences(loadSequences())}>刷新列表</Button>
        </div>
      ) : (
        <>
          {/* Track grid */}
          <div className={`grid gap-4 mb-5 grid-cols-1 ${tracks.length === 2 ? "md:grid-cols-2" : tracks.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2 lg:grid-cols-3"}`}>
            {tracks.map((track, idx) => {
              const seq = sequences.find(s => s.name === track.seqName);
              const ts = trackStates[idx];
              const label = TRACK_LABELS[idx];
              const isActive = ts && !ts.done && !ts.error && running;
              return (
                <Card key={track.id} className={`border-border/50 transition-shadow overflow-hidden ${isActive ? "shadow-md ring-1 ring-primary/20" : ""}`}>
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold">{label}</span>
                        轨道 {label}
                        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
                      </span>
                      {tracks.length > 2 && !isRunning && (
                        <button onClick={() => removeTrack(track.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    {/* Live screenshot */}
                    {ts?.screenshot ? (
                      <div className="rounded-md overflow-hidden border border-border/40 bg-black">
                        <img src={ts.screenshot} alt="实时截图" className="w-full object-cover" style={{ maxHeight: 180, objectPosition: "top" }} />
                        {ts.liveUrl && <p className="text-[9px] font-mono text-white/60 bg-black/80 px-2 py-0.5 truncate">{ts.liveUrl}</p>}
                      </div>
                    ) : running && ts && !ts.done && !ts.error ? (
                      <div className="rounded-md border border-border/40 bg-muted/30 flex items-center justify-center" style={{ height: 100 }}>
                        <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                          <Monitor className="h-5 w-5 animate-pulse" />
                          <span className="text-xs">浏览器启动中...</span>
                        </div>
                      </div>
                    ) : null}

                    {/* Config (hidden while running) */}
                    {!isRunning && (
                      <>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">选择方案</label>
                          <select className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background" value={track.seqName} onChange={e => updateTrack(track.id, { seqName: e.target.value })}>
                            <option value="">-- 选择已保存的方案 --</option>
                            {sequences.map(s => <option key={s.name} value={s.name}>{s.name}（{s.steps.length} 步）</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">
                            网址{seq?.url ? <span className="text-[10px] ml-1 opacity-60 font-mono truncate inline-block max-w-[120px] align-middle">{seq.url}</span> : <span className="text-red-500 ml-1">（必填）</span>}
                          </label>
                          <Input placeholder={seq?.url ?? "https://..."} className="text-xs h-8 font-mono" value={track.urlOverride} onChange={e => updateTrack(track.id, { urlOverride: e.target.value })} />
                        </div>
                      </>
                    )}

                    {/* Status */}
                    {ts && (
                      <div className="space-y-2">
                        {ts.error ? (
                          <div className="flex items-start gap-1.5 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span className="break-all">{ts.error}</span></div>
                        ) : ts.done ? (
                          <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium"><CheckCircle2 className="h-3.5 w-3.5" />完成{ts.duration ? ` · ${ts.duration}ms` : ""}</div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-primary"><Loader2 className="h-3.5 w-3.5 animate-spin" />{ts.activeStep !== null ? `步骤 ${ts.activeStep + 1} 执行中` : "准备执行..."}</div>
                        )}
                        {seq && seq.steps.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {seq.steps.map((_, i) => (
                              <div key={i} title={`步骤 ${i + 1}`} className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${i === ts.activeStep ? "bg-primary scale-125 animate-pulse" : ts.doneSteps[i] === true ? "bg-green-400" : ts.doneSteps[i] === false ? "bg-red-400" : "bg-muted-foreground/20"}`} />
                            ))}
                          </div>
                        )}
                        {Object.keys(ts.capturedVars).length > 0 && (
                          <div className="space-y-1">
                            {Object.entries(ts.capturedVars).map(([k, v]) => (
                              <div key={k} className="text-xs font-mono bg-teal-50 border border-teal-100 rounded px-2 py-0.5 flex gap-1.5">
                                <span className="text-teal-600 shrink-0">{k}</span>
                                <span className="text-muted-foreground">=</span>
                                <span className="truncate">{v}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Loop progress bar */}
          {loopProgress && (
            <Card className="mb-4 border-violet-200 bg-violet-50/50 animate-in fade-in">
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Repeat className="h-4 w-4 text-violet-500" />
                    循环进度：第 {loopProgress.cur} / {loopProgress.tot} 次
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ✓ {loopProgress.ok}{loopProgress.fail > 0 ? ` · ✗ ${loopProgress.fail}` : ""}
                  </span>
                </div>
                <div className="w-full bg-violet-100 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-violet-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${((loopProgress.cur - 1) / loopProgress.tot) * 100}%` }} />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Controls row */}
          <div className="flex items-center gap-3 flex-wrap mb-4">
            {!isRunning ? (
              <Button onClick={loopEnabled ? runLoop : runParallel} className="gap-2">
                {loopEnabled ? <Repeat className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {loopEnabled ? `循环执行 ${loopCount} 次` : "并行执行"}
              </Button>
            ) : (
              <Button onClick={cancel} variant="destructive" className="gap-2">
                <Square className="h-4 w-4" />{loopRunning ? "停止循环" : "停止全部"}
              </Button>
            )}
            {tracks.length < 6 && !isRunning && (
              <Button onClick={addTrack} variant="outline" size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />添加轨道
              </Button>
            )}
            {!isRunning && (
              <Button onClick={() => setSequences(loadSequences())} variant="ghost" size="sm" className="text-muted-foreground gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />刷新方案
              </Button>
            )}
          </div>

          {/* Loop + Race settings */}
          <Card className={`mb-4 border-border/50 transition-all ${loopEnabled ? "border-violet-300 bg-violet-50/30" : raceMode ? "border-amber-300 bg-amber-50/30" : ""}`}>
            <CardContent className="py-3 px-4 space-y-3">
              {/* Race mode toggle */}
              <div className="flex items-center gap-5 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <div
                    className={`relative w-9 h-5 rounded-full transition-colors ${raceMode ? "bg-amber-500" : "bg-muted"}`}
                    onClick={() => !isRunning && setRaceMode(v => !v)}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${raceMode ? "translate-x-4" : ""}`} />
                  </div>
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <span className="text-amber-500">⚡</span>竞速模式
                  </span>
                </label>
                {raceMode && (
                  <span className="text-xs text-muted-foreground">任意一条轨道完成即立即停止其余轨道</span>
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-border/40" />

              {/* Loop toggle */}
              <div className="flex items-center gap-5 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <div
                    className={`relative w-9 h-5 rounded-full transition-colors ${loopEnabled ? "bg-violet-500" : "bg-muted"}`}
                    onClick={() => setLoopEnabled(v => !v)}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${loopEnabled ? "translate-x-4" : ""}`} />
                  </div>
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <Repeat className="h-3.5 w-3.5 text-violet-500" />循环模式
                  </span>
                </label>
                {loopEnabled && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">循环次数</span>
                      <Input type="number" min={1} max={999} value={loopCount} onChange={e => setLoopCount(Math.max(1, Number(e.target.value)))} className="w-20 h-8 text-sm text-center" />
                      <span className="text-xs text-muted-foreground">次</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">固定间隔</span>
                      <Input
                        type="number" min={0} step={1}
                        value={Math.round(loopDelayMs / 1000)}
                        onChange={e => setLoopDelayMs(Math.max(0, Number(e.target.value)) * 1000)}
                        className="w-20 h-8 text-sm text-center"
                      />
                      <span className="text-xs text-muted-foreground">秒</span>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Save preset row */}
          {!isRunning && (
            <div className="flex items-center gap-2">
              <Input
                placeholder="输入配置名称…"
                className="h-8 text-sm max-w-[200px]"
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && savePreset()}
              />
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={savePreset}>
                <Save className="h-3.5 w-3.5" />保存当前配置
              </Button>
            </div>
          )}

          {proxyUrl && (
            <p className="mt-3 text-xs text-amber-600 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              所有轨道将通过代理 {proxyUrl} 发送
            </p>
          )}
        </>
      )}
    </div>
  );
}
