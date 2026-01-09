import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { TierBadge } from "@/components/tier-badge";
import { EmptyState } from "@/components/empty-state";
import { ConnectStripeButton } from "@/components/connect-stripe-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Users, Plus, Eye, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Merchant } from "@shared/schema";

export default function Merchants() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: merchants = [], isLoading } = useQuery<Merchant[]>({
    queryKey: ["/api/merchants"],
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/stripe/connect/authorize");
      return response.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast({ title: "Failed to initiate Stripe Connect", variant: "destructive" });
    },
  });

  const columns = [
    {
      header: "Merchant ID",
      accessorKey: "id",
      cell: (row: Merchant) => (
        <span className="font-mono text-xs">{row.id.slice(0, 8)}...</span>
      ),
    },
    {
      header: "Stripe Account",
      accessorKey: "stripeConnectId",
      cell: (row: Merchant) => (
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs truncate max-w-40">
            {row.stripeConnectId}
          </span>
          <a
            href={`https://dashboard.stripe.com/connect/accounts/${row.stripeConnectId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground"
            data-testid={`link-stripe-dashboard-${row.id}`}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ),
    },
    {
      header: "Tier",
      accessorKey: "tier",
      cell: (row: Merchant) => <TierBadge tier={row.tier} />,
    },
    {
      header: "Connected",
      accessorKey: "createdAt",
      cell: (row: Merchant) => (
        <span className="text-sm text-muted-foreground">
          {format(new Date(row.createdAt), "MMM d, yyyy")}
        </span>
      ),
    },
    {
      header: "",
      accessorKey: "actions",
      cell: (row: Merchant) => (
        <Button
          variant="ghost"
          size="icon"
          data-testid={`button-view-merchant-${row.id}`}
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Merchants"
        description="Manage connected Stripe accounts"
        actions={
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-merchant">
                <Plus className="h-4 w-4 mr-2" />
                Add Merchant
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Connect New Merchant</DialogTitle>
                <DialogDescription>
                  Connect a Stripe account to enable payment recovery for this merchant.
                </DialogDescription>
              </DialogHeader>
              <Card className="mt-4">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Stripe Connect</CardTitle>
                  <CardDescription>
                    Securely connect via OAuth to access payment data and enable automated recovery.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ConnectStripeButton
                    onClick={() => connectMutation.mutate()}
                    isLoading={connectMutation.isPending}
                  />
                </CardContent>
              </Card>
            </DialogContent>
          </Dialog>
        }
      />

      {!isLoading && merchants.length === 0 ? (
        <EmptyState
          icon={<Users className="h-12 w-12" />}
          title="No merchants connected"
          description="Connect your first merchant's Stripe account to start recovering failed payments."
          action={{
            label: "Connect Merchant",
            onClick: () => setIsDialogOpen(true),
          }}
        />
      ) : (
        <DataTable
          columns={columns}
          data={merchants}
          isLoading={isLoading}
          emptyMessage="No merchants found"
        />
      )}
    </div>
  );
}
