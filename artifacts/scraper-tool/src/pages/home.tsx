import { useState, useRef, useCallback, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Globe, Search, AlertCircle, CheckCircle2, Loader2,
  MousePointerClick, Plus, Trash2, Crosshair, Clock,
  TrendingUp, ChevronDown, ChevronUp, ExternalLink, Repeat, Square,
  Play, ArrowUp, ArrowDown, Timer, Save, FolderOpen, X,
  Keyboard, ListOrdered, Eye, MoveDown, Type, Activity,
  Video, StopCircle, Undo2, Link2,
} from "lucide-react";
import type { ScrapeResult } from "@workspace/api-client-react/src/generated/api.schemas";

// ─── Recorder types ───────────────────────────────────────────────────────────
type RecordedStep = {
  id: string;
  type: "click" | "type" | "select";
  selector: string;
  text?: string;
  value?: string;
  label?: string;
  navigatedTo?: string;
};

// ─── Step definitions ────────────────────────────────────────────────────────

const STEP_TYPES = [
  { type: "click",    label: "点击",     icon: MousePointerClick, color: "blue",   desc: "点击页面上的某个按钮或链接" },
  { type: "listen",   label: "监听",     icon: Eye,               color: "purple", desc: "等到某个元素出现/消失，或网络空闲" },
  { type: "capture",  label: "读取保存", icon: Crosshair,         color: "teal",   desc: "读取元素内容，保存为变量供后续步骤使用" },
  { type: "navigate", label: "跳转网址", icon: Globe,             color: "indigo", desc: "在同一浏览器内跳转到另一个网址" },
  { type: "type",     label: "输入文字", icon: Type,              color: "green",  desc: "在输入框填入文字，支持 ${变量名} 引用保存的值" },
  { type: "key",      label: "按键",     icon: Keyboard,          color: "orange", desc: "模拟键盘按键，如回车、Tab" },
  { type: "select",   label: "下拉选择", icon: ListOrdered,       color: "cyan",   desc: "选择下拉框中的某个选项" },
  { type: "scroll",   label: "滚动",     icon: MoveDown,          color: "pink",   desc: "滚动到指定元素位置" },
  { type: "hover",    label: "悬停",     icon: Eye,               color: "yellow", desc: "将鼠标悬停在元素上" },
] as const;

type StepType = typeof STEP_TYPES[number]["type"];

const COLOR_MAP: Record<string, { bg: string; border: string; bar: string; btn: string }> = {
  blue:   { bg: "bg-blue-50/60",   border: "border-blue-200",  bar: "bg-blue-400",   btn: "text-blue-600 border-blue-200 hover:bg-blue-50"   },
  purple: { bg: "bg-purple-50/60", border: "border-purple-200",bar: "bg-purple-400", btn: "text-purple-600 border-purple-200 hover:bg-purple-50"},
  teal:   { bg: "bg-teal-50/60",   border: "border-teal-200",  bar: "bg-teal-400",   btn: "text-teal-600 border-teal-200 hover:bg-teal-50"   },
  indigo: { bg: "bg-indigo-50/60", border: "border-indigo-200",bar: "bg-indigo-400", btn: "text-indigo-600 border-indigo-200 hover:bg-indigo-50"},
  green:  { bg: "bg-green-50/60",  border: "border-green-200", bar: "bg-green-400",  btn: "text-green-600 border-green-200 hover:bg-green-50" },
  orange: { bg: "bg-orange-50/60", border: "border-orange-200",bar: "bg-orange-400", btn: "text-orange-600 border-orange-200 hover:bg-orange-50"},
  cyan:   { bg: "bg-cyan-50/60",   border: "border-cyan-200",  bar: "bg-cyan-400",   btn: "text-cyan-600 border-cyan-200 hover:bg-cyan-50"   },
  pink:   { bg: "bg-pink-50/60",   border: "border-pink-200",  bar: "bg-pink-400",   btn: "text-pink-600 border-pink-200 hover:bg-pink-50"   },
  yellow: { bg: "bg-yellow-50/60", border: "border-yellow-200",bar: "bg-yellow-400", btn: "text-yellow-600 border-yellow-200 hover:bg-yellow-50"},
};

const COMMON_KEYS = ["Enter", "Tab", "Escape", "Space", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Backspace"];

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const stepSchema = z.object({
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

type Step = z.infer<typeof stepSchema>;

const customSelectorSchema = z.object({
  name: z.string().min(1, "请填写名称"),
  selector: z.string().min(1, "请填写选择器"),
});

const formSchema = z.object({
  url: z.string().url({ message: "请输入有效的URL，例如 https://example.com" }),
  steps: z.array(stepSchema),
  customSelectors: z.array(customSelectorSchema),
  loopEnabled: z.boolean(),
  loopCount: z.number().min(1).max(200),
  loopDelayMs: z.number().min(0),
});

type FormValues = z.infer<typeof formSchema>;

// ─── Saved sequences ──────────────────────────────────────────────────────────

interface SavedSequence { name: string; steps: Step[]; savedAt: string; }
const STORAGE_KEY = "scraper-sequences-v2";
const loadSequences = (): SavedSequence[] => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } };
const persistSequences = (s: SavedSequence[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(s));

// ─── Snapshot ────────────────────────────────────────────────────────────────

interface Snapshot { id: string; iteration?: number; loopTotal?: number; triggeredAt: string; duration: number; result: ScrapeResult; }
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Default step factories ───────────────────────────────────────────────────

const defaults: Record<StepType, Partial<Step>> = {
  click:    { type: "click",    selector: "", waitMs: 1000, waitForPopupClose: false, popupTimeoutMs: 30000 },
  listen:   { type: "listen",   selector: "", listenFor: "appear", listenTimeout: 15000 },
  capture:  { type: "capture",  selector: "", varName: "" },
  navigate: { type: "navigate", url: "", waitMs: 1500, incognito: true },
  type:     { type: "type",     selector: "", text: "" },
  key:      { type: "key",      key: "Enter", waitMs: 500 },
  select:   { type: "select",   selector: "", value: "" },
  scroll:   { type: "scroll",   selector: "" },
  hover:    { type: "hover",    selector: "", waitMs: 500 },
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function Home() {
  const { toast } = useToast();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [triggerCount, setTriggerCount] = useState(0);
  const [expandedSnapshots, setExpandedSnapshots] = useState<Set<string>>(new Set());
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopProgress, setLoopProgress] = useState<{ current: number; total: number } | null>(null);
  const [singlePending, setSinglePending] = useState(false);
  const [savedSequences, setSavedSequences] = useState<SavedSequence[]>(loadSequences);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const stopLoopRef = useRef(false);
  const snapshotIdRef = useRef(0);
  const [execProgress, setExecProgress] = useState<{
    activeIdx: number | null;
    doneMap: Record<number, boolean>;
    liveVars: Record<string, string>;
  } | null>(null);

  // ── Recorder state ────────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSteps, setRecordedSteps] = useState<RecordedStep[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [sessionCurrentUrl, setSessionCurrentUrl] = useState("");
  const [sessionLoading, setSessionLoading] = useState(false);
  const [typeText, setTypeText] = useState("");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const recStepIdRef = useRef(0);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      url: "https://example.com",
      steps: [],
      customSelectors: [],
      loopEnabled: false,
      loopCount: 5,
      loopDelayMs: 3000,
    },
  });

  const { fields: stepFields, append: appendStep, remove: removeStep, move: moveStep } = useFieldArray({ control: form.control, name: "steps" });
  const { fields: selectorFields, append: appendSelector, remove: removeSelector } = useFieldArray({ control: form.control, name: "customSelectors" });

  const { data: health } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });

  // ── Save/Load ─────────────────────────────────────────────────────────────

  const handleSave = () => {
    if (form.getValues("steps").length === 0) { toast({ title: "步骤为空", variant: "destructive" }); return; }
    setSaveName(""); setSaveDialogOpen(true);
  };
  const confirmSave = () => {
    const name = saveName.trim(); if (!name) return;
    const seq: SavedSequence = { name, steps: form.getValues("steps") as Step[], savedAt: new Date().toLocaleString("zh-CN") };
    const updated = [seq, ...savedSequences.filter((s) => s.name !== name)];
    setSavedSequences(updated); persistSequences(updated); setSaveDialogOpen(false);
    toast({ title: `已保存"${name}"` });
  };
  const loadSequence = (seq: SavedSequence) => { form.setValue("steps", seq.steps as FormValues["steps"]); toast({ title: `已加载"${seq.name}"` }); };
  const deleteSequence = (name: string) => { const u = savedSequences.filter((s) => s.name !== name); setSavedSequences(u); persistSequences(u); };

  // ── Scrape ────────────────────────────────────────────────────────────────

  const buildRequest = useCallback((values: FormValues) => ({
    url: values.url,
    options: {
      headings: false, links: false, paragraphs: false, images: false, metaTags: false,
      steps: values.steps.length > 0 ? values.steps : undefined,
      customSelectors: values.customSelectors.length > 0 ? values.customSelectors : undefined,
    },
  }), []);

  const addSnap = useCallback((data: ScrapeResult, iteration?: number, loopTotal?: number) => {
    const snap: Snapshot = { id: String(++snapshotIdRef.current), iteration, loopTotal, triggeredAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }), duration: data.duration, result: data };
    setSnapshots((p) => [snap, ...p]); setTriggerCount((c) => c + 1);
  }, []);

  // ── Streaming scrape helper ────────────────────────────────────────────────
  const streamScrape = useCallback(async (
    payload: { url: string; options: object },
    onEvent: (e: { t: string; [k: string]: unknown }) => void
  ): Promise<ScrapeResult> => {
    const resp = await fetch("/api/scrape/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let result: ScrapeResult | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          onEvent(ev);
          if (ev.t === "result") result = ev as unknown as ScrapeResult;
          if (ev.t === "error") throw new Error(ev.message as string);
        } catch (parseErr) { if (parseErr instanceof SyntaxError) continue; throw parseErr; }
      }
    }
    if (!result) throw new Error("未收到结果");
    return result;
  }, []);

  // ── Recorder handlers ─────────────────────────────────────────────────────

  const stopRecording = useCallback((sid?: string | null) => {
    const id = sid ?? sessionId;
    if (id) {
      fetch(`/api/record/session/${id}`, { method: "DELETE" }).catch(() => {});
    }
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setIsRecording(false);
    setSessionId(null);
    setScreenshotUrl("");
    setSessionCurrentUrl("");
    setSessionLoading(false);
    setTypeText("");
  }, [sessionId]);

  const startRecording = useCallback(async () => {
    const url = form.getValues("url");
    if (!url?.trim() || url === "https://example.com") {
      toast({ title: "请先填写目标网址", variant: "destructive" });
      return;
    }
    setRecordedSteps([]);
    recStepIdRef.current = 0;
    setScreenshotUrl("");
    setSessionLoading(true);
    setIsRecording(true);

    try {
      const resp = await fetch("/api/record/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const { sessionId: sid, url: finalUrl } = await resp.json() as { sessionId: string; url: string };
      setSessionId(sid);
      setSessionCurrentUrl(finalUrl);
      setSessionLoading(false);

      // Open SSE stream for screenshots
      const es = new EventSource(`/api/record/session/${sid}/stream`);
      esRef.current = es;
      es.onmessage = (e) => {
        const data = JSON.parse(e.data) as { type: string; data?: string; url?: string };
        if (data.type === "screenshot" && data.data) {
          setScreenshotUrl(`data:image/jpeg;base64,${data.data}`);
        } else if (data.type === "navigated" && data.url) {
          setSessionCurrentUrl(data.url);
        }
      };
      es.onerror = () => { es.close(); esRef.current = null; };
    } catch (err) {
      toast({ title: "启动录制失败", description: String(err), variant: "destructive" });
      stopRecording(null);
    }
  }, [form, toast, stopRecording]);

  // Interact helpers
  const sendInteract = useCallback(async (body: object) => {
    if (!sessionId) return null;
    const resp = await fetch(`/api/record/session/${sessionId}/interact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return resp.ok ? resp.json() : null;
  }, [sessionId]);

  const handleOverlayClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const result = await sendInteract({ action: "click", x, y }) as { step?: RecordedStep; url?: string } | null;
    if (result?.step) {
      const newId = String(++recStepIdRef.current);
      setRecordedSteps((s) => [...s, { id: newId, ...result.step! }]);
    }
    if (result?.url) setSessionCurrentUrl(result.url);
  }, [sendInteract]);

  const handleOverlayScroll = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    sendInteract({ action: "scroll", x, y, deltaY: e.deltaY > 0 ? 250 : -250 });
  }, [sendInteract]);

  const sendKey = useCallback((key: string) => {
    sendInteract({ action: "key", key }).then((r: { url?: string } | null) => {
      if (r?.url) setSessionCurrentUrl(r.url);
    });
  }, [sendInteract]);

  const sendType = useCallback(() => {
    const t = typeText.trim();
    if (!t) return;
    sendInteract({ action: "type", text: t });
    setTypeText("");
  }, [sendInteract, typeText]);

  const applyRecordedSteps = useCallback(() => {
    recordedSteps.forEach((rs) => {
      if (rs.type === "click") {
        appendStep({ type: "click", selector: rs.selector, waitMs: 1500 });
      } else if (rs.type === "type") {
        appendStep({ type: "type", selector: rs.selector, text: rs.text ?? "", waitMs: 500 });
      } else if (rs.type === "select") {
        appendStep({ type: "select", selector: rs.selector, value: rs.value ?? "", waitMs: 500 });
      }
    });
    setIsRecording(false);
    toast({ title: `已添加 ${recordedSteps.length} 个步骤`, description: "可在左侧步骤列表中查看和调整" });
  }, [recordedSteps, appendStep, toast]);

  const runSingle = useCallback(async () => {
    setSinglePending(true);
    setExecProgress({ activeIdx: null, doneMap: {}, liveVars: {} });
    try {
      const d = await streamScrape(buildRequest(form.getValues()), (ev) => {
        if (ev.t === "step_start") setExecProgress(p => p && ({ ...p, activeIdx: ev.i as number }));
        if (ev.t === "step_done") setExecProgress(p => p && ({ ...p, activeIdx: null, doneMap: { ...p.doneMap, [ev.i as number]: ev.ok as boolean } }));
        if (ev.t === "captured") setExecProgress(p => p && ({ ...p, liveVars: { ...p.liveVars, [ev.varName as string]: ev.value as string } }));
      });
      addSnap(d);
      toast({ title: "执行完成", description: `耗时 ${d.duration}ms` });
    } catch (e: unknown) {
      toast({ title: "执行失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" });
    } finally {
      setSinglePending(false);
      setTimeout(() => setExecProgress(null), 4000);
    }
  }, [form, streamScrape, buildRequest, addSnap, toast]);

  const runLoop = useCallback(async () => {
    const v = form.getValues(); const total = v.loopCount; const delay = v.loopDelayMs;
    stopLoopRef.current = false; setLoopRunning(true); setLoopProgress({ current: 0, total });
    let ok = 0; let fail = 0;
    for (let i = 1; i <= total; i++) {
      if (stopLoopRef.current) break;
      setLoopProgress({ current: i, total });
      setExecProgress({ activeIdx: null, doneMap: {}, liveVars: {} });
      try {
        const d = await streamScrape(buildRequest(v), (ev) => {
          if (ev.t === "step_start") setExecProgress(p => p && ({ ...p, activeIdx: ev.i as number }));
          if (ev.t === "step_done") setExecProgress(p => p && ({ ...p, activeIdx: null, doneMap: { ...p.doneMap, [ev.i as number]: ev.ok as boolean } }));
          if (ev.t === "captured") setExecProgress(p => p && ({ ...p, liveVars: { ...p.liveVars, [ev.varName as string]: ev.value as string } }));
        });
        addSnap(d, i, total); ok++;
      } catch (e: unknown) {
        fail++;
        toast({ title: `第 ${i} 次失败`, description: e instanceof Error ? e.message : "", variant: "destructive" });
      }
      if (i < total && !stopLoopRef.current) await sleep(delay);
    }
    setLoopRunning(false); setLoopProgress(null);
    setExecProgress(null);
    toast({ title: stopLoopRef.current ? "循环已停止" : "循环完成", description: `成功 ${ok} 次${fail > 0 ? `，失败 ${fail} 次` : ""}` });
  }, [form, streamScrape, buildRequest, addSnap, toast]);

  const isRunning = loopRunning || singlePending;
  const loopEnabled = form.watch("loopEnabled");
  const watchedSteps = form.watch("steps");

  return (
    <>
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-7xl">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">

        {/* ── LEFT ─────────────────────────────────────────────────────── */}
        <div className="lg:col-span-4 space-y-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(() => loopEnabled ? runLoop() : runSingle())} className="space-y-4">

              {/* URL */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Globe className="h-4 w-4 text-primary" />目标网址
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <FormField control={form.control} name="url" render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div className="relative">
                          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input placeholder="https://" className="pl-9 font-mono text-sm" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
                <CardFooter className="pt-0 pb-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                    onClick={startRecording}
                  >
                    <Video className="h-3.5 w-3.5" />
                    可视化录制步骤
                  </Button>
                </CardFooter>
              </Card>

              {/* Step builder */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Play className="h-4 w-4 text-primary" />操作步骤
                    {stepFields.length > 0 && <Badge variant="secondary" className="font-mono">{stepFields.length}</Badge>}
                  </CardTitle>
                  <CardDescription className="text-xs">按顺序执行，支持点击、监听、输入、按键、下拉、滚动、悬停</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {stepFields.length === 0 && (
                    <div className="text-center py-6 text-xs text-muted-foreground border-2 border-dashed rounded-md">
                      还没有步骤，点击下方"添加步骤"开始
                    </div>
                  )}

                  {stepFields.map((field, index) => {
                    const s = watchedSteps[index];
                    const def = STEP_TYPES.find((t) => t.type === s?.type);
                    const colors = COLOR_MAP[def?.color ?? "blue"];
                    const Icon = def?.icon ?? Play;

                    // Progress circle state for this step
                    const isActive = execProgress?.activeIdx === index;
                    const isDone = execProgress && index in execProgress.doneMap;
                    const doneOk = isDone ? execProgress!.doneMap[index] : null;
                    const isPending = execProgress && !isActive && !isDone;

                    return (
                      <div key={field.id} className={`border rounded-md overflow-hidden transition-all ${isActive ? "ring-2 ring-primary/40 shadow-sm" : ""}`}>
                        {/* Step header */}
                        <div className={`flex items-center gap-2 px-3 py-2 border-b ${isActive ? "bg-primary/10" : colors.bg}`}>
                          <div className="flex flex-col gap-0.5 shrink-0">
                            <Button type="button" variant="ghost" size="icon" className="h-4 w-5 p-0" disabled={index === 0} onClick={() => moveStep(index, index - 1)}><ArrowUp className="h-3 w-3" /></Button>
                            <Button type="button" variant="ghost" size="icon" className="h-4 w-5 p-0" disabled={index === stepFields.length - 1} onClick={() => moveStep(index, index + 1)}><ArrowDown className="h-3 w-3" /></Button>
                          </div>

                          {/* Progress circle indicator */}
                          <div className="shrink-0 flex items-center justify-center w-5 h-5">
                            {isActive ? (
                              <Loader2 className="h-4 w-4 text-primary animate-spin" />
                            ) : isDone && doneOk ? (
                              <div className="h-4 w-4 rounded-full bg-green-500 flex items-center justify-center">
                                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 text-white fill-none stroke-white stroke-[1.5]"><polyline points="2,5 4,7.5 8,3" /></svg>
                              </div>
                            ) : isDone && !doneOk ? (
                              <div className="h-4 w-4 rounded-full bg-amber-400 flex items-center justify-center">
                                <span className="text-white text-[9px] font-bold leading-none">!</span>
                              </div>
                            ) : isPending ? (
                              <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/25" />
                            ) : (
                              <div className={`w-1.5 h-5 rounded-full ${colors.bar}`} />
                            )}
                          </div>

                          <Icon className="h-3.5 w-3.5 shrink-0 text-foreground/60" />
                          <span className="text-xs font-semibold flex-1">步骤 {index + 1}：{def?.label}</span>
                          <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeStep(index)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>

                        {/* Step body */}
                        <div className="px-3 py-3 space-y-2 bg-card">
                          {s?.type === "click" && <>
                            <Field label="点击元素选择器">
                              <Input placeholder="例：.refresh-btn 或 #submit" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.selector`)} />
                            </Field>
                            <Field label="点击后额外等待（毫秒）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.waitMs`, { valueAsNumber: true })} />
                            </Field>
                            <FormField control={form.control} name={`steps.${index}.waitForPopupClose` as never} render={({ field }) => (
                              <FormItem className="flex items-center gap-2 rounded border p-2 bg-amber-50/40">
                                <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                                <FormLabel className="text-xs cursor-pointer m-0 flex items-center gap-1">
                                  <ExternalLink className="h-3 w-3 text-amber-600" />点后会弹出后台窗口，等它自动关闭
                                </FormLabel>
                              </FormItem>
                            )} />
                          </>}

                          {s?.type === "capture" && <>
                            <Field label="要读取的元素选择器">
                              <Input placeholder="例：#shortid 或 .price-value" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.selector`)} />
                            </Field>
                            <Field label="保存为变量名">
                              <Input placeholder="例：邮箱 或 当前价格" className="text-xs h-7"
                                {...form.register(`steps.${index}.varName`)} />
                            </Field>
                            <p className="text-xs text-muted-foreground bg-teal-50 border border-teal-200 rounded px-2 py-1.5">
                              保存后，在"输入文字"步骤里用 <code className="font-mono">{"${变量名}"}</code> 引用这个值
                            </p>
                          </>}

                          {s?.type === "navigate" && <>
                            <Field label="跳转到的网址">
                              <Input placeholder="例：https://b-website.com/form" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.url`)} />
                            </Field>
                            <Field label="跳转后等待页面加载（毫秒）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.waitMs`, { valueAsNumber: true })} />
                            </Field>
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input type="checkbox" className="rounded"
                                {...form.register(`steps.${index}.incognito`)} />
                              <span className="text-xs font-medium">无痕跳转（隐身模式）</span>
                            </label>
                            <p className="text-xs text-muted-foreground bg-indigo-50 border border-indigo-200 rounded px-2 py-1.5">
                              ✓ 勾选后跳转时完全隔离 Cookie 和登录状态，B 网站看不到 A 网站的任何数据<br/>
                              · 之前"读取保存"的变量仍然有效，只隔离浏览器状态<br/>
                              · 每次循环结束后浏览器自动完全重置，下一轮从全新状态开始
                            </p>
                          </>}

                          {s?.type === "listen" && <>
                            <Field label="监听条件">
                              <select className="w-full border rounded px-2 py-1 text-xs bg-background"
                                {...form.register(`steps.${index}.listenFor`)}>
                                <option value="appear">等待元素出现（appear）</option>
                                <option value="disappear">等待元素消失（disappear）</option>
                                <option value="networkIdle">等待网络空闲（network idle）</option>
                              </select>
                            </Field>
                            {watchedSteps[index]?.listenFor !== "networkIdle" && (
                              <Field label="目标元素选择器">
                                <Input placeholder="例：.toast-msg 或 #result" className="font-mono text-xs h-7"
                                  {...form.register(`steps.${index}.selector`)} />
                              </Field>
                            )}
                            <Field label="最长等待时间（毫秒，超时自动继续）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.listenTimeout`, { valueAsNumber: true })} />
                            </Field>
                          </>}

                          {s?.type === "type" && <>
                            <Field label="目标输入框选择器">
                              <Input placeholder="例：#username 或 input[name=email]" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.selector`)} />
                            </Field>
                            <Field label="要输入的文字">
                              <Input placeholder='例：hello@example.com 或 ${邮箱}' className="text-xs h-7"
                                {...form.register(`steps.${index}.text`)} />
                            </Field>
                            <p className="text-xs text-muted-foreground bg-green-50 border border-green-200 rounded px-2 py-1.5">
                              用 <code className="font-mono">{"${变量名}"}</code> 引用"读取保存"步骤里存的值
                            </p>
                          </>}

                          {s?.type === "key" && <>
                            <Field label="按哪个键">
                              <div className="space-y-1.5">
                                <div className="flex flex-wrap gap-1">
                                  {COMMON_KEYS.map((k) => (
                                    <button key={k} type="button"
                                      className={`px-2 py-0.5 border rounded text-xs font-mono transition-colors ${watchedSteps[index]?.key === k ? "bg-primary text-primary-foreground border-primary" : "bg-muted hover:bg-muted/80"}`}
                                      onClick={() => form.setValue(`steps.${index}.key`, k)}>
                                      {k}
                                    </button>
                                  ))}
                                </div>
                                <Input placeholder="或手动填写，如 F5、Control+a" className="font-mono text-xs h-7"
                                  {...form.register(`steps.${index}.key`)} />
                              </div>
                            </Field>
                            <Field label="按键后等待（毫秒）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.waitMs`, { valueAsNumber: true })} />
                            </Field>
                          </>}

                          {s?.type === "select" && <>
                            <Field label="下拉框选择器">
                              <Input placeholder="例：select#city 或 .dropdown" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.selector`)} />
                            </Field>
                            <Field label="选择的选项（文字或 value）">
                              <Input placeholder="例：上海 或 shanghai" className="text-xs h-7"
                                {...form.register(`steps.${index}.value`)} />
                            </Field>
                          </>}

                          {s?.type === "scroll" && <>
                            <Field label="滚动到此元素（留空则向下滚动）">
                              <Input placeholder="例：#footer 或 .load-more" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.selector`)} />
                            </Field>
                          </>}

                          {s?.type === "hover" && <>
                            <Field label="悬停目标选择器">
                              <Input placeholder="例：.menu-item 或 #tooltip-trigger" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.selector`)} />
                            </Field>
                            <Field label="悬停后等待（毫秒）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.waitMs`, { valueAsNumber: true })} />
                            </Field>
                          </>}
                        </div>
                      </div>
                    );
                  })}

                  {/* Add step picker */}
                  <div className="relative">
                    <Button type="button" variant="outline" size="sm"
                      className="w-full text-xs h-9 border-dashed gap-2"
                      onClick={() => setAddMenuOpen((o) => !o)}>
                      <Plus className="h-4 w-4" />添加步骤
                      {addMenuOpen ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
                    </Button>
                    {addMenuOpen && (
                      <div className="absolute z-10 top-full left-0 right-0 mt-1 border rounded-lg bg-card shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                        {STEP_TYPES.map(({ type, label, icon: Icon, color, desc }) => {
                          const c = COLOR_MAP[color];
                          return (
                            <button key={type} type="button"
                              className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-muted/60 transition-colors text-left border-b last:border-b-0"
                              onClick={() => {
                                appendStep({ ...defaults[type] } as FormValues["steps"][number]);
                                setAddMenuOpen(false);
                              }}>
                              <div className={`mt-0.5 p-1.5 rounded ${c.bg} shrink-0`}>
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              <div>
                                <div className="text-xs font-medium">{label}</div>
                                <div className="text-xs text-muted-foreground">{desc}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </CardContent>

                {/* Save/load bar */}
                <div className="border-t px-4 py-3 flex items-center gap-2 bg-muted/30 flex-wrap">
                  <Button type="button" variant="outline" size="sm" className="text-xs h-7 gap-1.5" onClick={handleSave}>
                    <Save className="h-3 w-3" />保存方案
                  </Button>
                  {savedSequences.map((seq) => (
                    <div key={seq.name} className="flex items-center gap-0.5 border rounded px-2 py-0.5 bg-background text-xs">
                      <button type="button" className="hover:text-primary transition-colors" onClick={() => loadSequence(seq)}>
                        <FolderOpen className="h-3 w-3 inline mr-1" />{seq.name}
                      </button>
                      <button type="button" className="text-muted-foreground hover:text-destructive ml-1" onClick={() => deleteSequence(seq.name)}>
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Save dialog */}
              {saveDialogOpen && (
                <Card className="border-primary/40 shadow-md animate-in fade-in">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">给这套步骤起个名字</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <Input placeholder="例：刷新数据、登录操作…" value={saveName} onChange={(e) => setSaveName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmSave(); } }} autoFocus className="text-sm" />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" className="flex-1" onClick={confirmSave} disabled={!saveName.trim()}>保存</Button>
                      <Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => setSaveDialogOpen(false)}>取消</Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Custom selectors */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Crosshair className="h-4 w-4 text-primary" />抓取数据
                  </CardTitle>
                  <CardDescription className="text-xs">步骤执行完后，提取这些位置的内容</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectorFields.map((field, index) => (
                    <div key={field.id} className="flex gap-2 items-start p-3 bg-muted/30 rounded-md border">
                      <div className="flex-1 space-y-2 min-w-0">
                        <FormField control={form.control} name={`customSelectors.${index}.name`} render={({ field }) => (
                          <FormItem><FormControl><Input placeholder="名称（如：最新消息）" className="text-xs h-7" {...field} /></FormControl><FormMessage className="text-xs" /></FormItem>
                        )} />
                        <FormField control={form.control} name={`customSelectors.${index}.selector`} render={({ field }) => (
                          <FormItem><FormControl><Input placeholder="CSS选择器（如：.msg-title）" className="font-mono text-xs h-7" {...field} /></FormControl><FormMessage className="text-xs" /></FormItem>
                        )} />
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive mt-0.5" onClick={() => removeSelector(index)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" className="w-full text-xs h-8 border-dashed" onClick={() => appendSelector({ name: "", selector: "" })}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" />添加数据项
                  </Button>
                </CardContent>
              </Card>

              {/* Loop settings */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Repeat className="h-4 w-4 text-primary" />循环设置
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <FormField control={form.control} name="loopEnabled" render={({ field }) => (
                    <FormItem className="flex items-center gap-3 rounded border p-3 hover:bg-muted/40 transition-colors">
                      <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      <FormLabel className="font-medium cursor-pointer text-sm m-0">启用循环</FormLabel>
                    </FormItem>
                  )} />
                  {loopEnabled && (
                    <div className="space-y-3 pt-1">
                      <Field label="循环次数">
                        <div className="flex items-center gap-2">
                          <Input type="number" min={1} max={200} className="font-mono text-xs"
                            {...form.register("loopCount", { valueAsNumber: true })} />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">次</span>
                        </div>
                      </Field>
                      <Field label="每次间隔（毫秒）">
                        <Input type="number" min={0} className="font-mono text-xs"
                          {...form.register("loopDelayMs", { valueAsNumber: true })} />
                      </Field>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* API status + run button */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                <Activity className="h-3.5 w-3.5" />
                {health ? <><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" /></span><span className="text-green-600">API 在线</span></> : <span>检查中...</span>}
              </div>

              {loopRunning ? (
                <Button type="button" variant="destructive" className="w-full" size="lg" onClick={() => { stopLoopRef.current = true; }}>
                  <Square className="mr-2 h-4 w-4 fill-current" />停止循环
                </Button>
              ) : (
                <Button type="submit" className="w-full" size="lg" disabled={isRunning}>
                  {singlePending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />执行中...</>
                    : loopEnabled ? <><Repeat className="mr-2 h-4 w-4" />开始循环（{form.watch("loopCount")} 次）</>
                    : <><Play className="mr-2 h-4 w-4" />{triggerCount === 0 ? "执行一次" : `再执行一次（第 ${triggerCount + 1} 次）`}</>}
                </Button>
              )}
            </form>
          </Form>
        </div>

        {/* ── RIGHT ────────────────────────────────────────────────────── */}
        <div className="lg:col-span-8 space-y-4">

          {loopProgress && (
            <Card className="border-primary/30 bg-primary/5 shadow-sm animate-in fade-in">
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="font-medium">第 {loopProgress.current} / {loopProgress.total} 次</span>
                  </div>
                  <span className="text-muted-foreground text-xs">{Math.round((loopProgress.current / loopProgress.total) * 100)}%</span>
                </div>
                <Progress value={(loopProgress.current / loopProgress.total) * 100} className="h-2" />
                <p className="text-xs text-muted-foreground">随时点"停止循环"中断，已收集数据不会丢失</p>
              </CardContent>
            </Card>
          )}

          {/* Live execution vars — shown during single run or loop */}
          {execProgress && Object.keys(execProgress.liveVars).length > 0 && (
            <Card className="border-teal-300 bg-teal-50/60 shadow-sm animate-in fade-in">
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center gap-2 mb-2 text-xs font-medium text-teal-700">
                  <Crosshair className="h-3.5 w-3.5 animate-pulse" />
                  实时读取到的变量
                </div>
                <div className="space-y-1.5">
                  {Object.entries(execProgress.liveVars).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2">
                      <code className="text-xs font-mono bg-white border border-teal-200 px-1.5 py-0.5 rounded text-teal-600 shrink-0">{k}</code>
                      <span className="font-mono text-sm font-semibold text-teal-800 break-all">{v}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {triggerCount > 0 && !loopProgress && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border rounded-lg text-sm animate-in fade-in">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-medium">共 {triggerCount} 条记录</span>
                {snapshots[0] && <span className="text-muted-foreground text-xs">最后：{snapshots[0].triggeredAt} · {snapshots[0].duration}ms</span>}
              </div>
              <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground" onClick={() => { setSnapshots([]); setTriggerCount(0); }}>清空</Button>
            </div>
          )}

          {/* Captured vars tracking */}
          {snapshots.length > 0 && (() => {
            const allVarNames = Array.from(new Set(snapshots.flatMap(s => Object.keys(s.result.capturedVars ?? {}))));
            if (allVarNames.length === 0) return null;
            return (
              <Card className="border-teal-200 shadow-sm animate-in fade-in">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base"><Crosshair className="h-4 w-4 text-teal-600" />读取到的变量</CardTitle>
                  <CardDescription className="text-xs">由"读取保存"步骤抓取的实时数据</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {allVarNames.map((varName) => {
                    const history = snapshots.map(s => ({ time: s.triggeredAt, iteration: s.iteration, value: (s.result.capturedVars ?? {})[varName] ?? "" })).filter(e => e.value);
                    const latest = history[0];
                    const changed = history.length > 1 && history[0].value !== history[1].value;
                    return (
                      <div key={varName} className="border border-teal-200 rounded-md overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-teal-50/60 border-b border-teal-200 flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{varName}</span>
                            <code className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">${"{" + varName + "}"}</code>
                          </div>
                          {changed && <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200">有变化</Badge>}
                        </div>
                        <div className="px-3 py-2.5 border-b">
                          <p className="text-xs text-muted-foreground mb-1">最新值</p>
                          {latest?.value
                            ? <div className="font-mono text-base font-semibold text-teal-700">{latest.value}</div>
                            : <span className="text-xs text-muted-foreground">暂无数据</span>}
                        </div>
                        {history.length > 1 && (
                          <div className="px-3 py-2 bg-muted/10">
                            <p className="text-xs text-muted-foreground mb-1.5">历史（{history.length} 次）</p>
                            <div className="space-y-1 max-h-36 overflow-y-auto">
                              {history.map((e, ei) => (
                                <div key={ei} className="flex items-center gap-2 text-xs">
                                  <span className="text-muted-foreground font-mono w-16 shrink-0">{e.time}</span>
                                  {e.iteration && <span className="text-muted-foreground shrink-0">#{e.iteration}</span>}
                                  <span className={`font-mono ${ei === 0 ? "font-medium text-teal-700" : "text-muted-foreground"}`}>{e.value || "—"}</span>
                                  {ei === 0 && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 ml-auto shrink-0">最新</Badge>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })()}

          {/* Data tracking */}
          {form.watch("customSelectors").length > 0 && snapshots.length > 0 && (
            <Card className="border-border/50 shadow-sm animate-in fade-in">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-primary" />数据汇总</CardTitle>
                <CardDescription className="text-xs">自定义数据项的最新值与历史变化</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {form.getValues("customSelectors").map((cs, csIdx) => {
                  const all = snapshots.map((s) => ({ time: s.triggeredAt, iteration: s.iteration, values: s.result.customResults?.find((r) => r.selector === cs.selector)?.values ?? [] }));
                  const latest = all[0];
                  const changed = all.length > 1 && JSON.stringify(all[0]?.values) !== JSON.stringify(all[1]?.values);
                  return (
                    <div key={csIdx} className="border rounded-md overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b flex-wrap gap-2">
                        <div className="flex items-center gap-2"><Crosshair className="h-3.5 w-3.5 text-primary shrink-0" /><span className="font-medium text-sm">{cs.name}</span><code className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{cs.selector}</code></div>
                        {changed && <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200">有变化</Badge>}
                      </div>
                      <div className="px-3 py-2.5 border-b">
                        <p className="text-xs text-muted-foreground mb-1">最新值</p>
                        {!latest?.values.length ? <span className="text-xs text-muted-foreground">未找到（可能在 iframe 或需要登录）</span>
                          : latest.values.map((v, vi) => <div key={vi} className="font-mono text-sm font-medium">{v}</div>)}
                      </div>
                      {all.length > 1 && (
                        <div className="px-3 py-2 bg-muted/10">
                          <p className="text-xs text-muted-foreground mb-1.5">历史（{all.length} 次）</p>
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {all.map((e, ei) => (
                              <div key={ei} className="flex items-start gap-2 text-xs">
                                <span className="text-muted-foreground font-mono w-16 shrink-0">{e.time}</span>
                                {e.iteration && <span className="text-muted-foreground shrink-0">#{e.iteration}</span>}
                                <span className={`font-mono ${ei === 0 ? "font-medium" : "text-muted-foreground"}`}>{e.values.length ? e.values.join(" / ") : "—"}</span>
                                {ei === 0 && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 ml-auto shrink-0">最新</Badge>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Snapshot list */}
          {snapshots.length > 0 ? (
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4 text-primary" />执行记录</CardTitle>
                <CardDescription className="text-xs">点击展开查看每次抓取的完整内容</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {snapshots.map((snap, idx) => {
                  const isExpanded = expandedSnapshots.has(snap.id);
                  const r = snap.result;
                  const total = (r.headings?.length || 0) + (r.links?.length || 0) + (r.paragraphs?.length || 0) + (r.images?.length || 0) + (r.metaTags?.length || 0) + (r.customResults ?? []).reduce((s, cr) => s + cr.values.length, 0);
                  return (
                    <div key={snap.id} className={`border-t first:border-t-0 ${idx === 0 ? "bg-muted/10" : ""}`}>
                      <button type="button" className="w-full flex items-center justify-between px-6 py-3 hover:bg-muted/20 transition-colors text-left" onClick={() => { const n = new Set(expandedSnapshots); n.has(snap.id) ? n.delete(snap.id) : n.add(snap.id); setExpandedSnapshots(n); }}>
                        <div className="flex items-center gap-3">
                          <div className={`h-2 w-2 rounded-full shrink-0 ${idx === 0 ? "bg-primary" : "bg-muted-foreground/30"}`} />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {snap.iteration && snap.loopTotal ? <span className="font-medium text-sm">第 {snap.iteration}/{snap.loopTotal} 次循环</span> : <span className="font-medium text-sm">第 {snapshots.length - idx} 次执行</span>}
                              {idx === 0 && <Badge variant="outline" className="text-xs px-1.5 py-0 h-4">最新</Badge>}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">{snap.triggeredAt} · {snap.duration}ms · {total} 项</div>
                          </div>
                        </div>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                      </button>
                      {isExpanded && (
                        <div className="px-6 pb-4 animate-in fade-in slide-in-from-top-2 duration-200 space-y-2 mt-2">
                          {/* Captured variables for this snapshot */}
                          {r.capturedVars && Object.keys(r.capturedVars).length > 0 && (
                            <div className="border border-teal-200 rounded-md overflow-hidden">
                              <div className="px-3 py-2 bg-teal-50/60 border-b border-teal-200 flex items-center gap-2">
                                <Crosshair className="h-3.5 w-3.5 text-teal-600" />
                                <span className="font-medium text-xs text-teal-700">读取保存的变量</span>
                              </div>
                              {Object.entries(r.capturedVars).map(([k, v]) => (
                                <div key={k} className="px-3 py-2 border-b last:border-b-0 flex items-center gap-3">
                                  <code className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{k}</code>
                                  <span className="font-mono text-sm font-medium text-teal-700">{v}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Custom selector results */}
                          {r.customResults && r.customResults.length > 0 ? (
                            <div className="space-y-2">
                              {r.customResults.map((cr, i) => (
                                <div key={i} className="border rounded-md overflow-hidden">
                                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b"><span className="font-medium text-xs">{cr.name}</span><code className="text-xs font-mono text-muted-foreground">{cr.selector}</code></div>
                                  {cr.values.map((v, vi) => <div key={vi} className="px-3 py-2 font-mono text-sm border-b last:border-b-0">{v}</div>)}
                                  {!cr.values.length && <div className="px-3 py-2 text-xs text-muted-foreground">未找到匹配内容</div>}
                                </div>
                              ))}
                            </div>
                          ) : !r.capturedVars || Object.keys(r.capturedVars).length === 0 ? (
                            <p className="text-xs text-muted-foreground">没有配置自定义数据项，或未找到匹配内容</p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : !isRunning && (
            <div className="flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg bg-muted/5 p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Play className="h-8 w-8 opacity-40" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">搭好步骤，一键执行</h3>
              <p className="text-sm max-w-sm mb-6">点击"添加步骤"，选择要执行的操作类型，排好顺序，保存为方案，支持循环自动运行。</p>
              <div className="flex items-center gap-4 text-xs font-mono opacity-50">
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />9 种操作类型</div>
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />保存复用</div>
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />支持循环</div>
              </div>
            </div>
          )}

          {isRunning && !loopProgress && (
            <Card className="flex flex-col items-center justify-center py-16 border-dashed border-2 bg-muted/10 animate-in fade-in">
              <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
              <h3 className="text-base font-medium mb-1">正在执行步骤序列</h3>
              <p className="text-sm text-muted-foreground">浏览器正在按顺序模拟操作...</p>
            </Card>
          )}
        </div>
      </div>
    </div>

    {/* ── Visual Recorder Overlay ─────────────────────────────────────────── */}
    {isRecording && (
      <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm animate-in fade-in">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border-b bg-background shadow-sm shrink-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
            <span className="text-xs sm:text-sm font-semibold text-red-600">录制中</span>
          </div>
          <div className="flex-1 flex items-center gap-1.5 min-w-0">
            <Link2 className="h-3 w-3 text-muted-foreground shrink-0 hidden sm:block" />
            <span className="text-[10px] sm:text-xs text-muted-foreground font-mono truncate">
              {sessionCurrentUrl || "连接中…"}
            </span>
          </div>
          {sessionLoading && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="hidden sm:inline">启动浏览器…</span>
            </div>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 sm:w-auto sm:px-3 sm:gap-1.5 text-muted-foreground shrink-0" onClick={() => stopRecording()}>
            <X className="h-4 w-4" /><span className="hidden sm:inline">关闭</span>
          </Button>
          <Button type="button" variant="destructive" size="sm" className="h-7 px-2 sm:px-3 gap-1.5 shrink-0 text-xs" onClick={() => stopRecording()}>
            <StopCircle className="h-3.5 w-3.5" /><span className="hidden xs:inline">停止</span>
          </Button>
        </div>

        {/* Main content: remote browser + step log */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Remote browser canvas */}
          <div className="flex-1 relative bg-black min-h-0 flex flex-col" style={{ minHeight: 0 }}>
            {/* Screenshot area with click/scroll overlay */}
            <div className="relative flex-1 min-h-0" style={{ aspectRatio: "16/9", maxHeight: "calc(100% - 88px)" }}>
              {sessionLoading || !screenshotUrl ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900">
                  <Loader2 className="h-8 w-8 animate-spin text-white/50" />
                  <span className="text-sm text-white/50">正在启动浏览器…</span>
                </div>
              ) : (
                <img
                  src={screenshotUrl}
                  alt="远程浏览器"
                  className="absolute inset-0 w-full h-full"
                  style={{ objectFit: "fill", imageRendering: "auto" }}
                  draggable={false}
                />
              )}
              {/* Invisible overlay — captures clicks and scrolls */}
              <div
                ref={overlayRef}
                className="absolute inset-0 cursor-crosshair"
                onClick={handleOverlayClick}
                onWheel={handleOverlayScroll}
              />
            </div>

            {/* Keyboard / type bar */}
            <div className="shrink-0 bg-zinc-900 border-t border-zinc-700 px-2 py-1.5 space-y-1.5">
              {/* Common keys */}
              <div className="flex flex-wrap gap-1">
                {[
                  { label: "⏎ Enter",  key: "Enter" },
                  { label: "⇥ Tab",    key: "Tab" },
                  { label: "Esc",      key: "Escape" },
                  { label: "⌫",        key: "Backspace" },
                  { label: "↑",        key: "ArrowUp" },
                  { label: "↓",        key: "ArrowDown" },
                  { label: "←",        key: "ArrowLeft" },
                  { label: "→",        key: "ArrowRight" },
                  { label: "PgDn",     key: "PageDown" },
                  { label: "PgUp",     key: "PageUp" },
                ].map(({ label, key }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => sendKey(key)}
                    className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-700 text-zinc-200 hover:bg-zinc-600 active:bg-zinc-500 border border-zinc-600 transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* Type input */}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={typeText}
                  onChange={e => setTypeText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") { e.preventDefault(); sendType(); }
                  }}
                  placeholder="输入文字 → 回车发送"
                  className="flex-1 min-w-0 px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-100 border border-zinc-600 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400"
                />
                <button
                  type="button"
                  onClick={sendType}
                  className="px-3 py-1 text-xs rounded bg-zinc-600 text-zinc-100 hover:bg-zinc-500 border border-zinc-500 whitespace-nowrap"
                >
                  发送
                </button>
              </div>
            </div>
          </div>

          {/* Step log panel — collapsible */}
          <div className={`
            border-t md:border-t-0 md:border-l flex flex-col bg-muted/20 shrink-0 transition-all duration-200
            ${panelCollapsed
              ? "w-full md:w-10 max-h-12 md:max-h-none overflow-hidden"
              : "w-full md:w-72 lg:w-80 max-h-[42vh] md:max-h-none"
            }
          `}>
            {/* Panel header — always visible */}
            <div className="flex items-center justify-between px-3 py-2 border-b bg-background shrink-0">
              {!panelCollapsed && (
                <div className="flex items-center gap-2 text-sm font-medium min-w-0">
                  <Activity className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate">已录制</span>
                  <Badge variant="secondary" className="font-mono text-xs shrink-0">
                    {recordedSteps.length}
                  </Badge>
                </div>
              )}
              {panelCollapsed && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground md:flex-col md:gap-0">
                  <Activity className="h-3.5 w-3.5 text-primary" />
                  <span className="font-mono md:hidden">{recordedSteps.length} 步</span>
                </div>
              )}
              <div className={`flex items-center gap-1 shrink-0 ${panelCollapsed ? "ml-auto" : ""}`}>
                {!panelCollapsed && recordedSteps.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground"
                    onClick={() => setRecordedSteps((s) => s.slice(0, -1))}>
                    <Undo2 className="h-3 w-3" />
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground"
                  onClick={() => setPanelCollapsed(c => !c)}
                  title={panelCollapsed ? "展开步骤面板" : "收起步骤面板"}
                >
                  {panelCollapsed
                    ? <ChevronUp className="h-3.5 w-3.5 md:rotate-90" />
                    : <ChevronDown className="h-3.5 w-3.5 md:rotate-90" />
                  }
                </Button>
              </div>
            </div>

            {/* Panel body — hidden when collapsed */}
            {!panelCollapsed && (
              <>
                <ScrollArea className="flex-1 min-h-0">
                  {recordedSteps.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                      <MousePointerClick className="h-7 w-7 text-muted-foreground/30 mb-2" />
                      <p className="text-xs text-muted-foreground">点击页面元素，操作自动记录在这里</p>
                    </div>
                  ) : (
                    <div className="p-2 space-y-1.5">
                      {recordedSteps.map((rs, i) => {
                        const stepDef = rs.type === "click"
                          ? { label: "点击", icon: MousePointerClick, color: "blue" }
                          : rs.type === "type"
                          ? { label: "输入", icon: Type, color: "green" }
                          : { label: "选择", icon: ListOrdered, color: "cyan" };
                        const colors = COLOR_MAP[stepDef.color];
                        const Icon = stepDef.icon;
                        return (
                          <div key={rs.id} className={`rounded-md border p-2 ${colors.bg} ${colors.border} animate-in slide-in-from-bottom-1`}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[10px] font-mono text-muted-foreground w-4 shrink-0">{i + 1}</span>
                              <Icon className="h-3 w-3 shrink-0 text-foreground/60" />
                              <span className="text-xs font-semibold">{stepDef.label}</span>
                              {rs.navigatedTo && (
                                <span className="text-[10px] text-indigo-500 ml-auto shrink-0">→ 跳页</span>
                              )}
                            </div>
                            <code className="text-[10px] font-mono text-foreground/60 break-all leading-tight block ml-5">
                              {rs.selector}
                            </code>
                            {(rs.text || rs.label) && (
                              <span className="text-[10px] text-muted-foreground ml-5 block truncate">
                                {rs.text ? `"${rs.text}"` : rs.label}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>

                {/* Apply footer */}
                <div className="p-2.5 border-t bg-background shrink-0 space-y-1.5">
                  {recordedSteps.length > 0 ? (
                    <Button type="button" className="w-full gap-2 h-8 text-sm" onClick={applyRecordedSteps}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      应用 {recordedSteps.length} 个步骤
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" className="w-full h-8 text-sm" onClick={stopRecording}>
                      取消录制
                    </Button>
                  )}
                  <p className="text-[10px] text-muted-foreground text-center leading-tight">
                    应用后可在步骤列表中编辑调整
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-6 text-muted-foreground">
      <AlertCircle className="h-4 w-4 mr-2 opacity-50" /><span className="text-xs">{message}</span>
    </div>
  );
}
