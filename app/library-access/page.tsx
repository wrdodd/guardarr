"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Library, RefreshCw, Save, X } from "lucide-react";
import Link from "next/link";

interface Lib { key: string; id: string; title: string; type: string; shared: boolean }
interface ShareUser { id: string; username: string; email: string; userID: string; libraries: Lib[]; sharedCount: number; totalLibraries: number }

export default function LibraryAccessPage() {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Which user is being edited, and the pending shared-key set for them.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [pin, setPin] = useState("");

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/library-access", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Failed to load"); setData(null); }
      else setData(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (u: ShareUser) => {
    setEditingId(u.id);
    setDraft(new Set(u.libraries.filter((l) => l.shared).map((l) => l.key)));
    setPin("");
  };

  const cancelEdit = () => { setEditingId(null); setDraft(new Set()); setPin(""); };

  const toggle = (key: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const save = async (u: ShareUser, allowRemoveAll = false) => {
    setSaving(true);
    try {
      const res = await fetch("/api/library-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sharedServerId: u.id,
          username: u.username,
          sectionIds: Array.from(draft),
          pin,
          allowRemoveAll,
        }),
      });
      const d = await res.json();

      if (res.status === 409 && d.confirmRequired) {
        // Removing every library is a big hammer — make it a deliberate second step.
        if (confirm(`This removes ALL library access for ${u.username}. They will no longer see this server. Continue?`)) {
          setSaving(false);
          return save(u, true);
        }
        setSaving(false);
        return;
      }
      if (!res.ok) {
        toast({ title: "Update failed", description: d.error || "Could not update sharing", variant: "destructive" });
        return;
      }

      const bits = [
        d.added?.length ? `added ${d.added.join(", ")}` : "",
        d.removed?.length ? `removed ${d.removed.join(", ")}` : "",
      ].filter(Boolean).join("; ");
      toast({ title: "Sharing updated", description: bits || "No effective change" });
      cancelEdit();
      fetchData();
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="text-slate-400 hover:text-slate-100">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-orange-500">Library Access</h1>
          <Button variant="outline" size="sm" onClick={fetchData} className="ml-auto border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <p className="text-slate-500 text-sm mb-6">
          Which Plex libraries each shared user can access. Changes are written to Plex
          immediately and take effect for that user right away.
        </p>
        {loading ? (
          <div className="text-orange-500">Loading…</div>
        ) : error ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-8 text-center text-red-400">{error}</CardContent>
          </Card>
        ) : !data || data.users.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <Library className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No shared users found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {data.users.map((u: ShareUser) => {
              const isEditing = editingId === u.id;
              return (
                <Card key={u.userID || u.username} className="bg-slate-900 border-slate-800">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between mb-3 gap-2">
                      <div className="min-w-0">
                        <span className="text-slate-100 font-medium truncate">{u.username || u.email || `User ${u.userID}`}</span>
                        {u.email && <span className="text-slate-500 text-sm ml-2 hidden sm:inline">{u.email}</span>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-slate-400">
                          {isEditing ? `${draft.size}/${u.totalLibraries} selected` : `${u.sharedCount}/${u.totalLibraries} libraries`}
                        </span>
                        {!isEditing && u.libraries.length > 0 && (
                          <Button variant="outline" size="sm" className="border-slate-700 text-slate-300 hover:bg-slate-800"
                                  onClick={() => startEdit(u)}>
                            Edit
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {u.libraries.length === 0 ? (
                        <span className="text-slate-500 text-sm">No library info reported</span>
                      ) : (
                        u.libraries.map((l) => {
                          const on = isEditing ? draft.has(l.key) : l.shared;
                          const cls = on
                            ? "bg-green-500/10 border-green-500/30 text-green-300"
                            : "bg-slate-800 border-slate-700 text-slate-500 line-through";
                          return isEditing ? (
                            <button key={l.key || l.title} type="button" onClick={() => toggle(l.key)}
                                    className={`text-xs px-2 py-1 rounded-full border transition-colors hover:border-orange-500/50 ${cls}`}>
                              {l.title}
                            </button>
                          ) : (
                            <span key={l.key || l.title} className={`text-xs px-2 py-1 rounded-full border ${cls}`}>
                              {l.title}
                            </span>
                          );
                        })
                      )}
                    </div>

                    {isEditing && (
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                        {data.pinRequired && (
                          <input
                            type="password"
                            inputMode="numeric"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            placeholder="Parent PIN"
                            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 w-32"
                          />
                        )}
                        <Button size="sm" disabled={saving} onClick={() => save(u)}
                                className="bg-orange-600 hover:bg-orange-500">
                          <Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save"}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={saving} onClick={cancelEdit}
                                className="text-slate-400 hover:text-slate-100">
                          <X className="h-4 w-4 mr-1.5" /> Cancel
                        </Button>
                        <span className="text-xs text-slate-500">Writes to Plex immediately</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
