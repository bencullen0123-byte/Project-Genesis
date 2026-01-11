import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn, useAuth } from "@clerk/clerk-react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import Dashboard from "@/pages/dashboard";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/tasks">
        <div className="p-8">
          <h1 className="text-2xl font-semibold mb-4">Task Queue</h1>
          <p className="text-muted-foreground">Task management coming soon.</p>
        </div>
      </Route>
      <Route path="/activity">
        <div className="p-8">
          <h1 className="text-2xl font-semibold mb-4">Activity Log</h1>
          <p className="text-muted-foreground">Full activity log coming soon.</p>
        </div>
      </Route>
      <Route path="/settings">
        <div className="p-8">
          <h1 className="text-2xl font-semibold mb-4">Settings</h1>
          <p className="text-muted-foreground">Settings page coming soon.</p>
        </div>
      </Route>
      <Route>
        <div className="p-8">
          <h1 className="text-2xl font-semibold mb-4">Page Not Found</h1>
          <p className="text-muted-foreground">The page you're looking for doesn't exist.</p>
        </div>
      </Route>
    </Switch>
  );
}

function AuthenticatedApp() {
  const { isLoaded } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <>
      <SignedIn>
        <SidebarProvider style={sidebarStyle as React.CSSProperties}>
          <div className="flex h-screen w-full bg-background">
            <AppSidebar />
            <main className="flex-1 overflow-y-auto">
              <header className="flex items-center gap-2 p-4 border-b sticky top-0 bg-background z-10">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
              </header>
              <div className="p-6">
                <Router />
              </div>
            </main>
          </div>
        </SidebarProvider>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn signInFallbackRedirectUrl="/" />
      </SignedOut>
    </>
  );
}

function App() {
  if (!PUBLISHABLE_KEY) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center p-8">
          <h1 className="text-3xl font-bold text-foreground mb-4">The Citadel</h1>
          <p className="text-muted-foreground mb-6">Multi-Tenant Stripe Recovery Engine</p>
          <div className="mt-4 p-4 bg-destructive/10 rounded-lg border border-destructive">
            <p className="text-sm text-destructive font-medium">
              Missing VITE_CLERK_PUBLISHABLE_KEY environment variable
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Please configure Clerk authentication to continue.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ClerkProvider 
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/"
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthenticatedApp />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
