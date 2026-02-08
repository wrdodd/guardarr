"use client";

import { useState, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Clock, AlertTriangle, Zap, Timer } from "lucide-react";
import Link from "next/link";

interface ActiveRestriction {
  userId: number;
  username: string;
  thumb: string | null;
  isHome: number;
  isAdmin: number;
  ruleId: number;
  ruleName: string;
  allowedRatings: string;
  blockedRatings: string;
  allowedTvRatings: string;
  blockedTvRatings: string;
  startTime: string;
  endTime: string;
  minutesRemaining: number;
  priority: number;
  hasBypass: boolean;
}

interface ActiveRestrictionsResponse {
  restrictions: ActiveRestriction[];
  currentTime: string;
  currentDay: string;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [activeData, setActiveData] = useState<ActiveRestrictionsResponse | null>(null);
  const [loadingRestrictions, setLoadingRestrictions] = useState(true);

  useEffect(() => {
    if (session) {
      fetchActiveRestrictions();
      const interval = setInterval(fetchActiveRestrictions, 30000); // refresh every 30s
      return () => clearInterval(interval);
    }
  }, [session]);

  const fetchActiveRestrictions = async () => {
    try {
      const res = await fetch("/api/active-restrictions");
      if (res.ok) {
        const data = await res.json();
        console.log(`[FRONTEND] Fetched restrictions:`, data.restrictions?.map((r: any) => ({ user: r.username, hasBypass: r.hasBypass })));
        setActiveData(data);
      }
    } catch (error) {
      console.error("[FRONTEND] Failed to fetch active restrictions", error);
    } finally {
      setLoadingRestrictions(false);
    }
  };

  const emergencyOverride = (userId: number, username: string) => {
    console.log(`[FRONTEND] Emergency override clicked for ${username} (userId=${userId}) at ${new Date().toISOString()}`);
    
    // Optimistic UI update — show bypass immediately
    setActiveData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        restrictions: prev.restrictions.map((r) =>
          r.userId === userId ? { ...r, hasBypass: true } : r
        ),
      };
    });

    // Fire the API call immediately — no await, no blocking
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    fetch(`/api/users/${userId}/bypass`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes: 60 }),
      signal: controller.signal,
    })
      .then(async (res) => {
        clearTimeout(timeoutId);
        const data = await res.json();
        console.log(`[FRONTEND] Emergency override response for ${username}:`, data);
        if (!res.ok) {
          console.error(`[FRONTEND] Emergency override failed: ${res.status}`, data);
        }
        // Refresh to get accurate state from server
        fetchActiveRestrictions();
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        console.error(`[FRONTEND] Emergency override error for ${username}:`, error);
        // Revert optimistic update on failure
        fetchActiveRestrictions();
      });
  };

  const cancelBypass = (userId: number, username: string) => {
    console.log(`[FRONTEND] Cancel bypass clicked for ${username} (userId=${userId}) at ${new Date().toISOString()}`);
    
    // Optimistic UI update — show restriction re-applied immediately
    setActiveData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        restrictions: prev.restrictions.map((r) =>
          r.userId === userId ? { ...r, hasBypass: false } : r
        ),
      };
    });

    // Fire the API call immediately — no await, no blocking
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    fetch(`/api/users/${userId}/bypass`, {
      method: "DELETE",
      signal: controller.signal,
    })
      .then(async (res) => {
        clearTimeout(timeoutId);
        const data = await res.json();
        console.log(`[FRONTEND] Cancel bypass response for ${username}:`, data);
        if (!res.ok) {
          console.error(`[FRONTEND] Cancel bypass failed: ${res.status}`, data);
        }
        // Refresh to get accurate state from server
        fetchActiveRestrictions();
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        console.error(`[FRONTEND] Cancel bypass error for ${username}:`, error);
        // Revert optimistic update on failure
        fetchActiveRestrictions();
      });
  };

  const formatTimeRemaining = (minutes: number) => {
    if (minutes <= 0) return "Ending soon";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h ${m}m remaining`;
    return `${m}m remaining`;
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-orange-500">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950">
        <div className="text-center space-y-6">
          <h1 className="text-4xl font-bold text-orange-500">PlexGuard</h1>
          <p className="text-slate-400 max-w-md">
            Schedule-based content restrictions for Plex Media Server users
          </p>
          <Button
            onClick={() => signIn("credentials")}
            className="bg-orange-500 hover:bg-orange-600 text-slate-950 font-semibold px-8 py-3"
          >
            Sign in with Plex
          </Button>
        </div>
      </div>
    );
  }

  // Group restrictions by user for dashboard
  const restrictionsByUser: Record<string, ActiveRestriction[]> = {};
  if (activeData?.restrictions) {
    for (const r of activeData.restrictions) {
      if (!restrictionsByUser[r.username]) {
        restrictionsByUser[r.username] = [];
      }
      restrictionsByUser[r.username].push(r);
    }
  }

  const restrictedUserCount = Object.keys(restrictionsByUser).length;
  const totalActiveRules = activeData?.restrictions?.length || 0;

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-orange-500">PlexGuard</h1>
          <div className="flex items-center gap-4">
            <span className="text-slate-400">{session.user?.name}</span>
            <Button
              variant="outline"
              onClick={() => signOut()}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-4">Welcome to PlexGuard</h2>
            <p className="text-slate-400">
              Manage time-based content restrictions for Plex users. Set up rules that automatically
              activate based on time of day.
            </p>
          </section>

          {/* Active Restrictions Dashboard */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-slate-100 flex items-center gap-2">
                <Shield className="h-5 w-5 text-orange-500" />
                Currently Active Restrictions
                {activeData && (
                  <span className="text-xs text-slate-500 ml-auto font-normal">
                    {activeData.currentDay.toUpperCase()} {activeData.currentTime}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingRestrictions ? (
                <p className="text-slate-500 text-sm">Loading...</p>
              ) : totalActiveRules === 0 ? (
                <div className="text-center py-6">
                  <Clock className="h-10 w-10 text-slate-700 mx-auto mb-3" />
                  <p className="text-slate-500 text-sm">No restrictions are currently active</p>
                  <p className="text-slate-600 text-xs mt-1">Rules will appear here during their scheduled time windows</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex gap-4 mb-4">
                    <div className="bg-orange-500/10 rounded-md px-3 py-2">
                      <p className="text-orange-400 text-lg font-bold">{restrictedUserCount}</p>
                      <p className="text-orange-400/70 text-xs">Users restricted</p>
                    </div>
                    <div className="bg-slate-800 rounded-md px-3 py-2">
                      <p className="text-slate-300 text-lg font-bold">{totalActiveRules}</p>
                      <p className="text-slate-500 text-xs">Active rules</p>
                    </div>
                  </div>

                  {Object.entries(restrictionsByUser).map(([username, restrictions]) => {
                    const first = restrictions[0];
                    const hasBypass = first.hasBypass;
                    return (
                      <div
                        key={username}
                        className={`rounded-lg border p-3 ${
                          hasBypass
                            ? "bg-green-500/5 border-green-500/20"
                            : "bg-slate-800/50 border-slate-700/50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {first.thumb ? (
                            <img src={first.thumb} alt={username} className="w-8 h-8 rounded-full" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-400 text-sm">
                              {username[0]?.toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-slate-200 font-medium text-sm">{username}</p>
                              {hasBypass && (
                                <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">
                                  <Timer className="h-3 w-3 inline mr-0.5" />
                                  Bypassed
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                              {restrictions.map((r) => (
                                <div key={r.ruleId} className="text-xs space-y-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-orange-400">{r.ruleName}</span>
                                    <span className="text-slate-600">•</span>
                                    <span className="text-slate-500">
                                      <Clock className="h-3 w-3 inline mr-0.5" />
                                      {formatTimeRemaining(r.minutesRemaining)}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 ml-2">
                                    {(r.allowedRatings || r.blockedRatings) && (
                                      <span>
                                        <span className="text-slate-600">🎬</span>{" "}
                                        {r.allowedRatings ? (
                                          <span className="text-green-400">Allow: {r.allowedRatings}</span>
                                        ) : (
                                          <span className="text-slate-500">Block: {r.blockedRatings}</span>
                                        )}
                                      </span>
                                    )}
                                    {(r.allowedTvRatings || r.blockedTvRatings) && (
                                      <span>
                                        <span className="text-slate-600">📺</span>{" "}
                                        {r.allowedTvRatings ? (
                                          <span className="text-green-400">Allow: {r.allowedTvRatings}</span>
                                        ) : (
                                          <span className="text-slate-500">Block: {r.blockedTvRatings}</span>
                                        )}
                                      </span>
                                    )}
                                    {!r.allowedRatings && !r.blockedRatings && !r.allowedTvRatings && !r.blockedTvRatings && (
                                      <span className="text-slate-500">No ratings</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          {!hasBypass ? (
                            <Button
                              onClick={() => emergencyOverride(first.userId, username)}
                              variant="outline"
                              size="sm"
                              className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 shrink-0"
                              title="Grant 1-hour emergency bypass"
                            >
                              <Zap className="h-3 w-3 mr-1" />
                              Override
                            </Button>
                          ) : (
                            <Button
                              onClick={() => cancelBypass(first.userId, username)}
                              variant="outline"
                              size="sm"
                              className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 shrink-0"
                              title="Cancel bypass and re-apply restrictions"
                            >
                              Cancel Bypass
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Link href="/users" className="block group">
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 hover:border-orange-500/50 transition-colors">
                <h3 className="text-lg font-medium text-orange-400 mb-2 group-hover:text-orange-300">Users</h3>
                <p className="text-slate-400 text-sm">Manage Plex users and their restriction schedules</p>
              </div>
            </Link>

            <Link href="/rules" className="block group">
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 hover:border-orange-500/50 transition-colors">
                <h3 className="text-lg font-medium text-orange-400 mb-2 group-hover:text-orange-300">Rules</h3>
                <p className="text-slate-400 text-sm">Create time-based restriction rules</p>
              </div>
            </Link>

            <Link href="/activity" className="block group">
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 hover:border-orange-500/50 transition-colors">
                <h3 className="text-lg font-medium text-orange-400 mb-2 group-hover:text-orange-300">Activity Log</h3>
                <p className="text-slate-400 text-sm">View when restrictions were applied</p>
              </div>
            </Link>

            <Link href="/settings" className="block group">
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 hover:border-orange-500/50 transition-colors">
                <h3 className="text-lg font-medium text-orange-400 mb-2 group-hover:text-orange-300">Settings</h3>
                <p className="text-slate-400 text-sm">Configure Plex server and preferences</p>
              </div>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
