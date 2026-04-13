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
import { useToast } from "@/hooks/use-toast";
import {
  Globe, Type, Link as LinkIcon, AlignLeft, Image as ImageIcon, Code,
  Activity, Search, AlertCircle, CheckCircle2, Play, Loader2,
  MousePointerClick, Plus, Trash2, Target, Crosshair, RefreshCw, Clock,
  TrendingUp, ChevronDown, ChevronUp, ExternalLink,
} from "lucide-react";
import type { ScrapeResult } from "@workspace/api-client-react/src/generated/api.schemas";

const customSelectorSchema = z.object({
  name: z.string().min(1, "请填写名称"),
  selector: z.string().min(1, "请填写选择器"),
});

const formSchema = z.object({
  url: z.string().url({ message: "请输入有效的URL，例如 https://example.com" }),
  options: z.object({
    headings: z.boolean(),
    links: z.boolean(),
    paragraphs: z.boolean(),
    images: z.boolean(),
    metaTags: z.boolean(),
  }),
  clickSelector: z.string().optional(),
  clickWaitMs: z.number().optional(),
  waitForPopupClose: z.boolean(),
  popupTimeoutMs: z.number().optional(),
  customSelectors: z.array(customSelectorSchema),
});

type FormValues = z.infer<typeof formSchema>;

interface Snapshot {
  id: string;
  triggeredAt: string;
  duration: number;
  result: ScrapeResult;
}

export default function Home() {
  const { toast } = useToast();
  const [latestResult, setLatestResult] = useState<ScrapeResult | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [triggerCount, setTriggerCount] = useState(0);
  const [expandedSnapshots, setExpandedSnapshots] = useState<Set<string>>(new Set());
  const snapshotIdRef = useRef(0);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      url: "https://example.com",
      options: { headings: true, links: true, paragraphs: true, images: true, metaTags: true },
      clickSelector: "",
      clickWaitMs: 2000,
      waitForPopupClose: false,
      popupTimeoutMs: 30000,
      customSelectors: [],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "customSelectors" });

  const { mutate, isPending } = useStartScrape({
    mutation: {
      onSuccess: (data) => {
        setLatestResult(data);
        const snap: Snapshot = {
          id: String(++snapshotIdRef.current),
          triggeredAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          duration: data.duration,
          result: data,
        };
        setSnapshots((prev) => [snap, ...prev]);
        setTriggerCount((c) => c + 1);
        toast({ title: `第 ${triggerCount + 1} 次触发完成`, description: `耗时 ${data.duration}ms` });
      },
      onError: (error) => {
        toast({ title: "触发失败", description: error.message || "发生未知错误", variant: "destructive" });
      },
    },
  });

  const { data: health } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });

  const doScrape = useCallback(() => {
    const values = form.getValues();
    mutate({
      data: {
        url: values.url,
        options: {
          ...values.options,
          clickSelector: values.clickSelector || undefined,
          clickWaitMs: values.clickWaitMs,
          waitForPopupClose: values.waitForPopupClose || undefined,
          popupTimeoutMs: values.popupTimeoutMs,
          customSelectors: values.customSelectors.length > 0 ? values.customSelectors : undefined,
        },
      },
    });
  }, [form, mutate]);

  function onSubmit() {
    doScrape();
  }

  const toggleSnapshot = (id: string) => {
    setExpandedSnapshots((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const clearHistory = () => {
    setSnapshots([]);
    setLatestResult(null);
    setTriggerCount(0);
  };

  const hasCustomSelectors = form.watch("customSelectors").length > 0;

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* LEFT: Config */}
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

              {/* Click selector */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MousePointerClick className="h-4 w-4 text-primary" />刷新按钮（可选）
                  </CardTitle>
                  <CardDescription className="text-xs">
                    填写网页上"刷新"按钮的 CSS 选择器，每次触发时浏览器会自动点击它，等待数据更新后再抓取
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <FormField control={form.control} name="clickSelector" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">刷新按钮选择器</FormLabel>
                      <FormControl>
                        <Input placeholder="例如：.refresh-btn 或 #reload" className="font-mono text-xs" {...field} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="clickWaitMs" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">点击后等待时间（毫秒）</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="2000" className="font-mono text-xs" {...field}
                          onChange={e => field.onChange(Number(e.target.value))} />
                      </FormControl>
                    </FormItem>
                  )} />

                  <Separator />

                  <FormField control={form.control} name="waitForPopupClose" render={({ field }) => (
                    <FormItem className="flex items-start gap-3 rounded border p-3 bg-amber-50/50 border-amber-200/60">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />
                      </FormControl>
                      <div className="space-y-1">
                        <FormLabel className="font-medium cursor-pointer flex items-center gap-1.5 text-sm m-0">
                          <ExternalLink className="h-3.5 w-3.5 text-amber-600" />
                          会弹出后台窗口
                        </FormLabel>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          勾选后，工具会自动监听弹出的后台窗口，等它自动关闭之后，再抓取主页面的最新数据
                        </p>
                      </div>
                    </FormItem>
                  )} />

                  {form.watch("waitForPopupClose") && (
                    <FormField control={form.control} name="popupTimeoutMs" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-muted-foreground">等待弹窗关闭的最长时间（毫秒）</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="30000" className="font-mono text-xs" {...field}
                            onChange={e => field.onChange(Number(e.target.value))} />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">默认 30 秒，超时会自动用固定等待时间兜底</p>
                      </FormItem>
                    )} />
                  )}
                </CardContent>
              </Card>

              {/* Custom selectors */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Crosshair className="h-4 w-4 text-primary" />要监控的数据
                  </CardTitle>
                  <CardDescription className="text-xs">
                    添加你想跟踪的数据位置，每次触发都会记录这些值的变化
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {fields.map((field, index) => (
                    <div key={field.id} className="flex gap-2 items-start p-3 bg-muted/30 rounded-md border">
                      <div className="flex-1 space-y-2 min-w-0">
                        <FormField control={form.control} name={`customSelectors.${index}.name`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input placeholder="名称（如：最新消息、价格）" className="text-xs h-7" {...field} />
                              </FormControl>
                              <FormMessage className="text-xs" />
                            </FormItem>
                          )} />
                        <FormField control={form.control} name={`customSelectors.${index}.selector`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input placeholder="CSS选择器（如：.msg-title）" className="font-mono text-xs h-7" {...field} />
                              </FormControl>
                              <FormMessage className="text-xs" />
                            </FormItem>
                          )} />
                      </div>
                      <Button type="button" variant="ghost" size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive mt-0.5"
                        onClick={() => remove(index)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm"
                    className="w-full text-xs h-8 border-dashed"
                    onClick={() => append({ name: "", selector: "" })}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" />添加监控项
                  </Button>
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
                        <FormField key={key} control={form.control} name={`options.${key}`}
                          render={({ field }) => (
                            <FormItem className="flex items-center gap-3 rounded border p-2.5 hover:bg-muted/40 transition-colors">
                              <FormControl>
                                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                              </FormControl>
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
                  <div className="flex items-center gap-1.5">
                    {health ? (
                      <>
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                        </span>
                        <span className="text-green-600 font-medium">在线</span>
                      </>
                    ) : <span>检查中...</span>}
                  </div>
                </CardFooter>
              </Card>

              {/* Trigger button */}
              <Button type="submit" className="w-full" size="lg" disabled={isPending}>
                {isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在执行抓取...</>
                ) : (
                  <><RefreshCw className="mr-2 h-4 w-4" />
                    {triggerCount === 0 ? "开始第一次抓取" : `触发第 ${triggerCount + 1} 次抓取`}
                  </>
                )}
              </Button>
            </form>
          </Form>
        </div>

        {/* RIGHT: Results */}
        <div className="lg:col-span-8 space-y-4">

          {/* Status bar */}
          {triggerCount > 0 && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border rounded-lg text-sm animate-in fade-in">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="font-medium">已触发 {triggerCount} 次</span>
                </div>
                {latestResult && (
                  <span className="text-muted-foreground text-xs">
                    最后一次：{snapshots[0]?.triggeredAt} · {latestResult.duration}ms
                  </span>
                )}
              </div>
              <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground" onClick={clearHistory}>
                清空记录
              </Button>
            </div>
          )}

          {/* Custom selector tracking — shows value changes across triggers */}
          {hasCustomSelectors && snapshots.length > 0 && (
            <Card className="border-border/50 shadow-sm animate-in fade-in">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4 text-primary" />数据变化追踪
                </CardTitle>
                <CardDescription className="text-xs">每次触发后，自定义监控项的最新值</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {form.getValues("customSelectors").map((cs, csIdx) => {
                    const allValues = snapshots.map((snap) => {
                      const cr = snap.result.customResults?.find((r) => r.selector === cs.selector);
                      return { time: snap.triggeredAt, values: cr?.values ?? [] };
                    });
                    const latest = allValues[0];
                    const previous = allValues[1];
                    const hasChanged = previous &&
                      JSON.stringify(latest?.values) !== JSON.stringify(previous?.values);

                    return (
                      <div key={csIdx} className="border rounded-md overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b">
                          <div className="flex items-center gap-2">
                            <Crosshair className="h-3.5 w-3.5 text-primary" />
                            <span className="font-medium text-sm">{cs.name}</span>
                            <code className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{cs.selector}</code>
                          </div>
                          {hasChanged && (
                            <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200">数据已变化</Badge>
                          )}
                        </div>

                        {/* Latest value(s) */}
                        <div className="px-3 py-2.5">
                          {latest?.values.length === 0 ? (
                            <span className="text-xs text-muted-foreground">未找到匹配内容</span>
                          ) : (
                            <div className="space-y-1">
                              {latest?.values.map((v, vi) => (
                                <div key={vi} className="font-mono text-sm font-medium">{v}</div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* History mini-table */}
                        {allValues.length > 1 && (
                          <div className="border-t px-3 py-2 bg-muted/10">
                            <p className="text-xs text-muted-foreground mb-1.5">历史记录（最近 {allValues.length} 次）</p>
                            <div className="space-y-1">
                              {allValues.map((entry, ei) => (
                                <div key={ei} className="flex items-start gap-2 text-xs">
                                  <span className="text-muted-foreground font-mono w-16 shrink-0">{entry.time}</span>
                                  <span className={`font-mono ${ei === 0 ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                                    {entry.values.length > 0 ? entry.values.join(" / ") : "—"}
                                  </span>
                                  {ei === 0 && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 ml-auto">最新</Badge>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Snapshot history */}
          {snapshots.length > 0 ? (
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-4 w-4 text-primary" />触发记录
                </CardTitle>
                <CardDescription className="text-xs">每次手动触发的完整抓取结果</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 p-0">
                {snapshots.map((snap, idx) => {
                  const isExpanded = expandedSnapshots.has(snap.id);
                  const r = snap.result;
                  const totalItems = (r.headings?.length || 0) + (r.links?.length || 0) +
                    (r.paragraphs?.length || 0) + (r.images?.length || 0) + (r.metaTags?.length || 0) +
                    (r.customResults ?? []).reduce((s, cr) => s + cr.values.length, 0);

                  return (
                    <div key={snap.id} className={`border-t first:border-t-0 ${idx === 0 ? "bg-muted/10" : ""}`}>
                      {/* Snapshot header — always visible */}
                      <button
                        type="button"
                        className="w-full flex items-center justify-between px-6 py-3 hover:bg-muted/20 transition-colors text-left"
                        onClick={() => toggleSnapshot(snap.id)}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`h-2 w-2 rounded-full shrink-0 ${idx === 0 ? "bg-primary" : "bg-muted-foreground/30"}`} />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">第 {snapshots.length - idx} 次触发</span>
                              {idx === 0 && <Badge variant="outline" className="text-xs px-1.5 py-0 h-4">最新</Badge>}
                              {r.clickedElement && (
                                <span className="flex items-center gap-1 text-xs text-emerald-600">
                                  <MousePointerClick className="h-3 w-3" />已点击刷新
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">{snap.triggeredAt} · {snap.duration}ms · {totalItems} 项</div>
                          </div>
                        </div>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="px-6 pb-4 animate-in fade-in slide-in-from-top-2 duration-200">
                          <Tabs defaultValue={r.customResults && r.customResults.length > 0 ? "custom" : "headings"}>
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
                                      {cr.values.length === 0 && (
                                        <div className="px-3 py-2 text-xs text-muted-foreground">未找到匹配内容</div>
                                      )}
                                    </div>
                                  ))}
                                </TabsContent>
                              )}
                              <TabsContent value="headings" className="m-0 space-y-1.5">
                                {r.headings.length === 0 ? <EmptyState message="无标题" /> : r.headings.map((h, i) => (
                                  <div key={i} className="flex items-start gap-2 p-2.5 rounded bg-muted/30 border text-xs">
                                    <Badge variant="outline" className="font-mono uppercase text-[10px] shrink-0">{h.level}</Badge>
                                    <span>{h.text}</span>
                                  </div>
                                ))}
                              </TabsContent>
                              <TabsContent value="links" className="m-0 space-y-1.5">
                                {r.links.length === 0 ? <EmptyState message="无链接" /> : r.links.map((l, i) => (
                                  <div key={i} className="p-2.5 rounded bg-muted/30 border text-xs">
                                    <div className="font-medium">{l.text}</div>
                                    <a href={l.href} target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono truncate block">{l.href}</a>
                                  </div>
                                ))}
                              </TabsContent>
                              <TabsContent value="paragraphs" className="m-0 space-y-1.5">
                                {r.paragraphs.length === 0 ? <EmptyState message="无段落" /> : r.paragraphs.map((p, i) => (
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
            !isPending && (
              <div className="flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg bg-muted/5 p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <RefreshCw className="h-8 w-8 opacity-40" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">等待第一次触发</h3>
                <p className="text-sm max-w-sm mb-6">
                  配置好刷新按钮选择器和要监控的数据后，每次点击"触发抓取"，工具会自动点击网页刷新、等待数据更新，再把最新内容记录下来。
                </p>
                <div className="flex items-center gap-4 text-xs font-mono opacity-50">
                  <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />自动点击刷新</div>
                  <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />抓取最新数据</div>
                  <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />记录变化历史</div>
                </div>
              </div>
            )
          )}

          {isPending && (
            <Card className="flex flex-col items-center justify-center py-16 border-dashed border-2 bg-muted/10 animate-in fade-in">
              <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
              <h3 className="text-base font-medium mb-1">正在执行触发</h3>
              <p className="text-sm text-muted-foreground">浏览器正在自动点击刷新并抓取最新数据...</p>
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
