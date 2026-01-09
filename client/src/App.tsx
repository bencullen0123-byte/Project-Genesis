import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="flex items-center justify-center h-screen bg-background">
          <div className="text-center p-8">
            <h1 className="text-3xl font-bold text-foreground mb-4">The Citadel</h1>
            <p className="text-muted-foreground mb-6">Multi-Tenant Stripe Recovery Engine</p>
            <p className="text-sm text-muted-foreground">Headless API Backend - No Frontend Required</p>
            <div className="mt-8 p-4 bg-card rounded-lg border">
              <p className="text-sm font-mono text-muted-foreground">
                API Endpoints: /api/health, /api/tasks, /api/merchants
              </p>
            </div>
          </div>
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
