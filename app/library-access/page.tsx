"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Library, RefreshCw } from "lucide-react";
import Link from "next/link";

export default function LibraryAccessPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/library-access", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Failed to load");
        setData(null);
      } else {
        setData(d);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
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
          Read-only view of which Plex libraries each shared user can access. (Editing is coming later.)
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
            {data.users.map((u: any) => (
              <Card key={u.userID || u.username} className="bg-slate-900 border-slate-800">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <div className="min-w-0">
                      <span className="text-slate-100 font-medium truncate">{u.username || u.email || `User ${u.userID}`}</span>
                      {u.email && <span className="text-slate-500 text-sm ml-2 hidden sm:inline">{u.email}</span>}
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">{u.sharedCount}/{u.totalLibraries} libraries</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {u.libraries.length === 0 ? (
                      <span className="text-slate-500 text-sm">No library info reported</span>
                    ) : (
                      u.libraries.map((l: any) => (
                        <span
                          key={l.key || l.title}
                          className={`text-xs px-2 py-1 rounded-full border ${
                            l.shared
                              ? "bg-green-500/10 border-green-500/30 text-green-300"
                              : "bg-slate-800 border-slate-700 text-slate-500 line-through"
                          }`}
                        >
                          {l.title}
                        </span>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
