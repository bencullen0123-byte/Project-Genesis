import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { SiStripe } from "react-icons/si";

interface ConnectStripeButtonProps {
  onClick?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export function ConnectStripeButton({ onClick, isLoading, disabled }: ConnectStripeButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled || isLoading}
      className="bg-[#635BFF] hover:bg-[#5046e4] text-white font-medium px-6"
      data-testid="button-connect-stripe"
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <SiStripe className="h-4 w-4 mr-2" />
      )}
      Connect with Stripe
    </Button>
  );
}
