"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, RefreshCw, Users, Shield, Home, Share2, Clock, ChevronDown, Timer, X } from "lucide-react";
import Link from "next/link";

interface User {
  id: number;
  plex_id: string;
  plex_username: string;
  plex_email: string | null;
  plex_thumb: string | null;
  is_admin: number;
  is_home: number;
  is_restricted: number;
  rule_ids: string | null;
  rule_names: string | null;
}

interface Rule {
  id: number;
  name: string;
}

interface Bypass {
  id: number;
  user_id: number;
  minutes: number;
  expires_at: string;
  created_by: string;
}

type TabType = "home" | "shared" | "admin" | "deactivated";

export default function UsersPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("home");
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [bypasses, setBypasses] = useState<Record<number, Bypass>>({});
  const [bypassDropdown, setBypassDropdown] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // Tick every second for countdown timers
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchUsers(showDeactivated);
    fetchRules();
    fetchBypasses();
  }, [showDeactivated]);

  const fetchUsers = async (includeDeactivated = false) => {
    try {
      const url = includeDeactivated ? "/api/users?includeDeactivated=true" : "/api/users";
      const res = await fetch(url);
      const data = await res.json();
      const sorted = data.sort((a: User, b: User) =>
        a.plex_username.localeCompare(b.plex_username, undefined, { sensitivity: "base" })
      );
      setUsers(sorted);
    } catch (error) {
      toast({ title: "Error", description: "Failed to load users", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fetchRules = async () => {
    try {
      const res = await fetch("/api/rules");
      const data = await res.json();
      setRules(data);
    } catch (error) {
      console.error("Failed to load rules", error);
    }
  };

  const fetchBypasses = async () => {
    try {
      const res = await fetch("/api/users/bypasses");
      if (res.ok) {
        const data = await res.json();
        const map: Record<number, Bypass> = {};
        for (const b of data) {
          map[b.user_id] = b;
        }
        setBypasses(map);
      }
    } catch (error) {
      console.error("Failed to load bypasses", error);
    }
  };

  const syncUsers = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/users", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Success", description: `Synced ${data.synced} users` });
        fetchUsers();
      } else {
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Sync failed", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const toggleRule = async (userId: number, ruleId: number, isAssigned: boolean) => {
    try {
      const url = `/api/users/${userId}/rules`;
      let res;
      if (isAssigned) {
        res = await fetch(`${url}?rule_id=${ruleId}`, { method: "DELETE" });
      } else {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rule_id: ruleId }),
        });
      }
      const data = await res.json();
      fetchUsers();
      if (data.applied) {
        toast({ title: "Success", description: "Rule applied immediately to Plex" });
      } else if (data.removed) {
        toast({ title: "Success", description: "Restriction removed from Plex" });
      } else {
        toast({ title: "Success", description: data.message || "Rule assignment updated" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to update rule", variant: "destructive" });
    }
  };

  const grantBypass = async (userId: number, minutes: number) => {
    try {
      const res = await fetch(`/api/users/${userId}/bypass`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Bypass Granted", description: `Restrictions lifted for ${minutes >= 60 ? `${minutes / 60}hr` : `${minutes}min`}` });
        fetchBypasses();
        setBypassDropdown(null);
      } else {
        toast({ title: "Error", description: data.error || "Failed to grant bypass", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to grant bypass", variant: "destructive" });
    }
  };

  const cancelBypass = async (userId: number) => {
    try {
      const res = await fetch(`/api/users/${userId}/bypass`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Bypass Cancelled", description: "Restrictions re-applied" });
        fetchBypasses();
      } else {
        toast({ title: "Error", description: data.error || "Failed to cancel bypass", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to cancel bypass", variant: "destructive" });
    }
  };

  const deleteUser = async (userId: number, username: string) => {
    if (!confirm(`Permanently delete ${username}?\n\nThis will remove:\n- All rule assignments\n- Bypass history\n- Activity log entries\n\nThis cannot be undone.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Deleted", description: `${username} removed from PlexGuard` });
        fetchUsers(showDeactivated);
      } else {
        toast({ title: "Error", description: data.error || "Failed to delete user", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete user", variant: "destructive" });
    }
  };

  const purgeDeactivated = async () => {
    const deactivatedCount = users.filter(u => (u as any).deactivated === 1).length;
    if (deactivatedCount === 0) {
      toast({ title: "No deactivated users", description: "Nothing to purge" });
      return;
    }
    if (!confirm(`Permanently delete ${deactivatedCount} deactivated users?\n\nThis cannot be undone.`)) {
      return;
    }
    try {
      const res = await fetch("/api/users/purge-deactivated", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Purged", description: `${data.deleted} deactivated users removed` });
        fetchUsers(showDeactivated);
      } else {
        toast({ title: "Error", description: data.error || "Failed to purge users", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to purge users", variant: "destructive" });
    }
  };

  const isRuleAssigned = (user: User, ruleId: number) => {
    if (!user.rule_ids) return false;
    return user.rule_ids.split(",").includes(String(ruleId));
  };

  const formatTimeRemaining = (expiresAt: string) => {
    const expires = new Date(expiresAt + "Z").getTime();
    const diff = expires - now;
    if (diff <= 0) return "Expired";
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  // Categorize users
  const adminUsers = useMemo(() => users.filter((u) => u.is_admin === 1 && (u as any).deactivated !== 1), [users]);
  const homeUsers = useMemo(
    () => users.filter((u) => u.is_admin === 0 && u.is_home === 1 && (u as any).deactivated !== 1),
    [users]
  );
  const sharedUsers = useMemo(
    () => users.filter((u) => u.is_admin === 0 && u.is_home === 0 && (u as any).deactivated !== 1),
    [users]
  );
  const deactivatedUsers = useMemo(
    () => users.filter((u) => (u as any).deactivated === 1),
    [users]
  );

  const tabCounts = useMemo(
    () => ({
      home: homeUsers.length,
      shared: sharedUsers.length,
      admin: adminUsers.length,
      deactivated: deactivatedUsers.length,
    }),
    [homeUsers, sharedUsers, adminUsers, deactivatedUsers]
  );

  const displayedUsers = useMemo(() => {
    switch (activeTab) {
      case "home":
        return homeUsers;
      case "shared":
        return sharedUsers;
      case "admin":
        return adminUsers;
      case "deactivated":
        return deactivatedUsers;
    }
  }, [activeTab, homeUsers, sharedUsers, adminUsers, deactivatedUsers]);

  const BYPASS_OPTIONS = [
    { label: "15 min", minutes: 15 },
    { label: "30 min", minutes: 30 },
    { label: "1 hour", minutes: 60 },
    { label: "2 hours", minutes: 120 },
    { label: "4 hours", minutes: 240 },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-orange-500">Loading...</div>
      </div>
    );
  }

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: "home", label: "Home Users", icon: <Home className="h-4 w-4" /> },
    { key: "shared", label: "Shared Users", icon: <Share2 className="h-4 w-4" /> },
    { key: "admin", label: "Admin", icon: <Shield className="h-4 w-4" /> },
    { key: "deactivated", label: "Deactivated", icon: <X className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" className="text-slate-400 hover:text-slate-100">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold text-orange-500">Users</h1>
          </div>
          <Button
            onClick={syncUsers}
            disabled={syncing}
            className="bg-orange-500 hover:bg-orange-600 text-slate-950"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            Sync from Plex
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {users.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <Users className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 mb-4">No users synced yet</p>
              <Button onClick={syncUsers} disabled={syncing} className="bg-orange-500 hover:bg-orange-600">
                <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                Sync from Plex
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-1 mb-6 bg-slate-900 p-1 rounded-lg border border-slate-800 w-fit">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === tab.key
                      ? "bg-orange-500 text-slate-950"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                  <span
                    className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                      activeTab === tab.key
                        ? "bg-orange-600 text-slate-950"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {tabCounts[tab.key]}
                  </span>
                </button>
              ))}
            </div>

            {/* Admin notice */}
            {activeTab === "admin" && adminUsers.length > 0 && (
              <div className="mb-4 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
                <Shield className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-amber-400 text-sm">
                  Admin users have full access to the Plex server. Restriction rules do not apply to admin accounts.
                </p>
              </div>
            )}

            {/* Deactivated notice */}
            {activeTab === "deactivated" && deactivatedUsers.length > 0 && (
              <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <X className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-red-400 text-sm">
                    These users were deactivated because they no longer have access to your Plex server. You can delete them permanently or keep them for reference.
                  </p>
                </div>
                <Button
                  onClick={purgeDeactivated}
                  variant="outline"
                  size="sm"
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 shrink-0"
                >
                  Delete All
                </Button>
              </div>
            )}

            {displayedUsers.length === 0 ? (
              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="py-12 text-center">
                  <Users className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400">
                    No {activeTab === "home" ? "home" : activeTab === "shared" ? "shared" : activeTab === "admin" ? "admin" : "deactivated"} users found
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {displayedUsers.map((user) => {
                  const isAdmin = user.is_admin === 1;
                  const isDeactivated = (user as any).deactivated === 1;
                  const bypass = bypasses[user.id];
                  const bypassActive = bypass && new Date(bypass.expires_at + "Z").getTime() > now;

                  return (
                    <Card key={user.id} className={`bg-slate-900 border-slate-800 ${isAdmin ? "opacity-80" : ""} ${isDeactivated ? "opacity-60" : ""}`}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-4">
                          {user.plex_thumb ? (
                            <img
                              src={user.plex_thumb}
                              alt={user.plex_username}
                              className="w-12 h-12 rounded-full"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-slate-400">
                              {user.plex_username[0]?.toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1">
                            <CardTitle className="text-slate-100 text-lg flex items-center gap-2">
                              {user.plex_username}
                              {isDeactivated && (
                                <span className="inline-flex items-center gap-1 text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
                                  <X className="h-3 w-3" />
                                  Deactivated
                                </span>
                              )}
                              {bypassActive && !isDeactivated && (
                                <span className="inline-flex items-center gap-1 text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                                  <Timer className="h-3 w-3" />
                                  Bypass: {formatTimeRemaining(bypass.expires_at)}
                                </span>
                              )}
                            </CardTitle>
                            <p className="text-slate-500 text-sm">
                              {isAdmin ? (
                                <span className="text-amber-500">Admin</span>
                              ) : user.is_home ? (
                                "Home User"
                              ) : (
                                "Shared User"
                              )}
                              {user.is_restricted ? " • Restricted" : ""}
                            </p>
                          </div>
                          {/* Delete button for deactivated users */}
                          {isDeactivated && (
                            <Button
                              onClick={() => deleteUser(user.id, user.plex_username)}
                              variant="outline"
                              size="sm"
                              className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                            >
                              <X className="h-3 w-3 mr-1" />
                              Delete
                            </Button>
                          )}
                          {/* Bypass controls (non-admin only, not deactivated) */}
                          {!isAdmin && !isDeactivated && (
                            <div className="relative">
                              {bypassActive ? (
                                <Button
                                  onClick={() => cancelBypass(user.id)}
                                  variant="outline"
                                  size="sm"
                                  className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                                >
                                  <X className="h-3 w-3 mr-1" />
                                  Cancel Bypass
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    onClick={() => setBypassDropdown(bypassDropdown === user.id ? null : user.id)}
                                    variant="outline"
                                    size="sm"
                                    className="border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                                  >
                                    <Clock className="h-3 w-3 mr-1" />
                                    Allow for...
                                    <ChevronDown className="h-3 w-3 ml-1" />
                                  </Button>
                                  {bypassDropdown === user.id && (
                                    <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-md shadow-lg z-10 py-1 min-w-[120px]">
                                      {BYPASS_OPTIONS.map((opt) => (
                                        <button
                                          key={opt.minutes}
                                          onClick={() => grantBypass(user.id, opt.minutes)}
                                          className="w-full text-left px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                                        >
                                          {opt.label}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent>
                        {isDeactivated ? (
                          <p className="text-slate-500 text-sm">
                            This user no longer has access to your Plex server. You can delete them or keep them for reference.
                          </p>
                        ) : isAdmin ? (
                          <p className="text-amber-500/70 text-sm italic">
                            Restriction rules are not applied to admin accounts.
                          </p>
                        ) : (
                          <>
                            <p className="text-slate-400 text-sm mb-3">Assigned Rules:</p>
                            <div className="flex flex-wrap gap-3">
                              {rules.map((rule) => {
                                const assigned = isRuleAssigned(user, rule.id);
                                return (
                                  <label
                                    key={rule.id}
                                    className="flex items-center gap-2 bg-slate-800 px-3 py-2 rounded-md cursor-pointer hover:bg-slate-750"
                                  >
                                    <Checkbox
                                      checked={assigned}
                                      onCheckedChange={() => toggleRule(user.id, rule.id, assigned)}
                                    />
                                    <span className="text-slate-300 text-sm">{rule.name}</span>
                                  </label>
                                );
                              })}
                              {rules.length === 0 && (
                                <p className="text-slate-500 text-sm">No rules created yet</p>
                              )}
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
