import { useState, useEffect, useCallback } from "react";
import { adminAPI } from "@food/api";
import { Button } from "@food/components/ui/button";
import { Input } from "@food/components/ui/input";
import { Label } from "@food/components/ui/label";
import { Switch } from "@food/components/ui/switch";
import { Badge } from "@food/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@food/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@food/components/ui/table";
import { toast } from "sonner";
import { Save, Loader2, Plug, RefreshCw, KeyRound } from "lucide-react";

const STATUS_VARIANT = { success: "default", failed: "destructive", pending: "secondary" };

export default function PetpoojaSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    enabled: false,
    apiUrl: "",
    apiKeyMasked: "",
    clientCodeMasked: "",
    hasApiKey: false,
    hasClientCode: false,
  });
  // Only sent to the server when the admin types a new value (blank = keep existing secret).
  const [apiKey, setApiKey] = useState("");
  const [clientCode, setClientCode] = useState("");

  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [retryingId, setRetryingId] = useState(null);

  const loadSettings = useCallback(async () => {
    try {
      const res = await adminAPI.getPetpoojaSettings();
      const data = res?.data?.data ?? res?.data ?? {};
      setSettings((prev) => ({ ...prev, ...data }));
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load PetPooja settings");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await adminAPI.getPetpoojaSyncLogs({ page: 1, limit: 20 });
      const payload = res?.data?.data ?? res?.data ?? {};
      setLogs(Array.isArray(payload.docs) ? payload.docs : []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load sync logs");
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadLogs();
  }, [loadSettings, loadLogs]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        enabled: settings.enabled,
        apiUrl: settings.apiUrl,
      };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      if (clientCode.trim()) payload.clientCode = clientCode.trim();

      const res = await adminAPI.updatePetpoojaSettings(payload);
      const data = res?.data?.data ?? res?.data ?? {};
      setSettings((prev) => ({ ...prev, ...data }));
      setApiKey("");
      setClientCode("");
      toast.success("PetPooja settings saved");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleRetry = async (logId) => {
    setRetryingId(logId);
    try {
      await adminAPI.retryPetpoojaSyncLog(logId);
      toast.success("Retry queued");
      await loadLogs();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Retry failed");
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-neutral-900">PetPooja Integration</h1>
        <p className="text-neutral-600 mt-1">
          Manage the global PetPooja POS credentials and monitor order sync.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Plug className="w-5 h-5 text-neutral-700" />
            <CardTitle>Credentials</CardTitle>
          </div>
          <CardDescription>
            One account, many outlets — each restaurant carries its own outlet code. Leave a
            secret blank to keep the existing value.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-neutral-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base">Enable PetPooja</Label>
                  <p className="text-sm text-neutral-500">Push orders and status updates to the POS.</p>
                </div>
                <Switch
                  checked={settings.enabled}
                  onCheckedChange={(v) => setSettings((p) => ({ ...p, enabled: v }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiUrl">API URL</Label>
                <Input
                  id="apiUrl"
                  value={settings.apiUrl || ""}
                  onChange={(e) => setSettings((p) => ({ ...p, apiUrl: e.target.value }))}
                  placeholder="https://api.petpooja.com/v2"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiKey" className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4" /> App Key
                  {settings.hasApiKey && (
                    <span className="text-xs text-neutral-400">(set: {settings.apiKeyMasked})</span>
                  )}
                </Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings.hasApiKey ? "Enter to replace" : "Enter app key"}
                  autoComplete="off"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="clientCode" className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4" /> Client Code
                  {settings.hasClientCode && (
                    <span className="text-xs text-neutral-400">(set: {settings.clientCodeMasked})</span>
                  )}
                </Label>
                <Input
                  id="clientCode"
                  type="password"
                  value={clientCode}
                  onChange={(e) => setClientCode(e.target.value)}
                  placeholder={settings.hasClientCode ? "Enter to replace" : "Enter client code"}
                  autoComplete="off"
                />
              </div>

              <div className="flex justify-end pt-4 border-t border-neutral-200">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-black text-white hover:bg-neutral-900 h-11 px-8"
                >
                  {saving ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                  ) : (
                    <><Save className="w-4 h-4 mr-2" /> Save Settings</>
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Order Sync</CardTitle>
              <CardDescription>Latest orders pushed to PetPooja and their invoice.</CardDescription>
            </div>
            <Button variant="outline" onClick={loadLogs} disabled={logsLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${logsLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invoice No</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-neutral-500 py-8">Loading…</TableCell></TableRow>
                ) : logs.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-neutral-500 py-8">No sync activity yet.</TableCell></TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log._id}>
                      <TableCell className="font-medium">{log.orderId?.order_id || String(log.orderId?._id || log.orderId || "").slice(-6)}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[log.status] || "secondary"} className="capitalize">{log.status}</Badge>
                      </TableCell>
                      <TableCell>{log.invoiceNo || "—"}</TableCell>
                      <TableCell>{log.attempts ?? 0}</TableCell>
                      <TableCell className="max-w-[240px] truncate text-red-600" title={log.error || ""}>{log.error || "—"}</TableCell>
                      <TableCell className="text-right">
                        {log.status !== "success" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRetry(log._id)}
                            disabled={retryingId === log._id}
                          >
                            {retryingId === log._id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <>Retry</>
                            )}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
