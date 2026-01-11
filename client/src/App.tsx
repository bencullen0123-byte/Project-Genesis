import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn, useAuth, UserButton } from "@clerk/clerk-react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function AuthenticatedApp() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <>
      <SignedIn>
        <div className="flex items-center justify-center h-screen bg-background">
          <div className="text-center p-8">
            <div className="absolute top-4 right-4">
              <UserButton afterSignOutUrl="/" data-testid="button-user-menu" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-4" data-testid="text-title">The Citadel</h1>
            <p className="text-muted-foreground mb-6">Multi-Tenant Stripe Recovery Engine</p>
            <p className="text-sm text-muted-foreground">Welcome! You are authenticated.</p>
            <div className="mt-8 p-4 bg-card rounded-lg border">
              <p className="text-sm font-mono text-muted-foreground" data-testid="text-api-info">
                API Endpoints: /api/dashboard, /api/tasks, /api/merchants/me
              </p>
            </div>
          </div>
        </div>
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
