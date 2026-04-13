import { useState, useRef, useCallback } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useStartScrape, useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Globe, Type, Link as LinkIcon, AlignLeft, Image as ImageIcon, Code,
  Activity, Search, AlertCircle, CheckCircle2, Loader2,
  MousePointerClick, Plus, Trash2, Target, Crosshair, RefreshCw, Clock,
  TrendingUp, ChevronDown, ChevronUp, ExternalLink, Repeat, Square,
  Play, ArrowUp, ArrowDown, Timer, Save, FolderOpen, X,
} from "lucide-react";
import type { ScrapeResult } from "@workspace/api-client-react/src/generated/api.schemas";

// ─── Schemas ────────────────────────────────────────────────────────────────

const customSelectorSchema = z.object({
  name: z.string().min(1, "请填写名称"),
  selector: z.string().min(1, "请填写选择器"),
});

const stepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    selector: z.string().min(1, "请填写选择器"),
    waitMs: z.number().min(0),
    waitForPopupClose: z.boolean(),
    popupTimeoutMs: z.number().min(0),
  }),
  z.object({
    type: z.literal("wait"),
    waitMs: z.number().min(0),
  }),
]);

type Step = z.infer<typeof stepSchema>;

const formSchema = z.object({
  url: z.string().url({ message: "请输入有效的URL，例如 https://example.com" }),
  options: z.object({
    headings: z.boolean(),
    links: z.boolean(),
    paragraphs: z.boolean(),
    images: z.boolean(),
    metaTags: z.boolean(),
  }),
  steps: z.array(stepSchema),
  customSelectors: z.array(customSelectorSchema),
  loopEnabled: z.boolean(),
  loopCount: z.number().min(1).max(100),
  loopDelayMs: z.number().min(0),
});

type FormValues = z.infer<typeof formSchema>;

// ─── Saved sequence type ────────────────────────────────────────────────────

interface SavedSequence {
  name: string;
  steps: Step[];
  savedAt: string;
}

const STORAGE_KEY = "scraper-sequences";

function loadSequences(): SavedSequence[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveSequences(seqs: SavedSequence[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seqs));
}

// ─── Snapshot type ──────────────────────────────────────────────────────────

interface Snapshot {
  id: string;
  iteration?: number;
  loopTotal?: number;
  triggeredAt: string;
  duration: number;
  result: ScrapeResult;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ─── Default step factories ─────────────────────────────────────────────────

function newClickStep(): Extract<Step, { type: "click" }> {
  return { type: "click", selector: "", waitMs: 2000, waitForPopupClose: false, popupTimeoutMs: 30000 };
}
function newWaitStep(): Extract<Step, { type: "wait" }> {
  return { type: "wait", waitMs: 2000 };
}

// ─── Component ──────────────────────────────────────────────────────────────

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
  const stopLoopRef = useRef(false);
  const snapshotIdRef = useRef(0);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      url: "https://example.com",
      options: { headings: true, links: true, paragraphs: true, images: true, metaTags: true },
      steps: [],
      customSelectors: [],
      loopEnabled: false,
      loopCount: 5,
      loopDelayMs: 3000,
    },
  });

  const {
    fields: stepFields,
    append: appendStep,
    remove: removeStep,
    move: moveStep,
  } = useFieldArray({ control: form.control, name: "steps" });

  const {
    fields: selectorFields,
    append: appendSelector,
    remove: removeSelector,
  } = useFieldArray({ control: form.control, name: "customSelectors" });

  const { mutateAsync } = useStartScrape();
  const { data: health } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });

  // ── Save / Load sequences ─────────────────────────────────────────────────

  const handleSave = () => {
    const steps = form.getValues("steps");
    if (steps.length === 0) {
      toast({ title: "步骤为空", description: "请先添加至少一个步骤再保存", variant: "destructive" });
      return;
    }
    setSaveName("");
    setSaveDialogOpen(true);
  };

  const confirmSave = () => {
    const name = saveName.trim();
    if (!name) return;
    const steps = form.getValues("steps");
    const seq: SavedSequence = { name, steps, savedAt: new Date().toLocaleString("zh-CN") };
    const updated = [seq, ...savedSequences.filter((s) => s.name !== name)];
    setSavedSequences(updated);
    saveSequences(updated);
    setSaveDialogOpen(false);
    toast({ title: "已保存", description: `方案"${name}"已保存` });
  };

  const loadSequence = (seq: SavedSequence) => {
    form.setValue("steps", seq.steps as FormValues["steps"]);
    toast({ title: "已加载", description: `方案"${seq.name}"已加载` });
  };

  const deleteSequence = (name: string) => {
    const updated = savedSequences.filter((s) => s.name !== name);
    setSavedSequences(updated);
    saveSequences(updated);
  };

  // ── Scrape helpers ────────────────────────────────────────────────────────

  const buildRequestData = useCallback((values: FormValues) => ({
    url: values.url,
    options: {
      ...values.options,
      steps: values.steps.length > 0 ? values.steps : undefined,
      customSelectors: values.customSelectors.length > 0 ? values.customSelectors : undefined,
    },
  }), []);

  const addSnapshot = useCallback((data: ScrapeResult, iteration?: number, loopTotal?: number) => {
    const snap: Snapshot = {
      id: String(++snapshotIdRef.current),
      iteration,
      loopTotal,
      triggeredAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      duration: data.duration,
      result: data,
    };
    setSnapshots((prev) => [snap, ...prev]);
    setTriggerCount((c) => c + 1);
  }, []);

  const runSingle = useCallback(async () => {
    const values = form.getValues();
    setSinglePending(true);
    try {
      const data = await mutateAsync({ data: buildRequestData(values) });
      addSnapshot(data);
      toast({ title: "抓取完成", description: `耗时 ${data.duration}ms` });
    } catch (err: unknown) {
      toast({ title: "抓取失败", description: err instanceof Error ? err.message : "未知错误", variant: "destructive" });
    } finally {
      setSinglePending(false);
    }
  }, [form, mutateAsync, buildRequestData, addSnapshot, toast]);

  const runLoop = useCallback(async () => {
    const values = form.getValues();
    const total = values.loopCount;
    const delay = values.loopDelayMs;
    stopLoopRef.current = false;
    setLoopRunning(true);
    setLoopProgress({ current: 0, total });
    let success = 0; let fail = 0;
    for (let i = 1; i <= total; i++) {
      if (stopLoopRef.current) break;
      setLoopProgress({ current: i, total });
      try {
        const data = await mutateAsync({ data: buildRequestData(values) });
        addSnapshot(data, i, total);
        success++;
      } catch (err: unknown) {
        fail++;
        toast({ title: `第 ${i} 次失败`, description: err instanceof Error ? err.message : "未知错误", variant: "destructive" });
      }
      if (i < total && !stopLoopRef.current) await sleep(delay);
    }
    setLoopRunning(false);
    setLoopProgress(null);
    toast({ title: stopLoopRef.current ? "循环已停止" : "循环完成", description: `成功 ${success} 次${fail > 0 ? `，失败 ${fail} 次` : ""}` });
  }, [form, mutateAsync, buildRequestData, addSnapshot, toast]);

  function onSubmit() {
    form.getValues("loopEnabled") ? runLoop() : runSingle();
  }

  const toggleSnapshot = (id: string) => {
    setExpandedSnapshots((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const isRunning = loopRunning || singlePending;
  const loopEnabled = form.watch("loopEnabled");
  const hasCustomSelectors = form.watch("customSelectors").length > 0;
  const watchedSteps = form.watch("steps");

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ── LEFT ── */}
        <div className="lg:col-span-4 space-y-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

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
              </Card>

              {/* Step sequence builder */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Play className="h-4 w-4 text-primary" />操作步骤
                  </CardTitle>
                  <CardDescription className="text-xs">
                    按顺序添加步骤——可以点击按钮、等待，可以随意调整顺序
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {stepFields.length === 0 && (
                    <div className="text-center py-4 text-xs text-muted-foreground border-2 border-dashed rounded-md">
                      还没有步骤，点击下方按钮添加
                    </div>
                  )}

                  {stepFields.map((field, index) => {
                    const stepType = watchedSteps[index]?.type;
                    return (
                      <div key={field.id} className="border rounded-md overflow-hidden">
                        {/* Step header */}
                        <div className={`flex items-center gap-2 px-3 py-2 border-b ${stepType === "click" ? "bg-blue-50/60" : "bg-orange-50/60"}`}>
                          <div className="flex flex-col gap-0.5">
                            <Button type="button" variant="ghost" size="icon" className="h-4 w-5"
                              disabled={index === 0} onClick={() => moveStep(index, index - 1)}>
                              <ArrowUp className="h-3 w-3" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="h-4 w-5"
                              disabled={index === stepFields.length - 1} onClick={() => moveStep(index, index + 1)}>
                              <ArrowDown className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className={`w-1.5 h-6 rounded-full shrink-0 ${stepType === "click" ? "bg-blue-400" : "bg-orange-400"}`} />
                          <span className="text-xs font-semibold flex-1">
                            {stepType === "click" ? (
                              <span className="flex items-center gap-1"><MousePointerClick className="h-3 w-3 text-blue-500" />步骤 {index + 1}：点击</span>
                            ) : (
                              <span className="flex items-center gap-1"><Timer className="h-3 w-3 text-orange-500" />步骤 {index + 1}：等待</span>
                            )}
                          </span>
                          <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => removeStep(index)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>

                        {/* Step body */}
                        <div className="px-3 py-3 space-y-2 bg-card">
                          {stepType === "click" && (
                            <>
                              <FormField control={form.control} name={`steps.${index}.selector` as "steps.0.selector"} render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs text-muted-foreground">点击元素选择器</FormLabel>
                                  <FormControl>
                                    <Input placeholder="例：.refresh-btn" className="font-mono text-xs h-7" {...field} />
                                  </FormControl>
                                  <FormMessage className="text-xs" />
                                </FormItem>
                              )} />
                              <FormField control={form.control} name={`steps.${index}.waitMs` as "steps.0.waitMs"} render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs text-muted-foreground">点击后等待（毫秒）</FormLabel>
                                  <FormControl>
                                    <Input type="number" className="font-mono text-xs h-7" {...field}
                                      onChange={e => field.onChange(Number(e.target.value))} />
                                  </FormControl>
                                </FormItem>
                              )} />
                              <FormField control={form.control} name={`steps.${index}.waitForPopupClose` as "steps.0.waitForPopupClose"} render={({ field }) => (
                                <FormItem className="flex items-center gap-2 rounded border p-2 bg-amber-50/40">
                                  <FormControl>
                                    <Checkbox checked={field.value as boolean} onCheckedChange={field.onChange} />
                                  </FormControl>
                                  <FormLabel className="text-xs cursor-pointer m-0 flex items-center gap-1">
                                    <ExternalLink className="h-3 w-3 text-amber-600" />会弹出后台窗口，等它关闭
                                  </FormLabel>
                                </FormItem>
                              )} />
                            </>
                          )}
                          {stepType === "wait" && (
                            <FormField control={form.control} name={`steps.${index}.waitMs` as "steps.0.waitMs"} render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs text-muted-foreground">等待时长（毫秒）</FormLabel>
                                <FormControl>
                                  <Input type="number" className="font-mono text-xs h-7" {...field}
                                    onChange={e => field.onChange(Number(e.target.value))} />
                                </FormControl>
                              </FormItem>
                            )} />
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Add step buttons */}
                  <div className="flex gap-2 pt-1">
                    <Button type="button" variant="outline" size="sm" className="flex-1 text-xs h-8 border-dashed text-blue-600 border-blue-200 hover:bg-blue-50"
                      onClick={() => appendStep(newClickStep() as unknown as FormValues["steps"][number])}>
                      <MousePointerClick className="h-3.5 w-3.5 mr-1" />添加点击
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="flex-1 text-xs h-8 border-dashed text-orange-600 border-orange-200 hover:bg-orange-50"
                      onClick={() => appendStep(newWaitStep() as unknown as FormValues["steps"][number])}>
                      <Timer className="h-3.5 w-3.5 mr-1" />添加等待
                    </Button>
                  </div>
                </CardContent>

                {/* Save / Load bar */}
                <div className="border-t px-4 py-3 flex items-center gap-2 bg-muted/30">
                  <Button type="button" variant="outline" size="sm" className="text-xs h-7 gap-1.5" onClick={handleSave}>
                    <Save className="h-3 w-3" />保存方案
                  </Button>
                  {savedSequences.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
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
                  )}
                </div>
              </Card>

              {/* Save dialog (inline) */}
              {saveDialogOpen && (
                <Card className="border-primary/40 shadow-md animate-in fade-in slide-in-from-top-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">保存当前方案</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Input
                      placeholder="给这套步骤起个名字…"
                      value={saveName}
                      onChange={e => setSaveName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); confirmSave(); } }}
                      autoFocus
                      className="text-sm"
                    />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" className="flex-1" onClick={confirmSave} disabled={!saveName.trim()}>
                        保存
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => setSaveDialogOpen(false)}>
                        取消
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Custom selectors */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Crosshair className="h-4 w-4 text-primary" />要抓取的数据
                  </CardTitle>
                  <CardDescription className="text-xs">每次执行后提取这些位置的内容</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectorFields.map((field, index) => (
                    <div key={field.id} className="flex gap-2 items-start p-3 bg-muted/30 rounded-md border">
                      <div className="flex-1 space-y-2 min-w-0">
                        <FormField control={form.control} name={`customSelectors.${index}.name`} render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input placeholder="名称（如：最新消息）" className="text-xs h-7" {...field} />
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`customSelectors.${index}.selector`} render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input placeholder="CSS选择器" className="font-mono text-xs h-7" {...field} />
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )} />
                      </div>
                      <Button type="button" variant="ghost" size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive mt-0.5"
                        onClick={() => removeSelector(index)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" className="w-full text-xs h-8 border-dashed"
                    onClick={() => appendSelector({ name: "", selector: "" })}>
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
                      <FormField control={form.control} name="loopCount" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">循环次数</FormLabel>
                          <FormControl>
                            <div className="flex items-center gap-2">
                              <Input type="number" min={1} max={100} className="font-mono text-xs" {...field}
                                onChange={e => field.onChange(Number(e.target.value))} />
                              <span className="text-xs text-muted-foreground whitespace-nowrap">次</span>
                            </div>
                          </FormControl>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="loopDelayMs" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">每次间隔（毫秒）</FormLabel>
                          <FormControl>
                            <div className="flex items-center gap-2">
                              <Input type="number" min={0} className="font-mono text-xs" {...field}
                                onChange={e => field.onChange(Number(e.target.value))} />
                              <span className="text-xs text-muted-foreground whitespace-nowrap">毫秒</span>
                            </div>
                          </FormControl>
                        </FormItem>
                      )} />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Standard options */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Target className="h-4 w-4 text-primary" />通用提取选项
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-2">
                    {(["headings", "links", "paragraphs", "images", "metaTags"] as const).map((key) => {
                      const labels: Record<string, { label: string; icon: React.ReactNode }> = {
                        headings: { label: "标题", icon: <Type className="h-3 w-3" /> },
                        links: { label: "链接", icon: <LinkIcon className="h-3 w-3" /> },
                        paragraphs: { label: "段落", icon: <AlignLeft className="h-3 w-3" /> },
                        images: { label: "图片", icon: <ImageIcon className="h-3 w-3" /> },
                        metaTags: { label: "元数据", icon: <Code className="h-3 w-3" /> },
                      };
                      return (
                        <FormField key={key} control={form.control} name={`options.${key}`} render={({ field }) => (
                          <FormItem className="flex items-center gap-3 rounded border p-2.5 hover:bg-muted/40 transition-colors">
                            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                            <FormLabel className="font-normal cursor-pointer flex items-center gap-2 text-sm m-0">
                              <span className="text-muted-foreground">{labels[key].icon}</span>
                              {labels[key].label}
                            </FormLabel>
                          </FormItem>
                        )} />
                      );
                    })}
                  </div>
                </CardContent>
                <CardFooter className="bg-muted/30 border-t py-3 flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" />API 状态</div>
                  {health ? (
                    <div className="flex items-center gap-1.5">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                      </span>
                      <span className="text-green-600 font-medium">在线</span>
                    </div>
                  ) : <span>检查中...</span>}
                </CardFooter>
              </Card>

              {/* Run button */}
              <div className="flex gap-2">
                {loopRunning ? (
                  <Button type="button" variant="destructive" className="flex-1" size="lg" onClick={() => { stopLoopRef.current = true; }}>
                    <Square className="mr-2 h-4 w-4 fill-current" />停止循环
                  </Button>
                ) : (
                  <Button type="submit" className="flex-1" size="lg" disabled={isRunning}>
                    {singlePending ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在执行...</>
                    ) : loopEnabled ? (
                      <><Repeat className="mr-2 h-4 w-4" />开始循环（{form.watch("loopCount")} 次）</>
                    ) : (
                      <><Play className="mr-2 h-4 w-4" />{triggerCount === 0 ? "执行一次" : `再执行一次（第 ${triggerCount + 1} 次）`}</>
                    )}
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </div>

        {/* ── RIGHT ── */}
        <div className="lg:col-span-8 space-y-4">

          {/* Loop progress */}
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
                <p className="text-xs text-muted-foreground">点左侧"停止循环"随时中断，已收集的数据不会丢失</p>
              </CardContent>
            </Card>
          )}

          {/* Status bar */}
          {triggerCount > 0 && !loopProgress && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border rounded-lg text-sm animate-in fade-in">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="font-medium">共 {triggerCount} 条记录</span>
                </div>
                {snapshots[0] && (
                  <span className="text-muted-foreground text-xs">
                    最后：{snapshots[0].triggeredAt} · {snapshots[0].duration}ms
                  </span>
                )}
              </div>
              <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground"
                onClick={() => { setSnapshots([]); setTriggerCount(0); }}>
                清空
              </Button>
            </div>
          )}

          {/* Custom selector tracking */}
          {hasCustomSelectors && snapshots.length > 0 && (
            <Card className="border-border/50 shadow-sm animate-in fade-in">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4 text-primary" />数据汇总
                </CardTitle>
                <CardDescription className="text-xs">每次执行提取到的自定义数据及变化</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {form.getValues("customSelectors").map((cs, csIdx) => {
                  const allValues = snapshots.map((snap) => ({
                    time: snap.triggeredAt,
                    iteration: snap.iteration,
                    values: snap.result.customResults?.find((r) => r.selector === cs.selector)?.values ?? [],
                  }));
                  const latest = allValues[0];
                  const hasChanged = allValues.length > 1 && JSON.stringify(allValues[0]?.values) !== JSON.stringify(allValues[1]?.values);
                  return (
                    <div key={csIdx} className="border rounded-md overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <Crosshair className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="font-medium text-sm">{cs.name}</span>
                          <code className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{cs.selector}</code>
                        </div>
                        {hasChanged && <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200">有变化</Badge>}
                      </div>
                      <div className="px-3 py-2.5 border-b">
                        <p className="text-xs text-muted-foreground mb-1">最新值</p>
                        {!latest?.values.length ? (
                          <span className="text-xs text-muted-foreground">未找到</span>
                        ) : latest.values.map((v, vi) => (
                          <div key={vi} className="font-mono text-sm font-medium">{v}</div>
                        ))}
                      </div>
                      {allValues.length > 1 && (
                        <div className="px-3 py-2 bg-muted/10">
                          <p className="text-xs text-muted-foreground mb-1.5">历史（{allValues.length} 次）</p>
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {allValues.map((e, ei) => (
                              <div key={ei} className="flex items-start gap-2 text-xs">
                                <span className="text-muted-foreground font-mono w-16 shrink-0">{e.time}</span>
                                {e.iteration && <span className="text-muted-foreground shrink-0">#{e.iteration}</span>}
                                <span className={`font-mono ${ei === 0 ? "font-medium" : "text-muted-foreground"}`}>
                                  {e.values.length ? e.values.join(" / ") : "—"}
                                </span>
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

          {/* Snapshot history */}
          {snapshots.length > 0 ? (
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-4 w-4 text-primary" />全部记录
                </CardTitle>
                <CardDescription className="text-xs">点击展开查看完整内容</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {snapshots.map((snap, idx) => {
                  const isExpanded = expandedSnapshots.has(snap.id);
                  const r = snap.result;
                  const total = (r.headings?.length || 0) + (r.links?.length || 0) +
                    (r.paragraphs?.length || 0) + (r.images?.length || 0) + (r.metaTags?.length || 0) +
                    (r.customResults ?? []).reduce((s, cr) => s + cr.values.length, 0);
                  return (
                    <div key={snap.id} className={`border-t first:border-t-0 ${idx === 0 ? "bg-muted/10" : ""}`}>
                      <button type="button"
                        className="w-full flex items-center justify-between px-6 py-3 hover:bg-muted/20 transition-colors text-left"
                        onClick={() => toggleSnapshot(snap.id)}>
                        <div className="flex items-center gap-3">
                          <div className={`h-2 w-2 rounded-full shrink-0 ${idx === 0 ? "bg-primary" : "bg-muted-foreground/30"}`} />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {snap.iteration && snap.loopTotal
                                ? <span className="font-medium text-sm">第 {snap.iteration}/{snap.loopTotal} 次循环</span>
                                : <span className="font-medium text-sm">第 {snapshots.length - idx} 次执行</span>}
                              {idx === 0 && <Badge variant="outline" className="text-xs px-1.5 py-0 h-4">最新</Badge>}
                              {r.clickedElement && (
                                <span className="flex items-center gap-1 text-xs text-emerald-600">
                                  <MousePointerClick className="h-3 w-3" />已执行步骤
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">{snap.triggeredAt} · {snap.duration}ms · {total} 项</div>
                          </div>
                        </div>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                      </button>

                      {isExpanded && (
                        <div className="px-6 pb-4 animate-in fade-in slide-in-from-top-2 duration-200">
                          <Tabs defaultValue={r.customResults?.length ? "custom" : "headings"}>
                            <div className="border-b overflow-x-auto">
                              <TabsList className="h-9 w-max bg-transparent p-0 flex">
                                {r.customResults && r.customResults.length > 0 && (
                                  <TabsTrigger value="custom" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-3 text-xs whitespace-nowrap">
                                    自定义 <Badge variant="secondary" className="ml-1.5 font-mono text-xs">{r.customResults.reduce((s, cr) => s + cr.values.length, 0)}</Badge>
                                  </TabsTrigger>
                                )}
                                <TabsTrigger value="headings" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-3 text-xs whitespace-nowrap">
                                  标题 <Badge variant="secondary" className="ml-1.5 font-mono text-xs">{r.headings.length}</Badge>
                                </TabsTrigger>
                                <TabsTrigger value="links" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-3 text-xs whitespace-nowrap">
                                  链接 <Badge variant="secondary" className="ml-1.5 font-mono text-xs">{r.links.length}</Badge>
                                </TabsTrigger>
                                <TabsTrigger value="paragraphs" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-3 text-xs whitespace-nowrap">
                                  段落 <Badge variant="secondary" className="ml-1.5 font-mono text-xs">{r.paragraphs.length}</Badge>
                                </TabsTrigger>
                              </TabsList>
                            </div>
                            <ScrollArea className="h-60 mt-3">
                              {r.customResults && r.customResults.length > 0 && (
                                <TabsContent value="custom" className="m-0 space-y-2">
                                  {r.customResults.map((cr, i) => (
                                    <div key={i} className="border rounded-md overflow-hidden">
                                      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b">
                                        <span className="font-medium text-xs">{cr.name}</span>
                                        <code className="text-xs font-mono text-muted-foreground">{cr.selector}</code>
                                      </div>
                                      {cr.values.map((v, vi) => (
                                        <div key={vi} className="px-3 py-2 font-mono text-sm border-b last:border-b-0">{v}</div>
                                      ))}
                                      {!cr.values.length && <div className="px-3 py-2 text-xs text-muted-foreground">未找到</div>}
                                    </div>
                                  ))}
                                </TabsContent>
                              )}
                              <TabsContent value="headings" className="m-0 space-y-1.5">
                                {!r.headings.length ? <EmptyState message="无标题" /> : r.headings.map((h, i) => (
                                  <div key={i} className="flex items-start gap-2 p-2.5 rounded bg-muted/30 border text-xs">
                                    <Badge variant="outline" className="font-mono uppercase text-[10px] shrink-0">{h.level}</Badge>
                                    <span>{h.text}</span>
                                  </div>
                                ))}
                              </TabsContent>
                              <TabsContent value="links" className="m-0 space-y-1.5">
                                {!r.links.length ? <EmptyState message="无链接" /> : r.links.map((l, i) => (
                                  <div key={i} className="p-2.5 rounded bg-muted/30 border text-xs">
                                    <div className="font-medium">{l.text}</div>
                                    <a href={l.href} target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono truncate block">{l.href}</a>
                                  </div>
                                ))}
                              </TabsContent>
                              <TabsContent value="paragraphs" className="m-0 space-y-1.5">
                                {!r.paragraphs.length ? <EmptyState message="无段落" /> : r.paragraphs.map((p, i) => (
                                  <div key={i} className="p-2.5 rounded bg-muted/30 border text-xs leading-relaxed">{p}</div>
                                ))}
                              </TabsContent>
                            </ScrollArea>
                          </Tabs>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : (
            !isRunning && (
              <div className="flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg bg-muted/5 p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Play className="h-8 w-8 opacity-40" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">搭好步骤，一键执行</h3>
                <p className="text-sm max-w-sm mb-6">
                  在左侧添加"点击"和"等待"步骤，拖拽调整顺序，保存为方案，之后直接加载复用。
                </p>
                <div className="flex items-center gap-4 text-xs font-mono opacity-50">
                  <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />多步骤序列</div>
                  <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />保存复用</div>
                  <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />支持循环</div>
                </div>
              </div>
            )
          )}

          {isRunning && !loopProgress && (
            <Card className="flex flex-col items-center justify-center py-16 border-dashed border-2 bg-muted/10 animate-in fade-in">
              <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
              <h3 className="text-base font-medium mb-1">正在执行步骤序列</h3>
              <p className="text-sm text-muted-foreground">浏览器正在按顺序执行操作...</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-6 text-muted-foreground">
      <AlertCircle className="h-4 w-4 mr-2 opacity-50" />
      <span className="text-xs">{message}</span>
    </div>
  );
}
