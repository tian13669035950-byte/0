import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useStartScrape, useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Globe, Type, Link as LinkIcon, AlignLeft, Image as ImageIcon, Code, Activity, Search, AlertCircle, CheckCircle2, Play, Download, Loader2 } from "lucide-react";
import type { ScrapeResult, ScrapeOptions } from "@workspace/api-client-react/src/generated/api.schemas";

const formSchema = z.object({
  url: z.string().url({ message: "请输入有效的URL，例如 https://example.com" }),
  options: z.object({
    headings: z.boolean(),
    links: z.boolean(),
    paragraphs: z.boolean(),
    images: z.boolean(),
    metaTags: z.boolean(),
  }).refine(data => Object.values(data).some(v => v), {
    message: "请至少选择一项抓取内容",
  }),
});

export default function Home() {
  const { toast } = useToast();
  const [result, setResult] = useState<ScrapeResult | null>(null);
  
  const form = useForm<z.infer<typeof formSchema>>({
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
    },
  });

  const { mutate, isPending } = useStartScrape({
    mutation: {
      onSuccess: (data) => {
        setResult(data);
        toast({
          title: "抓取成功",
          description: `耗时 ${data.duration}ms`,
        });
      },
      onError: (error) => {
        toast({
          title: "抓取失败",
          description: error.message || "发生未知错误",
          variant: "destructive",
        });
      }
    }
  });

  const { data: health } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });

  function onSubmit(values: z.infer<typeof formSchema>) {
    setResult(null);
    mutate({ data: { url: values.url, options: values.options } });
  }

  const getTotalItems = (res: ScrapeResult | null) => {
    if (!res) return 0;
    return (res.headings?.length || 0) + 
           (res.links?.length || 0) + 
           (res.paragraphs?.length || 0) + 
           (res.images?.length || 0) + 
           (res.metaTags?.length || 0);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Input Form */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="border-border/50 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Globe className="h-5 w-5 text-primary" />
                配置抓取任务
              </CardTitle>
              <CardDescription>
                输入目标网址并选择需要提取的数据类型。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>目标 URL</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="https://" className="pl-9 font-mono" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-4">
                    <Label className="text-sm font-medium">提取选项</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
                      <FormField
                        control={form.control}
                        name="options.headings"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3 shadow-sm hover:bg-muted/50 transition-colors">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel className="font-medium cursor-pointer flex items-center gap-2">
                                <Type className="h-3.5 w-3.5 text-muted-foreground" />
                                标题 (Headings)
                              </FormLabel>
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="options.links"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3 shadow-sm hover:bg-muted/50 transition-colors">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel className="font-medium cursor-pointer flex items-center gap-2">
                                <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                链接 (Links)
                              </FormLabel>
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="options.paragraphs"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3 shadow-sm hover:bg-muted/50 transition-colors">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel className="font-medium cursor-pointer flex items-center gap-2">
                                <AlignLeft className="h-3.5 w-3.5 text-muted-foreground" />
                                段落 (Paragraphs)
                              </FormLabel>
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="options.images"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3 shadow-sm hover:bg-muted/50 transition-colors">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel className="font-medium cursor-pointer flex items-center gap-2">
                                <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                图片 (Images)
                              </FormLabel>
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="options.metaTags"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3 shadow-sm hover:bg-muted/50 transition-colors">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel className="font-medium cursor-pointer flex items-center gap-2">
                                <Code className="h-3.5 w-3.5 text-muted-foreground" />
                                元数据 (Meta Tags)
                              </FormLabel>
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  <Button type="submit" className="w-full" disabled={isPending}>
                    {isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        正在抓取，请稍候...
                      </>
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        开始抓取
                      </>
                    )}
                  </Button>
                </form>
              </Form>
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
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    <span className="text-green-600 font-medium">在线 ({health.status})</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">检查中...</span>
                )}
              </div>
            </CardFooter>
          </Card>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-8 flex flex-col h-[calc(100vh-8rem)]">
          {isPending ? (
            <Card className="flex-1 flex flex-col items-center justify-center border-dashed border-2 bg-muted/10 animate-in fade-in duration-500">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                <Globe className="h-8 w-8 text-primary animate-pulse" />
              </div>
              <h3 className="text-lg font-medium mb-2">正在分析网页结构</h3>
              <p className="text-sm text-muted-foreground max-w-sm text-center mb-8">
                后端正在启动无头浏览器，加载目标页面并执行提取逻辑，这可能需要 5-15 秒。
              </p>
              <div className="w-64 space-y-2">
                <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary w-full origin-left animate-[progress_2s_ease-in-out_infinite]"></div>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>连接服务器</span>
                  <span>提取 DOM</span>
                </div>
              </div>
            </Card>
          ) : result ? (
            <Card className="flex-1 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-500 shadow-md border-border/60">
              <CardHeader className="pb-4 shrink-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-xl mb-1 truncate max-w-[500px]" title={result.title}>
                      {result.title || '无标题页面'}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 truncate">
                      <a href={result.url} target="_blank" rel="noreferrer" className="hover:underline hover:text-primary transition-colors inline-flex items-center gap-1">
                        {result.url}
                        <LinkIcon className="h-3 w-3" />
                      </a>
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3 bg-muted/50 p-2.5 rounded-lg shrink-0">
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
              
              <Tabs defaultValue="headings" className="flex-1 flex flex-col min-h-0">
                <div className="px-6 border-b shrink-0">
                  <TabsList className="h-10 w-full justify-start bg-transparent p-0">
                    {result.headings && (
                      <TabsTrigger value="headings" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4">
                        <Type className="h-4 w-4 mr-2" />
                        标题 <Badge variant="secondary" className="ml-2 font-mono">{result.headings.length}</Badge>
                      </TabsTrigger>
                    )}
                    {result.links && (
                      <TabsTrigger value="links" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4">
                        <LinkIcon className="h-4 w-4 mr-2" />
                        链接 <Badge variant="secondary" className="ml-2 font-mono">{result.links.length}</Badge>
                      </TabsTrigger>
                    )}
                    {result.paragraphs && (
                      <TabsTrigger value="paragraphs" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4">
                        <AlignLeft className="h-4 w-4 mr-2" />
                        段落 <Badge variant="secondary" className="ml-2 font-mono">{result.paragraphs.length}</Badge>
                      </TabsTrigger>
                    )}
                    {result.images && (
                      <TabsTrigger value="images" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4">
                        <ImageIcon className="h-4 w-4 mr-2" />
                        图片 <Badge variant="secondary" className="ml-2 font-mono">{result.images.length}</Badge>
                      </TabsTrigger>
                    )}
                    {result.metaTags && (
                      <TabsTrigger value="metaTags" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4">
                        <Code className="h-4 w-4 mr-2" />
                        元数据 <Badge variant="secondary" className="ml-2 font-mono">{result.metaTags.length}</Badge>
                      </TabsTrigger>
                    )}
                  </TabsList>
                </div>
                
                <ScrollArea className="flex-1 p-6">
                  {result.headings && (
                    <TabsContent value="headings" className="m-0 focus-visible:outline-none">
                      {result.headings.length === 0 ? (
                        <EmptyState message="未找到标题 (h1-h6) 标签" />
                      ) : (
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
                  )}
                  
                  {result.links && (
                    <TabsContent value="links" className="m-0 focus-visible:outline-none">
                      {result.links.length === 0 ? (
                        <EmptyState message="未找到链接 (a) 标签" />
                      ) : (
                        <div className="space-y-2">
                          {result.links.map((link, i) => (
                            <div key={i} className="flex flex-col gap-1 p-3 rounded-md bg-muted/30 border hover:bg-muted/50 transition-colors">
                              <span className="text-sm font-medium">{link.text || '无文本'}</span>
                              <a href={link.href} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline font-mono truncate">
                                {link.href}
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>
                  )}
                  
                  {result.paragraphs && (
                    <TabsContent value="paragraphs" className="m-0 focus-visible:outline-none">
                      {result.paragraphs.length === 0 ? (
                        <EmptyState message="未找到段落 (p) 标签" />
                      ) : (
                        <div className="space-y-4">
                          {result.paragraphs.map((p, i) => (
                            <div key={i} className="p-4 rounded-md bg-muted/30 border text-sm leading-relaxed">
                              {p}
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>
                  )}
                  
                  {result.images && (
                    <TabsContent value="images" className="m-0 focus-visible:outline-none">
                      {result.images.length === 0 ? (
                        <EmptyState message="未找到图片 (img) 标签" />
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {result.images.map((img, i) => (
                            <div key={i} className="flex flex-col gap-2 p-3 rounded-md bg-muted/30 border">
                              <div className="aspect-video bg-muted rounded overflow-hidden flex items-center justify-center relative group">
                                <img src={img.src} alt={img.alt} className="max-w-full max-h-full object-contain" loading="lazy" />
                              </div>
                              <div className="flex flex-col gap-1 mt-1">
                                <span className="text-xs font-medium text-muted-foreground truncate" title={img.alt}>Alt: {img.alt || '无'}</span>
                                <a href={img.src} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline font-mono truncate" title={img.src}>
                                  {img.src}
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>
                  )}
                  
                  {result.metaTags && (
                    <TabsContent value="metaTags" className="m-0 focus-visible:outline-none">
                      {result.metaTags.length === 0 ? (
                        <EmptyState message="未找到元数据 (meta) 标签" />
                      ) : (
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
                  )}
                </ScrollArea>
              </Tabs>
            </Card>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg bg-muted/5 p-8 text-center h-full">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Code className="h-8 w-8 opacity-50" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">等待抓取指令</h3>
              <p className="text-sm max-w-sm mb-6">
                在左侧配置目标 URL 并选择需要提取的元素，点击"开始抓取"按钮，系统将自动分析网页结构并提取结构化数据。
              </p>
              <div className="flex items-center gap-4 text-xs font-mono opacity-60">
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> 无头浏览器</div>
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> DOM 解析</div>
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> JSON 格式化</div>
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
