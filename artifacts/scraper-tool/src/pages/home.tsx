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
  Video, StopCircle, Undo2, Link2, Download, Upload,
  RefreshCw, Camera, ChevronRight, MousePointer2, ArrowLeftRight,
} from "lucide-react";
import type { ScrapeResult } from "@workspace/api-client-react/src/generated/api.schemas";

// ─── Recorder types ───────────────────────────────────────────────────────────
type RecordedStep = {
  id: string;
  type: string;
  selector?: string;
  url?: string;
  text?: string;
  key?: string;
  value?: string;
  waitMs?: number;
  tabIndex?: number;
  listenFor?: string;
  listenTimeout?: number;
  varName?: string;
  incognito?: boolean;
  label?: string;
  navigatedTo?: string;
};

// ─── Step definitions ────────────────────────────────────────────────────────

const STEP_TYPES = [
  { type: "click",       label: "点击",     icon: MousePointerClick, color: "blue",    desc: "点击页面上的某个按钮或链接" },
  { type: "doubleclick", label: "双击",     icon: MousePointer2,     color: "blue",    desc: "双击元素（展开节点、进入编辑等）" },
  { type: "rightclick",  label: "右键",     icon: MousePointerClick, color: "rose",    desc: "在元素上按鼠标右键，调出上下文菜单" },
  { type: "type",        label: "输入文字", icon: Type,              color: "green",   desc: "在输入框填入文字，支持 ${变量名} 引用保存的值" },
  { type: "key",         label: "按键",     icon: Keyboard,          color: "orange",  desc: "模拟键盘按键，如回车、Tab" },
  { type: "select",      label: "下拉选择", icon: ListOrdered,       color: "cyan",    desc: "选择下拉框中的某个选项" },
  { type: "scroll",      label: "滚动",     icon: MoveDown,          color: "pink",    desc: "滚动到指定元素位置" },
  { type: "hover",       label: "悬停",     icon: Eye,               color: "yellow",  desc: "将鼠标悬停在元素上" },
  { type: "navigate",    label: "跳转网址", icon: Globe,             color: "indigo",  desc: "在同一浏览器内跳转到另一个网址" },
  { type: "goback",      label: "后退",     icon: Undo2,             color: "slate",   desc: "浏览器后退到上一个页面（等同于点后退按钮）" },
  { type: "goforward",   label: "前进",     icon: ChevronRight,      color: "slate",   desc: "浏览器前进到下一个页面" },
  { type: "reload",      label: "刷新",     icon: RefreshCw,         color: "sky",     desc: "刷新当前页面，重新加载内容" },
  { type: "wait",        label: "等待",     icon: Timer,             color: "amber",   desc: "暂停指定毫秒数，等待页面动画或延迟渲染" },
  { type: "listen",      label: "监听",     icon: Eye,               color: "purple",  desc: "等到某个元素出现/消失，或网络空闲" },
  { type: "capture",     label: "读取保存", icon: Crosshair,         color: "teal",    desc: "读取元素内容，保存为变量供后续步骤使用" },
  { type: "screenshot",  label: "截图记录", icon: Camera,            color: "violet",  desc: "在此处暂停并记录截图状态（实时监控可见）" },
  { type: "newtab",     label: "新建标签页", icon: Globe,            color: "indigo",  desc: "在同一浏览器内新开一个标签页，并切换到该标签" },
  { type: "switchtab",  label: "切换标签页", icon: ArrowLeftRight,   color: "sky",     desc: "切换到指定编号的标签页（从 0 开始）" },
  { type: "closetab",   label: "关闭标签页", icon: X,               color: "rose",    desc: "关闭当前标签页，自动切换回上一个标签" },
] as const;

type StepType = typeof STEP_TYPES[number]["type"];

const COLOR_MAP: Record<string, { bg: string; border: string; bar: string; btn: string }> = {
  blue:   { bg: "bg-blue-50/60",   border: "border-blue-200",   bar: "bg-blue-400",   btn: "text-blue-600 border-blue-200 hover:bg-blue-50"     },
  purple: { bg: "bg-purple-50/60", border: "border-purple-200", bar: "bg-purple-400", btn: "text-purple-600 border-purple-200 hover:bg-purple-50" },
  teal:   { bg: "bg-teal-50/60",   border: "border-teal-200",   bar: "bg-teal-400",   btn: "text-teal-600 border-teal-200 hover:bg-teal-50"     },
  indigo: { bg: "bg-indigo-50/60", border: "border-indigo-200", bar: "bg-indigo-400", btn: "text-indigo-600 border-indigo-200 hover:bg-indigo-50" },
  green:  { bg: "bg-green-50/60",  border: "border-green-200",  bar: "bg-green-400",  btn: "text-green-600 border-green-200 hover:bg-green-50"   },
  orange: { bg: "bg-orange-50/60", border: "border-orange-200", bar: "bg-orange-400", btn: "text-orange-600 border-orange-200 hover:bg-orange-50" },
  cyan:   { bg: "bg-cyan-50/60",   border: "border-cyan-200",   bar: "bg-cyan-400",   btn: "text-cyan-600 border-cyan-200 hover:bg-cyan-50"     },
  pink:   { bg: "bg-pink-50/60",   border: "border-pink-200",   bar: "bg-pink-400",   btn: "text-pink-600 border-pink-200 hover:bg-pink-50"     },
  yellow: { bg: "bg-yellow-50/60", border: "border-yellow-200", bar: "bg-yellow-400", btn: "text-yellow-600 border-yellow-200 hover:bg-yellow-50" },
  rose:   { bg: "bg-rose-50/60",   border: "border-rose-200",   bar: "bg-rose-400",   btn: "text-rose-600 border-rose-200 hover:bg-rose-50"     },
  slate:  { bg: "bg-slate-50/60",  border: "border-slate-200",  bar: "bg-slate-400",  btn: "text-slate-600 border-slate-200 hover:bg-slate-50"   },
  sky:    { bg: "bg-sky-50/60",    border: "border-sky-200",    bar: "bg-sky-400",    btn: "text-sky-600 border-sky-200 hover:bg-sky-50"         },
  amber:  { bg: "bg-amber-50/60",  border: "border-amber-200",  bar: "bg-amber-400",  btn: "text-amber-600 border-amber-200 hover:bg-amber-50"   },
  violet: { bg: "bg-violet-50/60", border: "border-violet-200", bar: "bg-violet-400", btn: "text-violet-600 border-violet-200 hover:bg-violet-50" },
};

const COMMON_KEYS = ["Enter", "Tab", "Escape", "Space", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Backspace"];

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const stepSchema = z.object({
  type: z.enum(["click", "listen", "type", "key", "select", "scroll", "hover", "navigate", "capture", "goback", "goforward", "reload", "wait", "screenshot", "rightclick", "doubleclick", "newtab", "switchtab", "closetab"]),
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
  tabIndex: z.number().optional(),
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

interface SavedSequence {
  name: string;
  steps: Step[];
  savedAt: string;
  url?: string;
  loopEnabled?: boolean;
  loopCount?: number;
  loopDelayMs?: number;
}
const STORAGE_KEY = "scraper-sequences-v3";
const loadSequences = (): SavedSequence[] => {
  try {
    // Migrate from v2
    const v2 = localStorage.getItem("scraper-sequences-v2");
    const v3 = localStorage.getItem(STORAGE_KEY);
    if (!v3 && v2) {
      const migrated = JSON.parse(v2) as SavedSequence[];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return JSON.parse(v3 || "[]");
  } catch { return []; }
};
const persistSequences = (s: SavedSequence[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(s));

// ─── Snapshot ────────────────────────────────────────────────────────────────

interface Snapshot { id: string; iteration?: number; loopTotal?: number; triggeredAt: string; duration: number; result: ScrapeResult; }
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Default step factories ───────────────────────────────────────────────────

const defaults: Record<StepType, Partial<Step>> = {
  click:       { type: "click",       selector: "", waitMs: 1000, waitForPopupClose: false, popupTimeoutMs: 30000 },
  doubleclick: { type: "doubleclick", selector: "", waitMs: 500 },
  rightclick:  { type: "rightclick",  selector: "", waitMs: 500 },
  listen:      { type: "listen",      selector: "", listenFor: "appear", listenTimeout: 15000 },
  capture:     { type: "capture",     selector: "", varName: "" },
  navigate:    { type: "navigate",    url: "", waitMs: 1500, incognito: true },
  goback:      { type: "goback",      waitMs: 1500 },
  goforward:   { type: "goforward",   waitMs: 1500 },
  reload:      { type: "reload",      waitMs: 1500 },
  wait:        { type: "wait",        waitMs: 2000 },
  screenshot:  { type: "screenshot",  waitMs: 800 },
  newtab:      { type: "newtab",      url: "", waitMs: 1500 },
  switchtab:   { type: "switchtab",   tabIndex: 0, waitMs: 500 },
  closetab:    { type: "closetab",    waitMs: 500 },
  type:        { type: "type",        selector: "", text: "" },
  key:         { type: "key",         key: "Enter", waitMs: 500 },
  select:      { type: "select",      selector: "", value: "" },
  scroll:      { type: "scroll",      selector: "" },
  hover:       { type: "hover",       selector: "", waitMs: 500 },
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
  const abortRef = useRef<AbortController | null>(null);
  const snapshotIdRef = useRef(0);
  const [execProgress, setExecProgress] = useState<{
    activeIdx: number | null;
    doneMap: Record<number, boolean>;
    liveVars: Record<string, string>;
  } | null>(null);
  const [watchId, setWatchId] = useState<string | null>(null);
  const [watchShot, setWatchShot] = useState("");
  const [watchUrl, setWatchUrl] = useState("");
  const watchEsRef = useRef<EventSource | null>(null);

  // ── Recorder state ────────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSteps, setRecordedSteps] = useState<RecordedStep[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [sessionCurrentUrl, setSessionCurrentUrl] = useState("");
  const [sessionLoading, setSessionLoading] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [recFormType, setRecFormType] = useState<string | null>(null);
  const [recFormValues, setRecFormValues] = useState<Record<string, string | number>>({});
  const [recStepPending, setRecStepPending] = useState(false);
  const [recTabCount, setRecTabCount] = useState(1);
  const [recPickedSelector, setRecPickedSelector] = useState<string | null>(null);
  const [recPickedLabel, setRecPickedLabel] = useState<string>("");
  const [recVars, setRecVars] = useState<Record<string, string>>({});
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
    const v = form.getValues();
    const seq: SavedSequence = {
      name,
      steps: v.steps as Step[],
      url: v.url,
      loopEnabled: v.loopEnabled,
      loopCount: v.loopCount,
      loopDelayMs: v.loopDelayMs,
      savedAt: new Date().toLocaleString("zh-CN"),
    };
    const updated = [seq, ...savedSequences.filter((s) => s.name !== name)];
    setSavedSequences(updated); persistSequences(updated); setSaveDialogOpen(false);
    toast({ title: `已保存"${name}"`, description: "网址、步骤和循环设置均已保存" });
  };
  const loadSequence = (seq: SavedSequence) => {
    form.setValue("steps", seq.steps as FormValues["steps"]);
    if (seq.url) form.setValue("url", seq.url);
    if (seq.loopEnabled !== undefined) form.setValue("loopEnabled", seq.loopEnabled);
    if (seq.loopCount !== undefined) form.setValue("loopCount", seq.loopCount);
    if (seq.loopDelayMs !== undefined) form.setValue("loopDelayMs", seq.loopDelayMs);
    toast({ title: `已加载"${seq.name}"`, description: seq.url ? `网址：${seq.url}` : undefined });
  };
  const deleteSequence = (name: string) => { const u = savedSequences.filter((s) => s.name !== name); setSavedSequences(u); persistSequences(u); };

  // ── Export / Import ────────────────────────────────────────────────────────
  const importFileRef = useRef<HTMLInputElement>(null);

  const exportSequences = () => {
    if (savedSequences.length === 0) { toast({ title: "没有可导出的方案", variant: "destructive" }); return; }
    const blob = new Blob([JSON.stringify(savedSequences, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scraper-sequences-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `已导出 ${savedSequences.length} 个方案` });
  };

  const importSequences = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as SavedSequence[];
        if (!Array.isArray(data)) throw new Error("格式不正确");
        // Merge: imported sequences override existing ones with same name
        const merged = [...data];
        savedSequences.forEach((s) => { if (!merged.find((m) => m.name === s.name)) merged.push(s); });
        setSavedSequences(merged);
        persistSequences(merged);
        toast({ title: `已导入 ${data.length} 个方案`, description: "同名方案已覆盖" });
      } catch {
        toast({ title: "导入失败", description: "文件格式不正确，请选择之前导出的 JSON 文件", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

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
    onEvent: (e: { t: string; [k: string]: unknown }) => void,
    signal?: AbortSignal,
  ): Promise<ScrapeResult> => {
    const resp = await fetch("/api/scrape/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
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
    setRecFormType(null);
    setRecFormValues({});
    setRecTabCount(1);
    setRecPickedSelector(null);
    setRecPickedLabel("");
    setRecVars({});
  }, [sessionId]);

  const connectStream = useCallback((sid: string) => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
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
  }, []);

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
      connectStream(sid);
    } catch (err) {
      toast({ title: "启动录制失败", description: String(err), variant: "destructive" });
      stopRecording(null);
    }
  }, [form, toast, stopRecording]);

  // Step types that execute immediately on page click (selector auto-detected + action run)
  const CLICK_PICK_TYPES = ["click", "doubleclick", "rightclick", "hover"] as const;
  type ClickPickType = typeof CLICK_PICK_TYPES[number];

  // Step types that first detect the selector by clicking, then show a mini-form for remaining fields
  const PICK_THEN_FILL_TYPES = ["type", "select", "scroll", "capture", "listen"] as const;

  // ── Click at coords (auto-detects CSS selector) ──────────────────────────
  const sendClickAtCoords = useCallback(async (action: ClickPickType, x: number, y: number) => {
    if (!sessionId) return;
    setRecStepPending(true);
    try {
      const resp = await fetch(`/api/record/session/${sessionId}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, x, y }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json() as { step: RecordedStep; url: string; tabCount: number };
      const newId = String(++recStepIdRef.current);
      setRecordedSteps(s => [...s, { id: newId, ...result.step }]);
      if (result.url) setSessionCurrentUrl(result.url);
      if (result.tabCount) setRecTabCount(result.tabCount);
      // Keep the same action selected so user can keep clicking more elements
    } catch (err) {
      toast({ title: "操作失败", description: String(err), variant: "destructive" });
    } finally {
      setRecStepPending(false);
    }
  }, [sessionId, toast]);

  // ── Detect element at coords without executing any action ────────────────
  const detectSelectorAtCoords = useCallback(async (x: number, y: number) => {
    if (!sessionId) return;
    setRecStepPending(true);
    try {
      const resp = await fetch(`/api/record/session/${sessionId}/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const { selector, label } = await resp.json() as { selector: string; label: string };
      setRecPickedSelector(selector || "");
      setRecPickedLabel(label || "");
      // Pre-fill the selector field in the form so user can edit if needed
      setRecFormValues(prev => ({ ...prev, selector: selector || "" }));
    } catch (err) {
      toast({ title: "识别失败", description: String(err), variant: "destructive" });
    } finally {
      setRecStepPending(false);
    }
  }, [sessionId, toast]);

  // ── Send a step to backend (execute + record) ────────────────────────────
  const sendStep = useCallback(async (stepPayload: Omit<RecordedStep, "id">) => {
    if (!sessionId) return;
    setRecStepPending(true);
    try {
      const resp = await fetch(`/api/record/session/${sessionId}/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stepPayload),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json() as { ok: boolean; step: RecordedStep; url: string; tabCount: number; vars?: Record<string, string> };
      const newId = String(++recStepIdRef.current);
      setRecordedSteps((s) => [...s, { id: newId, ...result.step }]);
      if (result.url) setSessionCurrentUrl(result.url);
      if (result.tabCount) setRecTabCount(result.tabCount);
      if (result.vars) setRecVars(result.vars);
      setRecFormType(null);
      setRecFormValues({});
      if (!result.ok) toast({ title: "步骤执行失败", description: "选择器或参数可能有误，已记录供参考", variant: "destructive" });
    } catch (err) {
      toast({ title: "发送失败", description: String(err), variant: "destructive" });
    } finally {
      setRecStepPending(false);
    }
  }, [sessionId, toast]);

  const copyPageText = useCallback(async () => {
    if (!sessionId) return;
    try {
      const resp = await fetch(`/api/record/session/${sessionId}/text`);
      const { text } = await resp.json() as { text: string };
      await navigator.clipboard.writeText(text);
      toast({ title: "已复制页面文字", description: `共 ${text.length} 个字符` });
    } catch {
      toast({ title: "提取失败", variant: "destructive" });
    }
  }, [sessionId, toast]);

  const applyRecordedSteps = useCallback(() => {
    recordedSteps.forEach((rs) => {
      // Map every recorded step directly to a form step — all fields are compatible
      const { id: _id, label: _label, navigatedTo: _nav, ...rest } = rs;
      appendStep(rest as FormValues["steps"][number]);
    });
    stopRecording();
    toast({ title: `已添加 ${recordedSteps.length} 个步骤`, description: "可在左侧步骤列表中查看和调整" });
  }, [recordedSteps, appendStep, stopRecording, toast]);

  // ── Live watch helpers ────────────────────────────────────────────────────

  const openWatch = useCallback((id: string) => {
    if (watchEsRef.current) { watchEsRef.current.close(); watchEsRef.current = null; }
    setWatchShot(""); setWatchUrl("");
    const es = new EventSource(`/api/scrape/watch/${id}`);
    watchEsRef.current = es;
    es.onmessage = (e) => {
      const d = JSON.parse(e.data) as { type: string; data?: string; url?: string };
      if (d.type === "screenshot" && d.data) setWatchShot(`data:image/jpeg;base64,${d.data}`);
      if (d.url) setWatchUrl(d.url);
      if (d.type === "done") { es.close(); watchEsRef.current = null; }
    };
    es.onerror = () => { es.close(); watchEsRef.current = null; };
  }, []);

  const closeWatch = useCallback(() => {
    if (watchEsRef.current) { watchEsRef.current.close(); watchEsRef.current = null; }
  }, []);

  const handleExecEv = useCallback((ev: { t: string; [k: string]: unknown }) => {
    if (ev.t === "step_start") setExecProgress(p => p && ({ ...p, activeIdx: ev.i as number }));
    if (ev.t === "step_done") setExecProgress(p => p && ({ ...p, activeIdx: null, doneMap: { ...p.doneMap, [ev.i as number]: ev.ok as boolean } }));
    if (ev.t === "captured") setExecProgress(p => p && ({ ...p, liveVars: { ...p.liveVars, [ev.varName as string]: ev.value as string } }));
    if (ev.t === "watch_ready" && ev.watchId) {
      const wid = ev.watchId as string;
      setWatchId(wid);
      openWatch(wid);
    }
  }, [openWatch]);

  const cancelSingle = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const runSingle = useCallback(async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setSinglePending(true);
    setExecProgress({ activeIdx: null, doneMap: {}, liveVars: {} });
    setWatchId(null); setWatchShot(""); closeWatch();
    try {
      const d = await streamScrape(buildRequest(form.getValues()), handleExecEv, ac.signal);
      addSnap(d);
      toast({ title: "执行完成", description: `耗时 ${d.duration}ms` });
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        toast({ title: "已取消执行" });
      } else {
        toast({ title: "执行失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" });
      }
    } finally {
      abortRef.current = null;
      setSinglePending(false);
      setTimeout(() => { setExecProgress(null); setWatchId(null); closeWatch(); }, 4000);
    }
  }, [form, streamScrape, buildRequest, addSnap, toast, handleExecEv, closeWatch]);

  const runLoop = useCallback(async () => {
    const v = form.getValues(); const total = v.loopCount; const delay = v.loopDelayMs;
    stopLoopRef.current = false; setLoopRunning(true); setLoopProgress({ current: 0, total });
    let ok = 0; let fail = 0;
    for (let i = 1; i <= total; i++) {
      if (stopLoopRef.current) break;
      setLoopProgress({ current: i, total });
      setExecProgress({ activeIdx: null, doneMap: {}, liveVars: {} });
      setWatchId(null);
      try {
        const d = await streamScrape(buildRequest(v), handleExecEv);
        addSnap(d, i, total); ok++;
      } catch (e: unknown) {
        fail++;
        toast({ title: `第 ${i} 次失败`, description: e instanceof Error ? e.message : "", variant: "destructive" });
      }
      if (i < total && !stopLoopRef.current) await sleep(delay);
    }
    setLoopRunning(false); setLoopProgress(null);
    setExecProgress(null); setWatchId(null); closeWatch();
    toast({ title: stopLoopRef.current ? "循环已停止" : "循环完成", description: `成功 ${ok} 次${fail > 0 ? `，失败 ${fail} 次` : ""}` });
  }, [form, streamScrape, buildRequest, addSnap, toast, handleExecEv, closeWatch]);

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
                  <CardDescription className="text-xs">按顺序执行，共 19 种操作：点击、双击、右键、输入、按键、下拉、滚动、悬停、跳转、新建标签、切换标签、关闭标签、后退、前进、刷新、等待、监听、读取、截图</CardDescription>
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

                          {s?.type === "doubleclick" && <>
                            <Field label="目标元素选择器">
                              <Input placeholder="例：.row-item 或 #edit-btn" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.selector`)} />
                            </Field>
                            <Field label="双击后等待（毫秒）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.waitMs`, { valueAsNumber: true })} />
                            </Field>
                          </>}

                          {s?.type === "rightclick" && <>
                            <Field label="目标元素选择器">
                              <Input placeholder="例：.item 或 #context-target" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.selector`)} />
                            </Field>
                            <Field label="右键后等待（毫秒）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.waitMs`, { valueAsNumber: true })} />
                            </Field>
                          </>}

                          {s?.type === "goback" && <>
                            <p className="text-xs text-muted-foreground bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
                              点击执行后，浏览器后退一步（等同于点后退按钮）。可配合"跳转网址"步骤使用，在两个页面来回切换。
                            </p>
                            <Field label="后退后等待页面加载（毫秒）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.waitMs`, { valueAsNumber: true })} />
                            </Field>
                          </>}

                          {s?.type === "goforward" && <>
                            <p className="text-xs text-muted-foreground bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
                              浏览器前进一步（需要先有可前进的历史记录）。
                            </p>
                            <Field label="前进后等待页面加载（毫秒）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.waitMs`, { valueAsNumber: true })} />
                            </Field>
                          </>}

                          {s?.type === "reload" && <>
                            <p className="text-xs text-muted-foreground bg-sky-50 border border-sky-200 rounded px-2 py-1.5">
                              刷新当前页面，等待重新加载完成后继续后续步骤。
                            </p>
                            <Field label="刷新后等待页面加载（毫秒）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.waitMs`, { valueAsNumber: true })} />
                            </Field>
                          </>}

                          {s?.type === "wait" && <>
                            <Field label="等待时长（毫秒）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.waitMs`, { valueAsNumber: true })} />
                            </Field>
                            <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                              纯时间等待，适合等待动画播放、延迟渲染等场景。
                            </p>
                          </>}

                          {s?.type === "screenshot" && <>
                            <p className="text-xs text-muted-foreground bg-violet-50 border border-violet-200 rounded px-2 py-1.5">
                              在此处暂停并截图，截图会在右侧实时监控画面中显示。适合用于关键节点确认。
                            </p>
                            <Field label="截图前等待（毫秒）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.waitMs`, { valueAsNumber: true })} />
                            </Field>
                          </>}

                          {s?.type === "newtab" && <>
                            <p className="text-xs text-muted-foreground bg-indigo-50 border border-indigo-200 rounded px-2 py-1.5">
                              在同一浏览器会话内开一个新标签页。后续步骤会在新标签页内执行。可用"切换标签页"在多个标签间自由跳转。
                            </p>
                            <Field label="新标签页打开的网址（可留空）">
                              <Input placeholder="https://example.com" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.url`)} />
                            </Field>
                            <Field label="加载后等待（毫秒）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.waitMs`, { valueAsNumber: true })} />
                            </Field>
                          </>}

                          {s?.type === "switchtab" && <>
                            <p className="text-xs text-muted-foreground bg-sky-50 border border-sky-200 rounded px-2 py-1.5">
                              切换到指定编号的标签页。编号从 0 开始：0 = 第一个（最初打开的），1 = 第二个，以此类推。
                            </p>
                            <Field label="切换到标签页编号（0 = 第一个）">
                              <Input type="number" min={0} className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.tabIndex`, { valueAsNumber: true })} />
                            </Field>
                            <Field label="切换后等待（毫秒）">
                              <Input type="number" className="font-mono text-xs h-7"
                                {...form.register(`steps.${index}.waitMs`, { valueAsNumber: true })} />
                            </Field>
                          </>}

                          {s?.type === "closetab" && <>
                            <p className="text-xs text-muted-foreground bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
                              关闭当前激活的标签页，并自动切换回上一个标签。
                            </p>
                            <Field label="关闭后等待（毫秒）">
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
                  {/* Export / Import */}
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button type="button" variant="ghost" size="sm" className="text-xs h-7 gap-1.5 text-muted-foreground" onClick={exportSequences} title="导出所有方案为 JSON 文件">
                      <Download className="h-3 w-3" />导出
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="text-xs h-7 gap-1.5 text-muted-foreground" onClick={() => importFileRef.current?.click()} title="从 JSON 文件导入方案">
                      <Upload className="h-3 w-3" />导入
                    </Button>
                    <input ref={importFileRef} type="file" accept=".json,application/json" className="hidden" onChange={importSequences} />
                  </div>
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
              ) : singlePending ? (
                <div className="flex gap-2">
                  <Button type="button" size="lg" className="flex-1" disabled>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />执行中...
                  </Button>
                  <Button type="button" size="lg" variant="destructive" className="px-4" onClick={cancelSingle} title="取消执行">
                    <Square className="h-4 w-4 fill-current" />
                  </Button>
                </div>
              ) : (
                <Button type="submit" className="w-full" size="lg">
                  {loopEnabled ? <><Repeat className="mr-2 h-4 w-4" />开始循环（{form.watch("loopCount")} 次）</>
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

          {/* Inline live browser view — shown during execution once watchId is ready */}
          {isRunning && watchId && (
            <Card className="overflow-hidden border-zinc-700 shadow-md animate-in fade-in">
              <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border-b border-zinc-700 shrink-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                </span>
                <span className="text-xs font-semibold text-violet-300">实时浏览器视图</span>
                {watchUrl && <span className="flex-1 text-[10px] font-mono text-zinc-400 truncate">{watchUrl}</span>}
                <span className="text-[10px] text-zinc-500 hidden sm:inline">只读 · 不影响执行</span>
              </div>
              <div className="bg-zinc-950 flex items-center justify-center" style={{ aspectRatio: "16/9" }}>
                {!watchShot ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
                    <span className="text-xs text-zinc-400">等待浏览器截图…</span>
                  </div>
                ) : (
                  <img src={watchShot} alt="后台浏览器" className="w-full h-full block" draggable={false} />
                )}
              </div>
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
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />19 种操作类型</div>
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />保存复用</div>
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />支持循环</div>
              </div>
            </div>
          )}

          {isRunning && !loopProgress && !watchId && (
            <Card className="flex flex-col items-center justify-center py-16 border-dashed border-2 bg-muted/10 animate-in fade-in">
              <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
              <h3 className="text-base font-medium mb-1">正在执行步骤序列</h3>
              <p className="text-sm text-muted-foreground">浏览器启动中，稍后显示实时画面…</p>
            </Card>
          )}
        </div>
      </div>
    </div>


    {/* ── Visual Recorder Overlay ─────────────────────────────────────────── */}
    {isRecording && (() => {
      // ── helpers scoped to recorder render ─────────────────────────────────
      const fv = recFormValues;
      const setFv = (k: string, v: string | number) => setRecFormValues(prev => ({ ...prev, [k]: v }));

      // Mode 1: execute + record immediately on page click (click/dblclick/rightclick/hover)
      const isClickPickMode = recFormType !== null && (["click","doubleclick","rightclick","hover"] as string[]).includes(recFormType);
      // Mode 2: click page to detect selector, then fill remaining fields in mini-form
      const isPickThenFillMode = recFormType !== null && (["type","select","scroll","capture","listen"] as string[]).includes(recFormType);
      // In mode 2, phase 1 = waiting for page click; phase 2 = selector detected, show form
      const pickPhase1 = isPickThenFillMode && recPickedSelector === null;
      const pickPhase2 = isPickThenFillMode && recPickedSelector !== null;
      // Either mode makes the overlay clickable
      const overlayClickable = (isClickPickMode || pickPhase1) && !recStepPending;

      // Fields shown per step type
      const needsSelector = false; // always auto-detected for pick-then-fill; hidden for click-pick
      const needsUrl      = ["navigate","newtab"].includes(recFormType ?? "");
      const needsText     = pickPhase2 && recFormType === "type";
      const needsKey      = recFormType === "key";
      const needsValue    = pickPhase2 && recFormType === "select";
      const needsTabIndex = recFormType === "switchtab";
      const needsListen   = pickPhase2 && recFormType === "listen";
      const needsVarName  = pickPhase2 && recFormType === "capture";
      const noParams      = ["goback","goforward","reload","wait","screenshot","closetab"].includes(recFormType ?? "");

      const COMMON_KEYS_LIST = ["Enter","Tab","Escape","Space","ArrowDown","ArrowUp","ArrowLeft","ArrowRight","Backspace","Delete"];

      const buildPayload = (): Omit<RecordedStep,"id"> | null => {
        if (!recFormType) return null;
        const base: Omit<RecordedStep,"id"> = { type: recFormType };
        // Use auto-detected selector (pick-then-fill mode) or fall back to form field
        if (isPickThenFillMode) {
          const sel = recPickedSelector ?? String(fv.selector ?? "").trim();
          if (!sel && recFormType !== "scroll") { toast({ title: "请先点击页面元素识别选择器", variant: "destructive" }); return null; }
          if (sel) base.selector = sel;
        } else if (needsSelector && !noParams) {
          const sel = String(fv.selector ?? "").trim();
          if (!sel && !["scroll"].includes(recFormType)) { toast({ title: "请填写选择器", variant: "destructive" }); return null; }
          if (sel) base.selector = sel;
        }
        if (needsUrl) {
          const url = String(fv.url ?? "").trim();
          if (!url) { toast({ title: "请填写网址", variant: "destructive" }); return null; }
          base.url = url;
        }
        if (needsText) base.text = String(fv.text ?? "");
        if (needsKey) base.key = String(fv.key ?? "Enter");
        if (needsValue) base.value = String(fv.value ?? "");
        if (needsTabIndex) base.tabIndex = Number(fv.tabIndex ?? 0);
        if (needsListen) { base.listenFor = String(fv.listenFor ?? "appear"); base.listenTimeout = Number(fv.listenTimeout ?? 15000); }
        if (needsVarName) { base.varName = String(fv.varName ?? "").trim(); }
        if (fv.waitMs) base.waitMs = Number(fv.waitMs);
        return base;
      };

      const handleExecute = () => {
        const payload = buildPayload();
        if (payload) {
          sendStep(payload);
          // Reset picked selector after submitting so next action starts fresh
          setRecPickedSelector(null);
          setRecPickedLabel("");
        }
      };

      const recStepDef = STEP_TYPES.find(t => t.type === recFormType);
      const RecStepIcon = recStepDef?.icon;

      return (
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
              {recTabCount > 1 && (
                <Badge variant="outline" className="text-[10px] font-mono shrink-0 border-sky-300 text-sky-600">
                  {recTabCount} 个标签页
                </Badge>
              )}
            </div>
            {sessionLoading && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="hidden sm:inline">启动浏览器…</span>
              </div>
            )}
            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 sm:w-auto sm:px-3 sm:gap-1.5 text-muted-foreground shrink-0"
              title="重新连接画面" onClick={() => { if (sessionId) connectStream(sessionId); }}>
              <RefreshCw className="h-4 w-4" /><span className="hidden sm:inline">刷新画面</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 sm:w-auto sm:px-3 sm:gap-1.5 text-muted-foreground shrink-0" onClick={() => stopRecording()}>
              <X className="h-4 w-4" /><span className="hidden sm:inline">关闭</span>
            </Button>
            <Button type="button" variant="destructive" size="sm" className="h-7 px-2 sm:px-3 gap-1.5 shrink-0 text-xs" onClick={() => stopRecording()}>
              <StopCircle className="h-3.5 w-3.5" /><span className="hidden xs:inline">停止</span>
            </Button>
          </div>

          {/* Main area */}
          <div className="flex flex-col md:flex-row flex-1 overflow-hidden">

            {/* Left: browser preview + step palette */}
            <div className="flex-1 bg-zinc-950 min-h-0 flex flex-col overflow-hidden">

              {/* Screenshot (read-only) */}
              <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
                {sessionLoading || !screenshotUrl ? (
                  <div className="flex flex-col items-center justify-center gap-3 w-full h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-white/40" />
                    <span className="text-sm text-white/40">正在启动浏览器…</span>
                  </div>
                ) : (
                  <div className="relative w-full" style={{ aspectRatio: "16/9", maxHeight: "100%", maxWidth: "calc((100vh - 200px) * 16 / 9)" }}>
                    <img
                      src={screenshotUrl}
                      alt="远程浏览器"
                      className="w-full h-full block"
                      style={{ imageRendering: "auto" }}
                      draggable={false}
                    />
                    {/* Overlay — clickable in click-pick mode or pick-then-fill phase 1 */}
                    <div
                      ref={overlayRef}
                      className={`absolute inset-0 ${overlayClickable ? "cursor-crosshair" : ""}`}
                      onClick={overlayClickable ? (e) => {
                        const rect = overlayRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        const x = (e.clientX - rect.left) / rect.width;
                        const y = (e.clientY - rect.top) / rect.height;
                        if (isClickPickMode) {
                          sendClickAtCoords(recFormType as "click"|"doubleclick"|"rightclick"|"hover", x, y);
                        } else if (pickPhase1) {
                          detectSelectorAtCoords(x, y);
                        }
                      } : undefined}
                    />
                    {/* Overlay hint */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      {isClickPickMode ? (
                        /* Mode 1: immediate execute on click */
                        <div className="absolute bottom-3 left-2 right-2 flex justify-center">
                          <span className="text-xs bg-blue-600/95 text-white rounded-lg px-3 py-1.5 flex items-center gap-2 shadow-lg">
                            <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
                            {recStepPending ? "执行中，请稍候…" : `点击页面元素 → 自动执行「${recStepDef?.label}」并记录`}
                          </span>
                        </div>
                      ) : pickPhase1 ? (
                        /* Mode 2 phase 1: waiting for element click */
                        <div className="absolute bottom-3 left-2 right-2 flex justify-center">
                          <span className="text-xs bg-amber-600/95 text-white rounded-lg px-3 py-1.5 flex items-center gap-2 shadow-lg">
                            <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
                            {recStepPending ? "识别中…" : `点击页面元素 → 自动识别选择器，再填写「${recStepDef?.label}」参数`}
                          </span>
                        </div>
                      ) : recFormType === null ? (
                        /* No step selected — big centered nudge */
                        <div className="flex flex-col items-center gap-2 bg-black/55 rounded-xl px-5 py-4 text-center">
                          <span className="text-sm text-white font-semibold">① 先从下方选择操作类型</span>
                          <span className="text-xs text-white/70">点击「点击」「输入」等按钮后，再与页面交互</span>
                          <svg className="h-5 w-5 text-white/60 mt-1 animate-bounce" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
                        </div>
                      ) : pickPhase2 ? (
                        /* Mode 2 phase 2: selector detected, fill remaining fields */
                        <div className="absolute bottom-3 left-2 right-2 flex justify-center">
                          <span className="text-xs bg-green-700/90 text-white rounded-lg px-3 py-1.5 shadow">
                            ✓ 已识别元素，填写下方参数后点「执行并记录」
                          </span>
                        </div>
                      ) : (
                        /* Pure form-based step (navigate, key, wait, etc.) */
                        <div className="absolute bottom-3 left-2 right-2 flex justify-center">
                          <span className="text-xs bg-black/70 text-white/80 rounded-lg px-3 py-1.5 shadow">
                            填写下方表单后点「执行并记录」
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Step palette + mini-form */}
              <div className="shrink-0 bg-zinc-900 border-t border-zinc-700">
                {/* Palette header */}
                <div className="px-3 pt-2 pb-1 flex items-center justify-between">
                  <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide">选择操作</span>
                  <button type="button" onClick={copyPageText} className="text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors">📋 复制页面文字</button>
                </div>

                {/* Step type grid */}
                <div className="px-2 pb-2 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
                  {STEP_TYPES.map(({ type, label, icon: Icon, color }) => {
                    const c = COLOR_MAP[color];
                    const active = recFormType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        disabled={recStepPending}
                        onClick={() => {
                          if (active) { setRecFormType(null); setRecFormValues({}); setRecPickedSelector(null); setRecPickedLabel(""); }
                          else { setRecFormType(type); setRecFormValues({}); setRecPickedSelector(null); setRecPickedLabel(""); }
                        }}
                        className={`
                          flex flex-col items-center gap-1 px-1 py-1.5 rounded-md text-center transition-all border text-[10px] font-medium
                          ${active
                            ? `${c.bg} ${c.border} text-foreground ring-1 ring-offset-1 ring-offset-zinc-900`
                            : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
                          }
                        `}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="leading-tight">{label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Mini-form — appears when a step type is selected */}
                {recFormType && (
                  <div className="border-t border-zinc-700 px-3 py-2.5 space-y-2 animate-in slide-in-from-bottom-2 duration-150" style={{ backgroundColor: "#1a1a2e" }}>
                    <div className="flex items-center gap-2 mb-1">
                      {RecStepIcon && <RecStepIcon className="h-3.5 w-3.5 text-zinc-300" />}
                      <span className="text-xs font-semibold text-zinc-200">{recStepDef?.label}</span>
                      <button type="button" onClick={() => { setRecFormType(null); setRecFormValues({}); setRecPickedSelector(null); setRecPickedLabel(""); }}
                        className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">
                        取消
                      </button>
                    </div>

                    {/* Mode 1 — click-pick: show instruction, no form fields */}
                    {isClickPickMode && (
                      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-blue-900/40 border border-blue-700/50">
                        <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
                        <span className="text-xs text-blue-200">
                          直接点击上方截图中的目标元素，CSS 选择器自动识别，立即执行
                        </span>
                      </div>
                    )}

                    {/* Mode 2 phase 1 — pick-then-fill: waiting for element click */}
                    {pickPhase1 && (
                      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-amber-900/40 border border-amber-700/50">
                        <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                        <span className="text-xs text-amber-200">
                          {recStepPending ? "正在识别元素…" : "点击上方截图中的目标元素，自动识别选择器"}
                        </span>
                      </div>
                    )}

                    {/* Mode 2 phase 2 — selector detected, show it as badge + remaining fields */}
                    {pickPhase2 && (
                      <div className="flex items-center gap-1.5 py-1 px-2 rounded-md bg-green-900/40 border border-green-700/50">
                        <span className="text-[10px] text-green-300 shrink-0">已识别</span>
                        <code className="text-[10px] text-green-200 font-mono truncate flex-1">{recPickedSelector}</code>
                        {recPickedLabel && <span className="text-[10px] text-green-400/70 shrink-0 hidden sm:block">{recPickedLabel}</span>}
                        <button type="button"
                          onClick={() => { setRecPickedSelector(null); setRecPickedLabel(""); setRecFormValues(prev => ({ ...prev, selector: "" })); }}
                          className="text-[10px] text-zinc-400 hover:text-red-400 transition-colors shrink-0">
                          重选
                        </button>
                      </div>
                    )}

                    {needsSelector && (
                      <div>
                        <label className="text-[10px] text-zinc-400 block mb-0.5">CSS 选择器</label>
                        <input
                          type="text"
                          value={String(fv.selector ?? "")}
                          onChange={e => setFv("selector", e.target.value)}
                          placeholder="#id、.class、input[name='q'] …"
                          className="w-full px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-100 border border-zinc-600 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 font-mono"
                        />
                      </div>
                    )}
                    {needsUrl && (
                      <div>
                        <label className="text-[10px] text-zinc-400 block mb-0.5">网址</label>
                        <input
                          type="text"
                          value={String(fv.url ?? "")}
                          onChange={e => setFv("url", e.target.value)}
                          placeholder="https://example.com"
                          className="w-full px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-100 border border-zinc-600 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 font-mono"
                        />
                      </div>
                    )}
                    {needsText && (
                      <div>
                        <label className="text-[10px] text-zinc-400 block mb-0.5">输入内容</label>
                        <input
                          type="text"
                          value={String(fv.text ?? "")}
                          onChange={e => setFv("text", e.target.value)}
                          placeholder="要输入的文字，支持 ${变量名}"
                          className="w-full px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-100 border border-zinc-600 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    )}
                    {needsKey && (
                      <div>
                        <label className="text-[10px] text-zinc-400 block mb-0.5">按键</label>
                        <div className="flex flex-wrap gap-1">
                          {COMMON_KEYS_LIST.map(k => (
                            <button key={k} type="button"
                              onClick={() => setFv("key", k)}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${String(fv.key ?? "Enter") === k ? "bg-blue-600 border-blue-500 text-white" : "bg-zinc-800 border-zinc-600 text-zinc-300 hover:bg-zinc-700"}`}
                            >{k}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    {needsValue && (
                      <div>
                        <label className="text-[10px] text-zinc-400 block mb-0.5">选项值（value 属性）</label>
                        <input
                          type="text"
                          value={String(fv.value ?? "")}
                          onChange={e => setFv("value", e.target.value)}
                          placeholder="选项的 value 值"
                          className="w-full px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-100 border border-zinc-600 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 font-mono"
                        />
                      </div>
                    )}
                    {needsTabIndex && (
                      <div>
                        <label className="text-[10px] text-zinc-400 block mb-0.5">标签页编号（0 = 第一个）</label>
                        <div className="flex gap-1">
                          {Array.from({ length: recTabCount }).map((_, i) => (
                            <button key={i} type="button"
                              onClick={() => setFv("tabIndex", i)}
                              className={`px-3 py-0.5 rounded text-[10px] font-mono border transition-colors ${Number(fv.tabIndex ?? 0) === i ? "bg-sky-600 border-sky-500 text-white" : "bg-zinc-800 border-zinc-600 text-zinc-300 hover:bg-zinc-700"}`}
                            >标签 {i}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    {needsListen && (
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] text-zinc-400 block mb-0.5">等待条件</label>
                          <select
                            value={String(fv.listenFor ?? "appear")}
                            onChange={e => setFv("listenFor", e.target.value)}
                            className="w-full px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-100 border border-zinc-600 focus:outline-none"
                          >
                            <option value="appear">元素出现</option>
                            <option value="disappear">元素消失</option>
                            <option value="networkIdle">网络空闲</option>
                          </select>
                        </div>
                        <div className="w-24">
                          <label className="text-[10px] text-zinc-400 block mb-0.5">超时（毫秒）</label>
                          <input type="number" value={String(fv.listenTimeout ?? 15000)} onChange={e => setFv("listenTimeout", e.target.value)}
                            className="w-full px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-100 border border-zinc-600 focus:outline-none font-mono" />
                        </div>
                      </div>
                    )}
                    {needsVarName && (
                      <div>
                        <label className="text-[10px] text-zinc-400 block mb-0.5">保存为变量名</label>
                        <input
                          type="text"
                          value={String(fv.varName ?? "")}
                          onChange={e => setFv("varName", e.target.value)}
                          placeholder="myVar（后续步骤用 ${myVar} 引用）"
                          className="w-full px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-100 border border-zinc-600 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 font-mono"
                        />
                      </div>
                    )}
                    {/* waitMs — shown only when form is ready to submit */}
                    {!isClickPickMode && !pickPhase1 && !["listen","capture"].includes(recFormType) && (
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] text-zinc-400 shrink-0">执行后等待</label>
                        <input
                          type="number"
                          value={String(fv.waitMs ?? "")}
                          onChange={e => setFv("waitMs", e.target.value)}
                          placeholder="毫秒（可选）"
                          className="w-28 px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-100 border border-zinc-600 placeholder:text-zinc-500 focus:outline-none font-mono"
                        />
                        <span className="text-[10px] text-zinc-500">ms</span>
                      </div>
                    )}

                    {/* Execute button — only when form is ready (not click-pick, not pick phase 1) */}
                    {!isClickPickMode && !pickPhase1 && (
                      <div className="flex gap-2 pt-0.5">
                        <button
                          type="button"
                          disabled={recStepPending}
                          onClick={handleExecute}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 border border-blue-500 transition-colors disabled:opacity-50"
                        >
                          {recStepPending
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />执行中…</>
                            : <><Play className="h-3.5 w-3.5" />执行并记录</>
                          }
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right: step log panel */}
            <div className={`
              border-t md:border-t-0 md:border-l flex flex-col bg-muted/20 shrink-0 transition-all duration-200
              ${panelCollapsed
                ? "w-full md:w-10 max-h-12 md:max-h-none overflow-hidden"
                : "w-full md:w-72 lg:w-80 max-h-[42vh] md:max-h-none"
              }
            `}>
              <div className="flex items-center justify-between px-3 py-2 border-b bg-background shrink-0">
                {!panelCollapsed && (
                  <div className="flex items-center gap-2 text-sm font-medium min-w-0">
                    <Activity className="h-4 w-4 text-primary shrink-0" />
                    <span className="truncate">已记录步骤</span>
                    <Badge variant="secondary" className="font-mono text-xs shrink-0">{recordedSteps.length}</Badge>
                  </div>
                )}
                {panelCollapsed && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground md:flex-col md:gap-0">
                    <Activity className="h-3.5 w-3.5 text-primary" />
                    <span className="font-mono md:hidden">{recordedSteps.length}</span>
                  </div>
                )}
                <div className={`flex items-center gap-1 shrink-0 ${panelCollapsed ? "ml-auto" : ""}`}>
                  {!panelCollapsed && recordedSteps.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground"
                      onClick={() => setRecordedSteps(s => s.slice(0, -1))}>
                      <Undo2 className="h-3 w-3" />
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground"
                    onClick={() => setPanelCollapsed(c => !c)}>
                    {panelCollapsed
                      ? <ChevronUp className="h-3.5 w-3.5 md:rotate-90" />
                      : <ChevronDown className="h-3.5 w-3.5 md:rotate-90" />}
                  </Button>
                </div>
              </div>

              {!panelCollapsed && (
                <>
                  <ScrollArea className="flex-1 min-h-0">
                    {recordedSteps.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                        <MousePointerClick className="h-7 w-7 text-muted-foreground/30 mb-2" />
                        <p className="text-xs text-muted-foreground">点击下方按钮执行操作，步骤自动记录在这里</p>
                      </div>
                    ) : (
                      <div className="p-2 space-y-1.5">
                        {recordedSteps.map((rs, i) => {
                          const def = STEP_TYPES.find(t => t.type === rs.type) ?? { label: rs.type, icon: Play, color: "slate" };
                          const colors = COLOR_MAP[def.color];
                          const Icon = def.icon;
                          const summary = rs.selector ?? rs.url ?? rs.text ?? rs.key ?? rs.value ?? (rs.tabIndex !== undefined ? `标签 ${rs.tabIndex}` : "");
                          return (
                            <div key={rs.id} className={`rounded-md border p-2 ${colors.bg} ${colors.border} animate-in slide-in-from-bottom-1`}>
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[10px] font-mono text-muted-foreground w-4 shrink-0">{i + 1}</span>
                                <Icon className="h-3 w-3 shrink-0 text-foreground/60" />
                                <span className="text-xs font-semibold">{def.label}</span>
                                {rs.navigatedTo && <span className="text-[10px] text-indigo-500 ml-auto shrink-0">→ 跳页</span>}
                              </div>
                              {summary && (
                                <code className="text-[10px] font-mono text-foreground/60 break-all leading-tight block ml-5 truncate">
                                  {summary}
                                </code>
                              )}
                              {rs.label && (
                                <span className="text-[10px] text-muted-foreground ml-5 block truncate">"{rs.label}"</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>

                  {/* Captured variables panel */}
                  {Object.keys(recVars).length > 0 && (
                    <div className="shrink-0 border-t px-3 py-2 bg-green-950/30">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[10px] font-semibold text-green-400 uppercase tracking-wide">已捕获变量</span>
                        <span className="text-[10px] text-green-600/70">（后续步骤可用 {"${变量名}"} 引用）</span>
                      </div>
                      <div className="space-y-1">
                        {Object.entries(recVars).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-1.5 text-[10px]">
                            <code className="text-green-300 font-mono shrink-0">${"{" + k + "}"}</code>
                            <span className="text-green-500/60">=</span>
                            <span className="text-green-200/80 truncate font-mono">"{v}"</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="p-2.5 border-t bg-background shrink-0 space-y-1.5">
                    {recordedSteps.length > 0 ? (
                      <Button type="button" className="w-full gap-2 h-8 text-sm" onClick={applyRecordedSteps}>
                        <CheckCircle2 className="h-3.5 w-3.5" />应用 {recordedSteps.length} 个步骤到方案
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" className="w-full h-8 text-sm" onClick={() => stopRecording()}>
                        取消录制
                      </Button>
                    )}
                    <p className="text-[10px] text-muted-foreground text-center leading-tight">应用后可在步骤列表中编辑调整</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      );
    })()}
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
