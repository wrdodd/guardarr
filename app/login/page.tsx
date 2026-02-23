"use client";

import { useState, useEffect } from "react";
import { signIn, getSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  const addDebug = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setDebugInfo(prev => [...prev, `[${ts}] ${msg}`]);
    console.log(`[LoginPage] ${msg}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    if (urlError) {
      setError(`Auth error: ${urlError}`);
      setShowDebug(true);
    }

    getSession().then((session) => {
      if (session) {
        window.location.href = "/";
      }
    });
  }, []);

  const handlePlexOAuth = async () => {
    setLoading(true);
    setError("");
    setDebugInfo([]);

    try {
      addDebug("Requesting Plex PIN...");
      const res = await fetch("/api/plex-auth/pin", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create Plex PIN");
      const { id, code, clientId } = await res.json();
      addDebug(`PIN created: id=${id}, code=${code}`);

      const forwardUrl = `${window.location.origin}/plex-callback?pinId=${id}&mode=login`;
      const plexAuthUrl =
        `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientId)}` +
        `&code=${encodeURIComponent(code)}` +
        `&forwardUrl=${encodeURIComponent(forwardUrl)}` +
        `&context[device][product]=Guardarr`;

      addDebug("Redirecting to Plex auth...");
      window.location.href = plexAuthUrl;
    } catch (err: any) {
      setError(err.message || "Failed to start Plex OAuth");
      setLoading(false);
    }
  };

  const testPlexDirect = async () => {
    setDebugInfo([]);
    setShowDebug(true);
    addDebug("Testing Plex PIN endpoint...");

    try {
      const res = await fetch("/api/plex-auth/pin", { method: "POST" });
      const data = await res.json();
      if (data.id) {
        addDebug(`✅ PIN endpoint works! id=${data.id}, clientId=${data.clientId}`);
      } else {
        addDebug(`❌ PIN endpoint failed: ${JSON.stringify(data)}`);
      }
    } catch (err: any) {
      addDebug(`Exception: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-orange-500">Guardarr</h1>
          <p className="text-slate-400">Sign in with your Plex account</p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-500/50 rounded-md p-3">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        <Button
          onClick={handlePlexOAuth}
          disabled={loading}
          className="w-full bg-orange-500 hover:bg-orange-600 text-slate-950 font-semibold"
        >
          {loading ? "Redirecting to Plex..." : "Sign in with Plex"}
        </Button>

        {/* Debug section */}
        <div className="pt-2 space-y-2">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDebug(!showDebug)}
              className="text-slate-500 hover:text-slate-300 text-xs"
            >
              {showDebug ? "▲ Hide Debug" : "▼ Show Debug"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={testPlexDirect}
              className="text-slate-500 hover:text-slate-300 text-xs"
            >
              🔧 Test Plex PIN Endpoint
            </Button>
          </div>
        </div>

        {showDebug && debugInfo.length > 0 && (
          <div className="bg-slate-900 border border-slate-700 rounded-md p-3 max-h-80 overflow-y-auto">
            <div className="font-mono text-xs space-y-1">
              {debugInfo.map((line, i) => (
                <div
                  key={i}
                  className={`${
                    line.includes("ERROR") || line.includes("❌")
                      ? "text-red-400"
                      : line.includes("SUCCESS") || line.includes("✅")
                      ? "text-green-400"
                      : "text-slate-300"
                  }`}
                >
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
