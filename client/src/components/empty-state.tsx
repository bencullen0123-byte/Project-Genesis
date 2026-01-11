import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Loader2, Zap, Shield, TrendingUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 text-muted-foreground">{icon}</div>
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-sm mb-4">{description}</p>
        {action && (
          <Button onClick={action.onClick} data-testid="button-empty-state-action">
            {action.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function ConnectStripeButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await apiRequest("POST", "/api/stripe/connect/authorize");
      const data = await response.json();
      
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError("Failed to get authorization URL");
      }
    } catch (err: any) {
      setError(err.message || "Failed to initiate Stripe connection");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button 
        onClick={handleConnect} 
        disabled={isLoading}
        size="lg"
        className="w-full"
        data-testid="button-connect-stripe"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <Zap className="mr-2 h-4 w-4" />
            Connect with Stripe
          </>
        )}
      </Button>
      {error && (
        <p className="text-sm text-destructive text-center" data-testid="text-error">{error}</p>
      )}
    </div>
  );
}

export function ActivationState() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl" data-testid="text-activation-title">
            Activate Payment Recovery
          </CardTitle>
          <CardDescription className="text-base mt-2">
            Connect your Stripe account to start recovering failed payments and reducing churn automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Automatic Recovery</p>
                <p className="text-sm text-muted-foreground">Smart dunning emails that recover failed payments</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2">
                <Shield className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Secure & Reliable</p>
                <p className="text-sm text-muted-foreground">Bank-grade encryption for all your data</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Instant Setup</p>
                <p className="text-sm text-muted-foreground">One-click Stripe Connect integration</p>
              </div>
            </div>
          </div>
          
          <ConnectStripeButton />
          
          <p className="text-xs text-center text-muted-foreground">
            By connecting, you agree to allow The Citadel to manage payment recovery on your behalf.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
