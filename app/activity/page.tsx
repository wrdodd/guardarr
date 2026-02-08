"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Activity } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface ActivityEntry {
  id: number;
  plex_username: string | null;
  rule_name: string | null;
  action: string;
  details: string | null;
  created_at: string;
}

export default function ActivityPage() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchActivity();
  }, []);

  const fetchActivity = async () => {
    try {
      const res = await fetch("/api/activity?limit=50");
      const data = await res.json();
      setEntries(data);
    } catch (error) {
      toast({ title: "Error", description: "Failed to load activity", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case "rule_created": return "text-green-400";
      case "rule_applied": return "text-orange-400";
      case "user_sync": return "text-blue-400";
      case "restriction_lifted": return "text-yellow-400";
      default: return "text-slate-400";
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
          <h1 className="text-2xl font-bold text-orange-500">Activity Log</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {entries.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <Activity className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No activity recorded yet</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-0">
              <div className="divide-y divide-slate-800">
                {entries.map((entry) => (
                  <div key={entry.id} className="p-4 flex items-start gap-4">
                    <div className={`mt-1 ${getActionColor(entry.action)}`}>
                      <Activity className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-sm font-medium ${getActionColor(entry.action)}`}>
                          {entry.action.replace(/_/g, " ").toUpperCase()}
                        </span>
                        <span className="text-slate-600 text-xs">•</span>
                        <span className="text-slate-500 text-xs">{formatDate(entry.created_at)}</span>
                      </div>
                      <p className="text-slate-300 text-sm">
                        {entry.plex_username && (
                          <span className="text-orange-400">{entry.plex_username}</span>
                        )}
                        {entry.details && (
                          <span className="text-slate-400"> {entry.details}</span>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
