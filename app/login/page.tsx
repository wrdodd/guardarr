"use client";

import { useState, useEffect } from "react";
import { signIn, getSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [token, setToken] = useState("");
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
    // Check URL params for error (NextAuth redirect errors)
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    if (urlError) {
      setError(`Auth error: ${urlError}`);
      setShowDebug(true);
    }

    // Check if already authenticated
    getSession().then((session) => {
      if (session) {
        window.location.href = "/";
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setDebugInfo([]);
    setShowDebug(true);

    const trimmedToken = token.trim();

    if (!trimmedToken) {
      setError("Please enter a Plex token");
      setLoading(false);
      return;
    }

    addDebug(`Token length: ${trimmedToken.length}, starts with: ${trimmedToken.substring(0, 5)}...`);
    addDebug("Calling signIn('credentials', { token, redirect: false })...");

    try {
      const result = await signIn("credentials", {
        token: trimmedToken,
        redirect: false,
        callbackUrl: "/",
      });

      addDebug(`signIn result: ${JSON.stringify(result)}`);

      if (result?.error) {
        addDebug(`ERROR from signIn: ${result.error}`);
        // Map NextAuth error codes to user-friendly messages
        if (result.error === "CredentialsSignin") {
          setError("Authentication failed. The token may be invalid or Plex API is unreachable. Check debug logs.");
        } else {
          setError(result.error);
        }
      } else if (result?.ok) {
        addDebug("SUCCESS! Redirecting to /");
        window.location.href = result.url || "/";
      } else {
        addDebug(`Unexpected result: ${JSON.stringify(result)}`);
        setError("Unexpected response from auth. Check debug logs.");
      }
    } catch (err: any) {
      addDebug(`Exception: ${err.message}`);
      setError(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Direct Plex API test (bypasses NextAuth entirely)
  const testPlexDirect = async () => {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setError("Enter a token first");
      return;
    }

    setDebugInfo([]);
    setShowDebug(true);
    addDebug("Testing Plex API directly (bypassing NextAuth)...");

    try {
      const res = await fetch(`/api/auth/test?token=${encodeURIComponent(trimmedToken)}`);
      const data = await res.json();
      addDebug(`Direct test result: ${JSON.stringify(data, null, 2)}`);
      if (data.success) {
        addDebug(`✅ Plex API works! User: ${data.user?.name} (${data.user?.id})`);
      } else {
        addDebug(`❌ Plex API failed: ${data.error}`);
      }
    } catch (err: any) {
      addDebug(`Direct test exception: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-orange-500">PlexGuard</h1>
          <p className="text-slate-400">Sign in with your Plex token</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="token" className="text-slate-300">
              Plex Token
            </Label>
            <Input
              id="token"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter your Plex token"
              className="bg-slate-900 border-slate-700 text-slate-100 font-mono"
              required
              disabled={loading}
            />
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-500/50 rounded-md p-3">
              <p className="text-red-400 text-sm font-medium">{error}</p>
            </div>
          )}

          <Button
            type="submit"
            disabled={loading || !token.trim()}
            className="w-full bg-orange-500 hover:bg-orange-600 text-slate-950 font-semibold"
          >
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

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
              🔧 Test Plex API Direct
            </Button>
          </div>
        </div>

        {showDebug && debugInfo.length > 0 && (
          <div className="bg-slate-900 border border-slate-700 rounded-md p-3 max-h-80 overflow-y-auto">
            <div className="font-mono text-xs space-y-1">
              {debugInfo.map((line, i) => (
                <div key={i} className={`${
                  line.includes("ERROR") || line.includes("❌") ? "text-red-400" :
                  line.includes("SUCCESS") || line.includes("✅") ? "text-green-400" :
                  "text-slate-300"
                }`}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-center text-sm text-slate-500">
          <a
            href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 hover:underline"
          >
            How to find your Plex token
          </a>
        </div>
      </div>
    </div>
  );
}
