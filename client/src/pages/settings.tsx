import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Database, Webhook, Shield, Bell } from "lucide-react";

export default function Settings() {
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Settings"
        description="Configure system behavior and integrations"
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">Database</CardTitle>
                <CardDescription>PostgreSQL connection status</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Connection Status</p>
                <p className="text-xs text-muted-foreground font-mono">
                  PostgreSQL with SELECT FOR UPDATE SKIP LOCKED
                </p>
              </div>
              <Badge variant="outline">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-status-online" />
                  Connected
                </span>
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Webhook className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">Webhook Configuration</CardTitle>
                <CardDescription>Stripe webhook endpoint settings</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Endpoint Status</p>
                <p className="text-xs text-muted-foreground font-mono">
                  /api/stripe/webhook
                </p>
              </div>
              <Badge variant="outline">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-status-online" />
                  Active
                </span>
              </Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="idempotency">Idempotency Checks</Label>
                <p className="text-xs text-muted-foreground">
                  Prevent duplicate event processing
                </p>
              </div>
              <Switch id="idempotency" defaultChecked disabled />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">Security</CardTitle>
                <CardDescription>Transaction and access controls</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="transactions">ACID Transactions</Label>
                <p className="text-xs text-muted-foreground">
                  All operations use database transactions
                </p>
              </div>
              <Switch id="transactions" defaultChecked disabled />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="encryption">Token Encryption</Label>
                <p className="text-xs text-muted-foreground">
                  Access tokens encrypted at rest
                </p>
              </div>
              <Switch id="encryption" defaultChecked disabled />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">Notifications</CardTitle>
                <CardDescription>Alert preferences</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="failed-alerts">Failed Recovery Alerts</Label>
                <p className="text-xs text-muted-foreground">
                  Get notified when recovery attempts fail
                </p>
              </div>
              <Switch id="failed-alerts" defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="queue-alerts">Queue Depth Alerts</Label>
                <p className="text-xs text-muted-foreground">
                  Alert when queue exceeds threshold
                </p>
              </div>
              <Switch id="queue-alerts" defaultChecked />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
