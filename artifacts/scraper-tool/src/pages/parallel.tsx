import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Play, Square, Plus, Trash2, CheckCircle2, AlertCircle, Loader2, GitFork } from "lucide-react";

interface Step {
  type: string;
  selector?: string;
  url?: string;
  text?: string;
  key?: string;
  value?: string;
  waitMs?: number;
  listenFor?: string;
  listenTimeout?: number;
  varName?: string;
  incognito?: boolean;
  tabIndex?: number;
  waitForPopupClose?: boolean;
  popupTimeoutMs?: number;
}

interface SavedSequence {
  name: string;
  steps: Step[];
  savedAt: string;
  url?: string;
}

interface TrackConfig {
  id: string;
  seqName: string;
  urlOverride: string;
}

interface TrackState {
  activeStep: number | null;
  doneSteps: Record<number, boolean>;
  capturedVars: Record<string, string>;
  done: boolean;
  error?: string;
  duration?: number;
}

const STORAGE_KEY = "scraper-sequences-v3";
const loadSequences = (): SavedSequence[] => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
};

const TRACK_LABELS = ["A", "B", "C", "D", "E", "F"];

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

  const proxyUrl = localStorage.getItem("scraper-proxy") ?? "";
  const headedMode = localStorage.getItem("scraper-headed") === "1";

  const refreshSequences = () => setSequences(loadSequences());

  const addTrack = () => {
    if (tracks.length >= 6) return;
    setTracks(t => [...t, { id: crypto.randomUUID(), seqName: "", urlOverride: "" }]);
  };

  const removeTrack = (id: string) => {
    if (tracks.length <= 2) return;
    setTracks(t => t.filter(tr => tr.id !== id));
  };

  const updateTrack = (id: string, patch: Partial<TrackConfig>) =>
    setTracks(t => t.map(tr => tr.id === id ? { ...tr, ...patch } : tr));

  const runParallel = useCallback(async () => {
    const resolvedTracks = tracks.map((track, idx) => {
      const seq = sequences.find(s => s.name === track.seqName);
      const url = track.urlOverride.trim() || seq?.url;
      return { track, seq, url, idx };
    });

    for (const { track, seq, url, idx } of resolvedTracks) {
      if (!seq) {
        toast({ title: `轨道 ${TRACK_LABELS[idx]} 没有选择方案`, variant: "destructive" });
        return;
      }
      if (!url) {
        toast({ title: `轨道 ${TRACK_LABELS[idx]} 没有 URL（方案里没有保存网址，请手动填写）`, variant: "destructive" });
        return;
      }
    }

    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setTrackStates(tracks.map(() => ({
      activeStep: null, doneSteps: {}, capturedVars: {}, done: false,
    })));

    const payload = {
      tracks: resolvedTracks.map(({ seq, url, idx }) => ({
        url: url!,
        label: `轨道 ${TRACK_LABELS[idx]}`,
        proxy: proxyUrl || undefined,
        headed: headedMode || undefined,
        options: {
          headings: false, links: false, paragraphs: false, images: false, metaTags: false,
          steps: seq!.steps,
        },
      })),
    };

    try {
      const resp = await fetch("/api/parallel/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      if (!resp.ok) throw new Error(await resp.text());

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.trim() || line.startsWith(":")) continue;
          try {
            const ev = JSON.parse(line) as { track?: number; t: string; [k: string]: unknown };
            if (ev.t === "all_done") continue;
            const idx = ev.track;
            if (idx === undefined) continue;
            setTrackStates(prev => {
              const next = [...prev];
              if (!next[idx]) return prev;
              const ts = { ...next[idx] };
              if (ev.t === "step_start") ts.activeStep = ev.i as number;
              if (ev.t === "step_done") { ts.activeStep = null; ts.doneSteps = { ...ts.doneSteps, [ev.i as number]: ev.ok as boolean }; }
              if (ev.t === "captured") ts.capturedVars = { ...ts.capturedVars, [ev.varName as string]: ev.value as string };
              if (ev.t === "result") { ts.done = true; ts.duration = (ev as { duration?: number }).duration; }
              if (ev.t === "error") { ts.done = true; ts.error = ev.message as string; }
              next[idx] = ts;
              return next;
            });
          } catch { /* parse error, skip */ }
        }
      }
      toast({ title: "并行执行完成", description: `共 ${tracks.length} 条轨道` });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        toast({ title: "已取消并行执行" });
      } else {
        toast({ title: "执行失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" });
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [tracks, sequences, proxyUrl, headedMode, toast]);

  const cancel = () => abortRef.current?.abort();

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <GitFork className="h-5 w-5 text-primary" />并行执行
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          多条轨道同时运行——适合「A 监听等待，B 同时触发」场景（如 B 触发发送邮件，A 同步监听收件）
        </p>
      </div>

      {sequences.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center">
          <p className="text-sm text-amber-700 font-medium">还没有保存的方案</p>
          <p className="text-xs text-amber-600 mt-1">请先在「抓取面板」里配置好步骤，点「保存方案」后再来这里</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={refreshSequences}>刷新列表</Button>
        </div>
      ) : (
        <>
          <div className={`grid gap-4 mb-5 grid-cols-1 ${tracks.length === 2 ? "md:grid-cols-2" : tracks.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2 lg:grid-cols-3"}`}>
            {tracks.map((track, idx) => {
              const seq = sequences.find(s => s.name === track.seqName);
              const ts = trackStates[idx];
              const label = TRACK_LABELS[idx];
              return (
                <Card key={track.id} className={`border-border/50 transition-shadow ${ts && !ts.done && !ts.error && running ? "shadow-md ring-1 ring-primary/20" : ""}`}>
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold">{label}</span>
                        轨道 {label}
                      </span>
                      {tracks.length > 2 && !running && (
                        <button onClick={() => removeTrack(track.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">选择方案</label>
                      <select
                        className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
                        value={track.seqName}
                        onChange={e => updateTrack(track.id, { seqName: e.target.value })}
                        disabled={running}
                      >
                        <option value="">-- 选择已保存的方案 --</option>
                        {sequences.map(s => (
                          <option key={s.name} value={s.name}>{s.name}（{s.steps.length} 步）</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        网址{seq?.url ? <span className="text-[10px] ml-1 opacity-60">默认：{seq.url}</span> : <span className="text-red-500 ml-1">（必填）</span>}
                      </label>
                      <Input
                        placeholder={seq?.url ?? "https://..."}
                        className="text-xs h-8 font-mono"
                        value={track.urlOverride}
                        onChange={e => updateTrack(track.id, { urlOverride: e.target.value })}
                        disabled={running}
                      />
                    </div>

                    {ts && (
                      <div className="space-y-2 pt-1 border-t border-border/40">
                        {ts.error ? (
                          <div className="flex items-start gap-1.5 text-xs text-destructive">
                            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span className="break-all">{ts.error}</span>
                          </div>
                        ) : ts.done ? (
                          <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            完成{ts.duration ? ` · ${ts.duration}ms` : ""}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-primary">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {ts.activeStep !== null ? `步骤 ${ts.activeStep + 1} 执行中` : "准备执行..."}
                          </div>
                        )}

                        {seq && seq.steps.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {seq.steps.map((_, i) => (
                              <div
                                key={i}
                                title={`步骤 ${i + 1}`}
                                className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                                  i === ts.activeStep
                                    ? "bg-primary scale-125 animate-pulse"
                                    : ts.doneSteps[i] === true
                                    ? "bg-green-400"
                                    : ts.doneSteps[i] === false
                                    ? "bg-red-400"
                                    : "bg-muted-foreground/20"
                                }`}
                              />
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

          <div className="flex items-center gap-3">
            {!running ? (
              <Button onClick={runParallel} className="gap-2">
                <Play className="h-4 w-4" />并行执行
              </Button>
            ) : (
              <Button onClick={cancel} variant="destructive" className="gap-2">
                <Square className="h-4 w-4" />停止全部
              </Button>
            )}
            {tracks.length < 6 && (
              <Button onClick={addTrack} variant="outline" size="sm" className="gap-1.5" disabled={running}>
                <Plus className="h-3.5 w-3.5" />添加轨道
              </Button>
            )}
            <Button onClick={refreshSequences} variant="ghost" size="sm" className="text-muted-foreground" disabled={running}>
              刷新方案列表
            </Button>
          </div>

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
