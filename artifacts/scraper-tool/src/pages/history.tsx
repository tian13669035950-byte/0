import { useGetScrapeHistory, getGetScrapeHistoryQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Clock, Globe, CalendarDays, ExternalLink, Activity,
  Database, Loader2, ChevronDown, ChevronUp, Crosshair, Search
} from "lucide-react";
import { useState } from "react";

export default function History() {
  const { data: history, isLoading, error } = useGetScrapeHistory({
    query: {
      queryKey: getGetScrapeHistoryQueryKey(),
      refetchOnWindowFocus: true,
      refetchInterval: 5000,
    }
  });

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-4xl">
      <div className="mb-4 sm:mb-6 space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">历史记录</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">所有执行过的抓取任务，点击展开查看读取到的数据。</p>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Database className="h-4 w-4" />
          {history ? <span>共 <span className="font-semibold text-foreground">{history.length}</span> 条记录</span> : "加载中..."}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary/60" />
          <p>加载历史记录中...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 text-destructive">
          <Activity className="h-8 w-8 mb-4 opacity-50" />
          <p>加载失败，请重试</p>
        </div>
      ) : !history || history.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed rounded-xl">
          <Globe className="h-12 w-12 mb-4 opacity-20" />
          <h3 className="text-lg font-medium text-foreground mb-1">暂无抓取记录</h3>
          <p className="text-sm">返回抓取面板执行第一个任务</p>
        </div>
      ) : (
        <div className="space-y-2">
          {history.map((item, idx) => {
            const isOpen = expanded.has(item.id);
            const hasVars = item.capturedVars && Object.keys(item.capturedVars).length > 0;
            const hasCustom = item.customResults && item.customResults.some(r => r.values.length > 0);
            const hasData = hasVars || hasCustom;

            return (
              <Card key={item.id} className={`border-border/60 shadow-sm overflow-hidden transition-all ${idx === 0 ? "border-primary/30 bg-primary/[0.02]" : ""}`}>
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => hasData && toggle(item.id)}
                >
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${idx === 0 ? "bg-primary" : "bg-muted-foreground/30"}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-medium text-sm truncate">{item.title || "无标题"}</span>
                            {idx === 0 && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">最新</Badge>}
                            {hasVars && (
                              <Badge className="text-[10px] px-1.5 py-0 h-4 bg-teal-100 text-teal-700 border-teal-200">
                                {Object.keys(item.capturedVars!).length} 个变量
                              </Badge>
                            )}
                            {hasCustom && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                {item.customResults!.reduce((s, r) => s + r.values.length, 0)} 条数据
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1 truncate max-w-[260px]">
                              <Globe className="h-3 w-3 shrink-0" />
                              <a href={item.url} target="_blank" rel="noreferrer"
                                className="truncate hover:text-primary transition-colors"
                                onClick={e => e.stopPropagation()}
                              >
                                {item.url}
                              </a>
                              <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                            </span>
                            <span className="flex items-center gap-1">
                              <CalendarDays className="h-3 w-3" />
                              {format(new Date(item.scrapedAt), "MM-dd HH:mm:ss")}
                            </span>
                            <span className="flex items-center gap-1 font-mono">
                              <Clock className="h-3 w-3" />
                              {item.duration}ms
                            </span>
                          </div>
                        </div>
                      </div>
                      {hasData && (
                        isOpen
                          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                      )}
                    </div>
                  </CardHeader>
                </button>

                {isOpen && hasData && (
                  <CardContent className="px-4 pb-4 pt-0 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="space-y-3 ml-5">

                      {/* Captured variables */}
                      {hasVars && (
                        <div>
                          <div className="flex items-center gap-1.5 text-xs font-medium text-teal-700 mb-2">
                            <Crosshair className="h-3.5 w-3.5" />
                            读取保存的变量
                          </div>
                          <div className="border border-teal-200 rounded-lg overflow-hidden">
                            {Object.entries(item.capturedVars!).map(([k, v], i) => (
                              <div key={k} className={`flex items-center gap-3 px-3 py-2.5 ${i > 0 ? "border-t border-teal-100" : ""} bg-teal-50/50`}>
                                <code className="text-xs font-mono bg-white border border-teal-200 px-2 py-0.5 rounded text-teal-600 shrink-0">{k}</code>
                                <span className="font-mono text-sm font-semibold text-teal-800 break-all">{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Custom selector results */}
                      {hasCustom && (
                        <div>
                          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                            <Search className="h-3.5 w-3.5" />
                            自定义数据
                          </div>
                          <div className="space-y-2">
                            {item.customResults!.filter(r => r.values.length > 0).map((cr, ci) => (
                              <div key={ci} className="border rounded-lg overflow-hidden">
                                <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b flex-wrap">
                                  <span className="font-medium text-xs shrink-0">{cr.name}</span>
                                  <code className="text-xs font-mono text-muted-foreground truncate max-w-full">{cr.selector}</code>
                                </div>
                                {cr.values.map((v, vi) => (
                                  <div key={vi} className="px-3 py-2 font-mono text-sm border-b last:border-b-0 break-all">{v}</div>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
