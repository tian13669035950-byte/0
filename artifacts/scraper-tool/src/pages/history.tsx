import { useGetScrapeHistory, getGetScrapeHistoryQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Globe, CalendarDays, ExternalLink, Activity, Database, Loader2 } from "lucide-react";

export default function History() {
  const { data: history, isLoading, error } = useGetScrapeHistory({ 
    query: { 
      queryKey: getGetScrapeHistoryQueryKey(),
      refetchOnWindowFocus: true
    } 
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">历史记录</h1>
        <p className="text-muted-foreground">
          查看所有过去的网页抓取任务及其基本统计信息。
        </p>
      </div>

      <Card className="shadow-sm border-border/60">
        <CardHeader className="bg-muted/30 border-b">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                抓取任务归档
              </CardTitle>
            </div>
            {history && (
              <Badge variant="outline" className="font-mono bg-background">
                共 {history.length} 条记录
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
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
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Globe className="h-12 w-12 mb-4 opacity-20" />
              <h3 className="text-lg font-medium text-foreground mb-1">暂无抓取记录</h3>
              <p className="text-sm">返回抓取面板开始您的第一个任务</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[40%]">页面信息</TableHead>
                    <TableHead>抓取时间</TableHead>
                    <TableHead className="text-right">耗时</TableHead>
                    <TableHead className="text-right">提取数量</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((item) => (
                    <TableRow key={item.id} className="group">
                      <TableCell>
                        <div className="flex flex-col gap-1 max-w-[400px]">
                          <span className="font-medium truncate" title={item.title || '无标题'}>
                            {item.title || '无标题'}
                          </span>
                          <a 
                            href={item.url} 
                            target="_blank" 
                            rel="noreferrer"
                            className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 truncate"
                            title={item.url}
                          >
                            {item.url}
                            <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </a>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {format(new Date(item.scrapedAt), 'yyyy-MM-dd HH:mm:ss')}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1.5 text-sm font-mono bg-muted px-2 py-1 rounded">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          {item.duration}ms
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className="font-mono bg-primary/10 text-primary border-primary/20 hover:bg-primary/20">
                          {item.itemCount}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
