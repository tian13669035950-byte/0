import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useStartScrape, useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  MousePointerClick, Plus, Trash2, Target, Crosshair,
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
  customSelectors: z.array(customSelectorSchema),
});

type FormValues = z.infer<typeof formSchema>;

export default function Home() {
  const { toast } = useToast();
  const [result, setResult] = useState<ScrapeResult | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      url: "https://example.com",
      options: {
        headings: true,
        links: true,
        paragraphs: true,
        images: true,
        metaTags: true,
      },
      clickSelector: "",
      clickWaitMs: 2000,
      customSelectors: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "customSelectors",
  });

  const { mutate, isPending } = useStartScrape({
    mutation: {
      onSuccess: (data) => {
        setResult(data);
        toast({ title: "抓取成功", description: `耗时 ${data.duration}ms，共提取 ${getTotalItems(data)} 项` });
      },
      onError: (error) => {
        toast({ title: "抓取失败", description: error.message || "发生未知错误", variant: "destructive" });
      },
    },
  });

  const { data: health } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });

  function onSubmit(values: FormValues) {
    setResult(null);
    mutate({
      data: {
        url: values.url,
        options: {
          ...values.options,
          clickSelector: values.clickSelector || undefined,
          clickWaitMs: values.clickWaitMs,
          customSelectors: values.customSelectors.length > 0 ? values.customSelectors : undefined,
        },
      },
    });
  }

  const getTotalItems = (res: ScrapeResult | null) => {
    if (!res) return 0;
    const custom = (res.customResults ?? []).reduce((s, r) => s + r.values.length, 0);
    return (res.headings?.length || 0) + (res.links?.length || 0) +
      (res.paragraphs?.length || 0) + (res.images?.length || 0) +
      (res.metaTags?.length || 0) + custom;
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* LEFT: Config panel */}
        <div className="lg:col-span-4 space-y-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

              {/* URL input */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Globe className="h-4 w-4 text-primary" />
                    目标网址
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="url"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <div className="relative">
                            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="https://" className="pl-9 font-mono text-sm" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Click-before-scrape */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MousePointerClick className="h-4 w-4 text-primary" />
                    点击操作（可选）
                  </CardTitle>
                  <CardDescription className="text-xs">
                    填写 CSS 选择器，浏览器会先点击该元素，再抓取点击后的内容
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <FormField
                    control={form.control}
                    name="clickSelector"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-muted-foreground">点击元素的选择器</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="例如：.new-message-btn 或 #load-more"
                            className="font-mono text-xs"
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="clickWaitMs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-muted-foreground">点击后等待时间（毫秒）</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="2000"
                            className="font-mono text-xs"
                            {...field}
                            onChange={e => field.onChange(Number(e.target.value))}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Custom selectors */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Crosshair className="h-4 w-4 text-primary" />
                    自定义提取（可选）
                  </CardTitle>
                  <CardDescription className="text-xs">
                    指定 CSS 选择器，精准提取页面上特定位置的文字或数字
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {fields.map((field, index) => (
                    <div key={field.id} className="flex gap-2 items-start p-3 bg-muted/30 rounded-md border">
                      <div className="flex-1 space-y-2 min-w-0">
                        <FormField
                          control={form.control}
                          name={`customSelectors.${index}.name`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  placeholder="名称（如：价格、访客数）"
                                  className="text-xs h-7"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage className="text-xs" />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`customSelectors.${index}.selector`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  placeholder="CSS选择器（如：.price 或 #count）"
                                  className="font-mono text-xs h-7"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage className="text-xs" />
                            </FormItem>
                          )}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive mt-0.5"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full text-xs h-8 border-dashed"
                    onClick={() => append({ name: "", selector: "" })}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    添加提取规则
                  </Button>
                </CardContent>
              </Card>

              {/* Standard extract options */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Target className="h-4 w-4 text-primary" />
                    通用提取选项
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-2">
                    {(["headings", "links", "paragraphs", "images", "metaTags"] as const).map((key) => {
                      const labels: Record<string, { label: string; icon: React.ReactNode }> = {
                        headings: { label: "标题 (Headings)", icon: <Type className="h-3 w-3" /> },
                        links: { label: "链接 (Links)", icon: <LinkIcon className="h-3 w-3" /> },
                        paragraphs: { label: "段落 (Paragraphs)", icon: <AlignLeft className="h-3 w-3" /> },
                        images: { label: "图片 (Images)", icon: <ImageIcon className="h-3 w-3" /> },
                        metaTags: { label: "元数据 (Meta Tags)", icon: <Code className="h-3 w-3" /> },
                      };
                      return (
                        <FormField
                          key={key}
                          control={form.control}
                          name={`options.${key}`}
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
                          )}
                        />
                      );
                    })}
                  </div>
                </CardContent>
                <CardFooter className="bg-muted/30 border-t py-3 flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5" />
                    API 状态
                  </div>
                  <div className="flex items-center gap-1.5">
                    {health ? (
                      <>
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                        </span>
                        <span className="text-green-600 font-medium">在线 ({health.status})</span>
                      </>
                    ) : (
                      <span>检查中...</span>
                    )}
                  </div>
                </CardFooter>
              </Card>

              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在抓取，请稍候...</>
                ) : (
                  <><Play className="mr-2 h-4 w-4" />开始抓取</>
                )}
              </Button>
            </form>
          </Form>
        </div>

        {/* RIGHT: Results */}
        <div className="lg:col-span-8 flex flex-col" style={{ minHeight: "calc(100vh - 8rem)" }}>
          {isPending ? (
            <Card className="flex-1 flex flex-col items-center justify-center border-dashed border-2 bg-muted/10 animate-in fade-in duration-500">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                <Globe className="h-8 w-8 text-primary animate-pulse" />
              </div>
              <h3 className="text-lg font-medium mb-2">正在分析网页结构</h3>
              <p className="text-sm text-muted-foreground max-w-sm text-center mb-8">
                后端正在启动无头浏览器，加载目标页面并执行提取逻辑，这可能需要 5-20 秒。
              </p>
              <div className="w-64 space-y-2">
                <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary w-1/3 rounded-full animate-[pulse_1.5s_ease-in-out_infinite]" />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>启动浏览器</span>
                  <span>提取 DOM</span>
                </div>
              </div>
            </Card>
          ) : result ? (
            <Card className="flex-1 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-500 shadow-md border-border/60">
              <CardHeader className="pb-4 shrink-0">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-lg mb-1 truncate" title={result.title}>
                      {result.title || "无标题页面"}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 truncate text-xs">
                      <a href={result.url} target="_blank" rel="noreferrer" className="hover:underline hover:text-primary transition-colors inline-flex items-center gap-1">
                        {result.url}<LinkIcon className="h-3 w-3" />
                      </a>
                    </CardDescription>
                    {result.clickedElement && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600">
                        <MousePointerClick className="h-3 w-3" />
                        已点击：<code className="font-mono bg-muted px-1 py-0.5 rounded">{result.clickedElement}</code>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 bg-muted/50 p-2.5 rounded-lg shrink-0 self-start">
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-muted-foreground mb-0.5">总耗时</span>
                      <span className="font-mono font-medium text-sm">{result.duration}ms</span>
                    </div>
                    <Separator orientation="vertical" className="h-8" />
                    <div className="flex flex-col items-start">
                      <span className="text-xs text-muted-foreground mb-0.5">提取总数</span>
                      <span className="font-mono font-medium text-sm text-primary">{getTotalItems(result)} 项</span>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <Tabs defaultValue={result.customResults && result.customResults.length > 0 ? "custom" : "headings"} className="flex-1 flex flex-col min-h-0">
                <div className="px-6 border-b shrink-0 overflow-x-auto">
                  <TabsList className="h-10 w-max justify-start bg-transparent p-0 flex">
                    {result.customResults && result.customResults.length > 0 && (
                      <TabsTrigger value="custom" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 whitespace-nowrap">
                        <Crosshair className="h-4 w-4 mr-2" />
                        自定义 <Badge variant="secondary" className="ml-2 font-mono bg-primary/10 text-primary">{result.customResults.reduce((s, r) => s + r.values.length, 0)}</Badge>
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="headings" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 whitespace-nowrap">
                      <Type className="h-4 w-4 mr-2" />
                      标题 <Badge variant="secondary" className="ml-2 font-mono">{result.headings.length}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="links" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 whitespace-nowrap">
                      <LinkIcon className="h-4 w-4 mr-2" />
                      链接 <Badge variant="secondary" className="ml-2 font-mono">{result.links.length}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="paragraphs" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 whitespace-nowrap">
                      <AlignLeft className="h-4 w-4 mr-2" />
                      段落 <Badge variant="secondary" className="ml-2 font-mono">{result.paragraphs.length}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="images" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 whitespace-nowrap">
                      <ImageIcon className="h-4 w-4 mr-2" />
                      图片 <Badge variant="secondary" className="ml-2 font-mono">{result.images.length}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="metaTags" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 whitespace-nowrap">
                      <Code className="h-4 w-4 mr-2" />
                      元数据 <Badge variant="secondary" className="ml-2 font-mono">{result.metaTags.length}</Badge>
                    </TabsTrigger>
                  </TabsList>
                </div>

                <ScrollArea className="flex-1 p-6">
                  {/* Custom results tab */}
                  {result.customResults && result.customResults.length > 0 && (
                    <TabsContent value="custom" className="m-0 focus-visible:outline-none space-y-4">
                      {result.customResults.map((cr, i) => (
                        <div key={i} className="border rounded-md overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
                            <div className="flex items-center gap-2">
                              <Crosshair className="h-4 w-4 text-primary" />
                              <span className="font-medium text-sm">{cr.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <code className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">{cr.selector}</code>
                              <Badge variant="outline" className="font-mono text-xs">{cr.values.length} 项</Badge>
                            </div>
                          </div>
                          {cr.values.length === 0 ? (
                            <div className="p-4 text-sm text-muted-foreground text-center">未找到匹配元素</div>
                          ) : (
                            <div className="divide-y">
                              {cr.values.map((val, j) => (
                                <div key={j} className="px-4 py-2.5 text-sm font-mono hover:bg-muted/30 transition-colors flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground w-6 shrink-0">{j + 1}</span>
                                  <span className="font-medium">{val}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </TabsContent>
                  )}

                  <TabsContent value="headings" className="m-0 focus-visible:outline-none">
                    {result.headings.length === 0 ? <EmptyState message="未找到标题标签" /> : (
                      <div className="space-y-2">
                        {result.headings.map((h, i) => (
                          <div key={i} className="flex items-start gap-3 p-3 rounded-md bg-muted/30 border hover:bg-muted/50 transition-colors">
                            <Badge variant="outline" className="font-mono text-xs uppercase mt-0.5 shrink-0 text-primary border-primary/20 bg-primary/5">{h.level}</Badge>
                            <span className="text-sm">{h.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="links" className="m-0 focus-visible:outline-none">
                    {result.links.length === 0 ? <EmptyState message="未找到链接" /> : (
                      <div className="space-y-2">
                        {result.links.map((link, i) => (
                          <div key={i} className="flex flex-col gap-1 p-3 rounded-md bg-muted/30 border hover:bg-muted/50 transition-colors">
                            <span className="text-sm font-medium">{link.text || "无文本"}</span>
                            <a href={link.href} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline font-mono truncate">{link.href}</a>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="paragraphs" className="m-0 focus-visible:outline-none">
                    {result.paragraphs.length === 0 ? <EmptyState message="未找到段落" /> : (
                      <div className="space-y-4">
                        {result.paragraphs.map((p, i) => (
                          <div key={i} className="p-4 rounded-md bg-muted/30 border text-sm leading-relaxed">{p}</div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="images" className="m-0 focus-visible:outline-none">
                    {result.images.length === 0 ? <EmptyState message="未找到图片" /> : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {result.images.map((img, i) => (
                          <div key={i} className="flex flex-col gap-2 p-3 rounded-md bg-muted/30 border">
                            <div className="aspect-video bg-muted rounded overflow-hidden flex items-center justify-center">
                              <img src={img.src} alt={img.alt} className="max-w-full max-h-full object-contain" loading="lazy" />
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-medium text-muted-foreground truncate">Alt: {img.alt || "无"}</span>
                              <a href={img.src} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline font-mono truncate">{img.src}</a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="metaTags" className="m-0 focus-visible:outline-none">
                    {result.metaTags.length === 0 ? <EmptyState message="未找到元数据" /> : (
                      <div className="rounded-md border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50 border-b">
                            <tr>
                              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-1/3">Name / Property</th>
                              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Content</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {result.metaTags.map((meta, i) => (
                              <tr key={i} className="hover:bg-muted/30">
                                <td className="px-4 py-3 font-mono text-xs text-primary">{meta.name}</td>
                                <td className="px-4 py-3 font-mono text-xs break-all">{meta.content}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </TabsContent>
                </ScrollArea>
              </Tabs>
            </Card>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg bg-muted/5 p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Code className="h-8 w-8 opacity-50" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">等待抓取指令</h3>
              <p className="text-sm max-w-sm mb-6">
                在左侧配置目标 URL，可选填写点击操作和自定义选择器，然后点击"开始抓取"。
              </p>
              <div className="flex items-center gap-4 text-xs font-mono opacity-60">
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> 无头浏览器</div>
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> DOM 解析</div>
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> 自定义选择</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border rounded-md bg-muted/10 border-dashed">
      <AlertCircle className="h-8 w-8 mb-3 opacity-50" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
