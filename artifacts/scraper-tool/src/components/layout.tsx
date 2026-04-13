import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Terminal, Clock, Code2 } from "lucide-react";
import { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-3 sm:px-4 flex h-12 sm:h-14 items-center gap-2">
          <Link href="/" className="flex items-center gap-1.5 mr-2 sm:mr-4 shrink-0">
            <Code2 className="h-5 w-5 text-primary" />
            <span className="hidden sm:inline font-bold font-mono tracking-tight text-sm">
              Scraper<span className="text-primary">Tool</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm font-medium">
            <Link
              href="/"
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors",
                location === "/"
                  ? "bg-primary/10 text-primary"
                  : "text-foreground/60 hover:text-foreground hover:bg-muted"
              )}
            >
              <Terminal className="h-3.5 w-3.5 shrink-0" />
              <span className="text-xs sm:text-sm">抓取面板</span>
            </Link>
            <Link
              href="/history"
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors",
                location === "/history"
                  ? "bg-primary/10 text-primary"
                  : "text-foreground/60 hover:text-foreground hover:bg-muted"
              )}
            >
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span className="text-xs sm:text-sm">历史记录</span>
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 flex flex-col">
        {children}
      </main>
    </div>
  );
}
