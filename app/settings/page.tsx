"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Save, TestTube, Clock, Server } from "lucide-react";
import Link from "next/link";

interface Settings {
  plex_server_url: string;
  plex_admin_token: string;
  timezone: string;
}

const COMMON_TIMEZONES = [
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HT)" },
  { value: "Europe/London", label: "Greenwich Mean Time (GMT)" },
  { value: "Europe/Paris", label: "Central European Time (CET)" },
  { value: "Asia/Tokyo", label: "Japan Standard Time (JST)" },
  { value: "Australia/Sydney", label: "Australian Eastern Time (AET)" },
  { value: "UTC", label: "UTC" },
];

export default function SettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings>({
    plex_server_url: "",
    plex_admin_token: "",
    timezone: "America/Los_Angeles",
  });
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [currentTime, setCurrentTime] = useState("");
  const [adminTokenConnecting, setAdminTokenConnecting] = useState(false);
  const [discoveringServers, setDiscoveringServers] = useState(false);
  const [availableServers, setAvailableServers] = useState<{ name: string; clientIdentifier: string; owned: boolean; allConnections: { uri: string; local: boolean; relay: boolean; label: string }[] }[]>([]);
  const popupClosedCheckerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchSettings();
    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 1000);
    return () => clearInterval(interval);
  }, [settings.timezone]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "PLEX_AUTH_SUCCESS" && event.data?.token) {
        setSettings(prev => ({ ...prev, plex_admin_token: event.data.token }));
        setTokenConfigured(true);
        setAdminTokenConnecting(false);
        if (popupClosedCheckerRef.current) {
          clearInterval(popupClosedCheckerRef.current);
          popupClosedCheckerRef.current = null;
        }
        toast({ title: "Plex Connected", description: "Admin token received. Save settings to persist." });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const connectPlexAdmin = async () => {
    setAdminTokenConnecting(true);
    try {
      const res = await fetch("/api/plex-auth/pin", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create Plex PIN");
      const { id, code, clientId } = await res.json();

      const forwardUrl = `${window.location.origin}/plex-callback?pinId=${id}&mode=popup`;
      const plexAuthUrl =
        `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientId)}` +
        `&code=${encodeURIComponent(code)}` +
        `&forwardUrl=${encodeURIComponent(forwardUrl)}` +
        `&context[device][product]=Guardarr`;

      const popup = window.open(plexAuthUrl, "plex_auth", "width=800,height=700,resizable=yes");
      if (!popup) {
        throw new Error("Popup blocked. Please allow popups for this site.");
      }

      popupClosedCheckerRef.current = setInterval(() => {
        if (popup.closed) {
          clearInterval(popupClosedCheckerRef.current!);
          popupClosedCheckerRef.current = null;
          setAdminTokenConnecting(false);
        }
      }, 1000);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setAdminTokenConnecting(false);
    }
  };

  const discoverServers = async () => {
    setDiscoveringServers(true);
    setAvailableServers([]);
    try {
      const res = await fetch("/api/plex-auth/servers");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch servers");
      setAvailableServers(data.servers);
      if (data.servers.length === 0) {
        toast({ title: "No servers found", description: "No Plex servers found for this account.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDiscoveringServers(false);
    }
  };

  const updateCurrentTime = () => {
    try {
      const time = new Intl.DateTimeFormat("en-US", {
        timeZone: settings.timezone || "America/Los_Angeles",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hour12: true,
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date());
      setCurrentTime(time);
    } catch {
      setCurrentTime("Invalid timezone");
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      // The API no longer returns the token (security) — only whether one is set.
      // The token field is write-only: blank means "keep existing".
      setTokenConfigured(!!data.plex_admin_token_configured);
      setSettings({
        plex_server_url: data.plex_server_url || "",
        plex_admin_token: "",
        timezone: data.timezone || "America/Los_Angeles",
      });
    } catch (error) {
      toast({ title: "Error", description: "Failed to load settings", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        // If a new token was entered, mark configured and clear the write-only field.
        if (settings.plex_admin_token) {
          setTokenConfigured(true);
          setSettings(prev => ({ ...prev, plex_admin_token: "" }));
        }
        toast({ title: "Success", description: "Settings saved" });
      } else {
        throw new Error("Failed to save");
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({ success: true, message: `Connected to ${data.serverName} (v${data.version})` });
        toast({ title: "Success", description: `Connected to ${data.serverName}` });
      } else {
        setTestResult({ success: false, message: data.error || "Connection failed" });
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch (error: any) {
      setTestResult({ success: false, message: error.message });
      toast({ title: "Error", description: "Connection test failed", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-orange-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="text-slate-400 hover:text-slate-100">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-orange-500">Settings</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
        {/* Timezone Settings */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-slate-100 flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Timezone Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label className="text-slate-300">Timezone</Label>
              <select
                value={settings.timezone}
                onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
              <p className="text-slate-500 text-sm mt-1">
                All rule times will be evaluated in this timezone
              </p>
            </div>

            <div className="p-3 bg-slate-800/50 rounded-md border border-slate-700">
              <p className="text-slate-400 text-sm">Current time:</p>
              <p className="text-orange-400 font-mono text-lg">{currentTime}</p>
            </div>
          </CardContent>
        </Card>

        {/* Plex Server Settings */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-slate-100">Plex Server Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label className="text-slate-300">Plex Server URL</Label>
              <div className="flex flex-col sm:flex-row gap-2 mt-1">
                <Input
                  value={settings.plex_server_url}
                  onChange={(e) => setSettings({ ...settings, plex_server_url: e.target.value })}
                  placeholder="http://192.168.1.200:32400"
                  className="bg-slate-800 border-slate-700 text-slate-100"
                />
                <Button
                  type="button"
                  onClick={discoverServers}
                  disabled={discoveringServers || (!settings.plex_admin_token && !tokenConfigured)}
                  variant="outline"
                  className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10 whitespace-nowrap"
                >
                  <Server className="h-4 w-4 mr-2" />
                  {discoveringServers ? "Searching..." : "Discover"}
                </Button>
              </div>
              {availableServers.length > 0 && (
                <div className="mt-2 rounded-md border border-slate-700 bg-slate-800/50 divide-y divide-slate-700">
                  {availableServers.map((server) => (
                    <div key={server.clientIdentifier ?? server.url} className="p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-200 font-medium text-sm">{server.name}{server.owned && <span className="ml-2 text-xs text-orange-400">(yours)</span>}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {server.allConnections.map((c) => (
                          <button
                            key={c.uri}
                            type="button"
                            onClick={() => { setSettings(prev => ({ ...prev, plex_server_url: c.uri })); setAvailableServers([]); }}
                            className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-orange-500/20 text-slate-300 hover:text-orange-300 border border-slate-600 hover:border-orange-500/50 transition-colors"
                          >
                            {c.label}: {c.uri}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-slate-500 text-sm mt-1">Enter your Plex server address or click Discover to find it automatically</p>
            </div>

            <div>
              <Label className="text-slate-300">Admin Token</Label>
              <div className="flex flex-col sm:flex-row gap-2 mt-1">
                <Input
                  type="password"
                  value={settings.plex_admin_token}
                  onChange={(e) => setSettings({ ...settings, plex_admin_token: e.target.value })}
                  placeholder={tokenConfigured ? "Token configured — leave blank to keep" : "No token set"}
                  className="bg-slate-800 border-slate-700 text-slate-100"
                />
                <Button
                  type="button"
                  onClick={connectPlexAdmin}
                  disabled={adminTokenConnecting}
                  variant="outline"
                  className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10 whitespace-nowrap"
                >
                  {adminTokenConnecting ? "Waiting for Plex..." : "Connect with Plex"}
                </Button>
              </div>
              <p className="text-slate-500 text-sm mt-1">
                Click &ldquo;Connect with Plex&rdquo; to authenticate via OAuth, or paste your token directly.
              </p>
            </div>

            {testResult && (
              <div className={`p-3 rounded-md ${testResult.success ? "bg-green-900/30 border border-green-500/50" : "bg-red-900/30 border border-red-500/50"}`}>
                <p className={testResult.success ? "text-green-400" : "text-red-400"}>
                  {testResult.message}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={testConnection}
                disabled={testing || !settings.plex_server_url || (!settings.plex_admin_token && !tokenConfigured)}
                variant="outline"
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                <TestTube className="h-4 w-4 mr-2" />
                {testing ? "Testing..." : "Test Connection"}
              </Button>
              <Button
                onClick={saveSettings}
                disabled={saving}
                className="bg-orange-500 hover:bg-orange-600 text-slate-950"
              >
                <Save className="h-4 w-4 mr-2" />
                {saving ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
