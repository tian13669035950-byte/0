import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import History from "@/pages/history";
import Parallel from "@/pages/parallel";
import Results from "@/pages/results";
import { Layout } from "@/components/layout";
import { syncFromBackend } from "@/lib/result-store";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/history" component={History} />
        <Route path="/parallel" component={Parallel} />
        <Route path="/results" component={Results} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  // On startup, merge data from the backend file into localStorage.
  // This restores data that survived a source-code update or browser cache clear.
  useEffect(() => {
    syncFromBackend();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
