import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Terminal, Clock, Settings, Code2 } from "lucide-react";
import { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 flex h-14 items-center">
          <div className="mr-4 flex">
            <Link href="/" className="mr-6 flex items-center space-x-2">
              <Code2 className="h-6 w-6 text-primary" />
              <span className="hidden font-bold sm:inline-block font-mono tracking-tight">
                Scraper<span className="text-primary">Tool</span>
              </span>
            </Link>
            <nav className="flex items-center space-x-6 text-sm font-medium">
              <Link
                href="/"
                className={cn(
                  "transition-colors hover:text-foreground/80 flex items-center gap-2",
                  location === "/" ? "text-foreground" : "text-foreground/60"
                )}
              >
                <Terminal className="h-4 w-4" />
                抓取面板
              </Link>
              <Link
                href="/history"
                className={cn(
                  "transition-colors hover:text-foreground/80 flex items-center gap-2",
                  location === "/history" ? "text-foreground" : "text-foreground/60"
                )}
              >
                <Clock className="h-4 w-4" />
                历史记录
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <main className="flex-1 flex flex-col">
        {children}
      </main>
    </div>
  );
}
