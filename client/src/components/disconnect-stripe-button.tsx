import { useState } from "react";
import { Unplug, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface DisconnectStripeButtonProps {
  merchantId: string;
  onDisconnected?: () => void;
}

export function DisconnectStripeButton({ merchantId, onDisconnected }: DisconnectStripeButtonProps) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await apiRequest("POST", "/api/stripe/disconnect", { merchantId });
      
      toast({
        title: "Disconnected",
        description: "Your Stripe account has been disconnected successfully.",
      });
      
      setOpen(false);
      
      if (onDisconnected) {
        onDisconnected();
      } else {
        window.location.reload();
      }
    } catch (error: any) {
      toast({
        title: "Disconnection Failed",
        description: error.message || "Failed to disconnect from Stripe. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button 
          variant="destructive" 
          className="w-full gap-2"
          data-testid="button-disconnect-stripe"
        >
          <Unplug className="h-4 w-4" />
          Disconnect Stripe Account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <AlertDialogTitle>Disconnect Stripe Account?</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-2">
            This will cancel all active subscriptions and stop revenue recovery immediately. 
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDisconnecting} data-testid="button-cancel-disconnect">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="button-confirm-disconnect"
          >
            {isDisconnecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Disconnecting...
              </>
            ) : (
              "Yes, Disconnect"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
