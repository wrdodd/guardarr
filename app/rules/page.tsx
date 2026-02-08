"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Plus, Trash2, Clock, Pencil, X, ArrowUp, ArrowDown } from "lucide-react";
import Link from "next/link";

interface Rule {
  id: number;
  name: string;
  is_active: number;
  days: string;
  start_time: string;
  end_time: string;
  allowed_ratings: string;
  blocked_ratings: string;
  allowed_tv_ratings: string;
  blocked_tv_ratings: string;
  include_labels: string;
  exclude_labels: string;
  priority: number;
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<string, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun"
};
const MOVIE_RATINGS = ["G", "PG", "PG-13", "R", "NC-17", "NR"];
const TV_RATINGS = ["TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "TV-MA"];

export default function RulesPage() {
  const { toast } = useToast();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [selectedDays, setSelectedDays] = useState<string[]>(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  const [startTime, setStartTime] = useState("20:00");
  const [endTime, setEndTime] = useState("06:00");
  const [allowedRatings, setAllowedRatings] = useState<string[]>([]);
  const [blockedRatings, setBlockedRatings] = useState<string[]>(["R", "NC-17"]);
  const [allowedTvRatings, setAllowedTvRatings] = useState<string[]>([]);
  const [blockedTvRatings, setBlockedTvRatings] = useState<string[]>(["TV-MA"]);
  const [includeLabels, setIncludeLabels] = useState("");
  const [excludeLabels, setExcludeLabels] = useState("");
  const [priority, setPriority] = useState(0);

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      const res = await fetch("/api/rules");
      const data = await res.json();
      setRules(data);
    } catch (error) {
      toast({ title: "Error", description: "Failed to load rules", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const toggleDay = (day: string) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const toggleBlockedRating = (rating: string) => {
    setBlockedRatings(prev =>
      prev.includes(rating) ? prev.filter(r => r !== rating) : [...prev, rating]
    );
    // Remove from allowed if present
    setAllowedRatings(prev => prev.filter(r => r !== rating));
  };

  const toggleAllowedRating = (rating: string) => {
    setAllowedRatings(prev =>
      prev.includes(rating) ? prev.filter(r => r !== rating) : [...prev, rating]
    );
    // Remove from blocked if present
    setBlockedRatings(prev => prev.filter(r => r !== rating));
  };

  const toggleBlockedTvRating = (rating: string) => {
    setBlockedTvRatings(prev =>
      prev.includes(rating) ? prev.filter(r => r !== rating) : [...prev, rating]
    );
    setAllowedTvRatings(prev => prev.filter(r => r !== rating));
  };

  const toggleAllowedTvRating = (rating: string) => {
    setAllowedTvRatings(prev =>
      prev.includes(rating) ? prev.filter(r => r !== rating) : [...prev, rating]
    );
    setBlockedTvRatings(prev => prev.filter(r => r !== rating));
  };

  const resetForm = () => {
    setName("");
    setSelectedDays(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    setStartTime("20:00");
    setEndTime("06:00");
    setAllowedRatings([]);
    setBlockedRatings(["R", "NC-17"]);
    setAllowedTvRatings([]);
    setBlockedTvRatings(["TV-MA"]);
    setIncludeLabels("");
    setExcludeLabels("");
    setPriority(0);
    setEditingRule(null);
  };

  const populateForm = (rule: Rule) => {
    setName(rule.name);
    setSelectedDays(rule.days.split(","));
    setStartTime(rule.start_time);
    setEndTime(rule.end_time);
    setAllowedRatings(rule.allowed_ratings ? rule.allowed_ratings.split(",") : []);
    setBlockedRatings(rule.blocked_ratings ? rule.blocked_ratings.split(",") : []);
    setAllowedTvRatings(rule.allowed_tv_ratings ? rule.allowed_tv_ratings.split(",") : []);
    setBlockedTvRatings(rule.blocked_tv_ratings ? rule.blocked_tv_ratings.split(",") : []);
    setIncludeLabels(rule.include_labels || "");
    setExcludeLabels(rule.exclude_labels || "");
    setPriority(rule.priority || 0);
    setEditingRule(rule);
    setShowForm(true);
  };

  const createRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          is_active: true,
          days: selectedDays.join(","),
          start_time: startTime,
          end_time: endTime,
          allowed_ratings: allowedRatings.join(","),
          blocked_ratings: blockedRatings.join(","),
          allowed_tv_ratings: allowedTvRatings.join(","),
          blocked_tv_ratings: blockedTvRatings.join(","),
          include_labels: includeLabels,
          exclude_labels: excludeLabels,
          priority,
        }),
      });

      if (res.ok) {
        toast({ title: "Success", description: "Rule created" });
        setShowForm(false);
        resetForm();
        fetchRules();
      } else {
        throw new Error("Failed to create");
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to create rule", variant: "destructive" });
    }
  };

  const updateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRule) return;

    try {
      const res = await fetch(`/api/rules/${editingRule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          is_active: editingRule.is_active,
          days: selectedDays.join(","),
          start_time: startTime,
          end_time: endTime,
          allowed_ratings: allowedRatings.join(","),
          blocked_ratings: blockedRatings.join(","),
          allowed_tv_ratings: allowedTvRatings.join(","),
          blocked_tv_ratings: blockedTvRatings.join(","),
          include_labels: includeLabels,
          exclude_labels: excludeLabels,
          priority,
        }),
      });

      if (res.ok) {
        toast({ title: "Success", description: "Rule updated" });
        setShowForm(false);
        resetForm();
        fetchRules();
      } else {
        throw new Error("Failed to update");
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to update rule", variant: "destructive" });
    }
  };

  const deleteRule = async (id: number) => {
    if (!confirm("Delete this rule?")) return;
    try {
      await fetch(`/api/rules/${id}`, { method: "DELETE" });
      toast({ title: "Success", description: "Rule deleted" });
      fetchRules();
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
    }
  };

  const adjustPriority = async (ruleId: number, delta: number) => {
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;
    const newPriority = Math.max(0, (rule.priority || 0) + delta);
    try {
      await fetch(`/api/rules/${ruleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...rule,
          priority: newPriority,
        }),
      });
      fetchRules();
    } catch (error) {
      toast({ title: "Error", description: "Failed to update priority", variant: "destructive" });
    }
  };

  const cancelEdit = () => {
    setShowForm(false);
    resetForm();
  };

  const formatDays = (daysStr: string) => {
    const days = daysStr.split(",");
    if (days.length === 7) return "Every day";
    if (days.length === 5 && !days.includes("sat") && !days.includes("sun")) return "Weekdays";
    if (days.length === 2 && days.includes("sat") && days.includes("sun")) return "Weekends";
    return days.map(d => DAY_LABELS[d] || d).join(", ");
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
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" className="text-slate-400 hover:text-slate-100">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold text-orange-500">Rules</h1>
          </div>
          <Button
            onClick={() => {
              if (showForm && editingRule) {
                cancelEdit();
              } else {
                setShowForm(!showForm);
                if (showForm) resetForm();
              }
            }}
            className="bg-orange-500 hover:bg-orange-600 text-slate-950"
          >
            <Plus className="h-4 w-4 mr-2" />
            {showForm ? (editingRule ? "Cancel Edit" : "Cancel") : "New Rule"}
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {showForm && (
          <Card className="bg-slate-900 border-slate-800 mb-6">
            <CardHeader>
              <CardTitle className="text-slate-100 flex items-center justify-between">
                {editingRule ? "Edit Rule" : "Create New Rule"}
                {editingRule && (
                  <Button variant="ghost" size="sm" onClick={cancelEdit} className="text-slate-400">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={editingRule ? updateRule : createRule} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <Label className="text-slate-300">Rule Name</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Evening Adult Hours"
                      className="bg-slate-800 border-slate-700 text-slate-100"
                      required
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Priority</Label>
                    <Input
                      type="number"
                      min={0}
                      value={priority}
                      onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                      placeholder="0"
                      className="bg-slate-800 border-slate-700 text-slate-100"
                    />
                    <p className="text-slate-600 text-xs mt-1">Higher = applied first</p>
                  </div>
                </div>

                <div>
                  <Label className="text-slate-300 mb-2 block">Active Days</Label>
                  <div className="flex gap-3">
                    {DAYS.map(day => (
                      <label key={day} className="flex items-center gap-1 cursor-pointer">
                        <Checkbox
                          checked={selectedDays.includes(day)}
                          onCheckedChange={() => toggleDay(day)}
                        />
                        <span className="text-slate-400 text-sm">{DAY_LABELS[day]}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300">Start Time</Label>
                    <Input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-slate-100"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">End Time</Label>
                    <Input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Movie Ratings - Left Side */}
                  <div className="space-y-4 p-4 rounded-lg border border-slate-700/50 bg-slate-800/30">
                    <h3 className="text-slate-200 font-medium text-sm flex items-center gap-2">
                      🎬 Movie Ratings
                    </h3>
                    <div>
                      <Label className="text-slate-300 mb-2 block text-xs">Allowed (whitelist)</Label>
                      <div className="flex flex-wrap gap-3">
                        {MOVIE_RATINGS.map(rating => (
                          <label key={rating} className="flex items-center gap-1 cursor-pointer">
                            <Checkbox
                              checked={allowedRatings.includes(rating)}
                              onCheckedChange={() => toggleAllowedRating(rating)}
                            />
                            <span className="text-slate-400 text-sm">{rating}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-slate-500 text-xs mt-1">Only allow these (blank = allow all)</p>
                      {allowedRatings.length > 0 && (
                        <p className="text-amber-400 text-xs mt-1">⚠️ Blocked ignored when whitelist is active</p>
                      )}
                    </div>
                    <div className={allowedRatings.length > 0 ? "opacity-50" : ""}>
                      <Label className="text-slate-300 mb-2 block text-xs">Blocked (blacklist)</Label>
                      <div className="flex flex-wrap gap-3">
                        {MOVIE_RATINGS.map(rating => (
                          <label key={rating} className="flex items-center gap-1 cursor-pointer">
                            <Checkbox
                              checked={blockedRatings.includes(rating)}
                              onCheckedChange={() => toggleBlockedRating(rating)}
                            />
                            <span className="text-slate-400 text-sm">{rating}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-slate-500 text-xs mt-1">Block these ratings</p>
                    </div>
                  </div>

                  {/* TV Ratings - Right Side */}
                  <div className="space-y-4 p-4 rounded-lg border border-slate-700/50 bg-slate-800/30">
                    <h3 className="text-slate-200 font-medium text-sm flex items-center gap-2">
                      📺 TV Ratings
                    </h3>
                    <div>
                      <Label className="text-slate-300 mb-2 block text-xs">Allowed (whitelist)</Label>
                      <div className="flex flex-wrap gap-3">
                        {TV_RATINGS.map(rating => (
                          <label key={rating} className="flex items-center gap-1 cursor-pointer">
                            <Checkbox
                              checked={allowedTvRatings.includes(rating)}
                              onCheckedChange={() => toggleAllowedTvRating(rating)}
                            />
                            <span className="text-slate-400 text-sm">{rating}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-slate-500 text-xs mt-1">Only allow these (blank = allow all)</p>
                      {allowedTvRatings.length > 0 && (
                        <p className="text-amber-400 text-xs mt-1">⚠️ Blocked ignored when whitelist is active</p>
                      )}
                    </div>
                    <div className={allowedTvRatings.length > 0 ? "opacity-50" : ""}>
                      <Label className="text-slate-300 mb-2 block text-xs">Blocked (blacklist)</Label>
                      <div className="flex flex-wrap gap-3">
                        {TV_RATINGS.map(rating => (
                          <label key={rating} className="flex items-center gap-1 cursor-pointer">
                            <Checkbox
                              checked={blockedTvRatings.includes(rating)}
                              onCheckedChange={() => toggleBlockedTvRating(rating)}
                            />
                            <span className="text-slate-400 text-sm">{rating}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-slate-500 text-xs mt-1">Block these ratings</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300">Include Labels (optional)</Label>
                    <Input
                      value={includeLabels}
                      onChange={(e) => setIncludeLabels(e.target.value)}
                      placeholder="family,kids"
                      className="bg-slate-800 border-slate-700 text-slate-100"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Exclude Labels (optional)</Label>
                    <Input
                      value={excludeLabels}
                      onChange={(e) => setExcludeLabels(e.target.value)}
                      placeholder="mature,adult"
                      className="bg-slate-800 border-slate-700 text-slate-100"
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button type="submit" className="bg-orange-500 hover:bg-orange-600 text-slate-950">
                    {editingRule ? "Update Rule" : "Create Rule"}
                  </Button>
                  {editingRule && (
                    <Button type="button" variant="outline" onClick={cancelEdit} className="border-slate-700 text-slate-300">
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {rules.length === 0 ? (
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="py-12 text-center">
                <Clock className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                <p className="text-slate-400">No rules created yet</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <p className="text-slate-500 text-xs mb-2">
                Rules are ordered by priority (highest first). Higher priority rules are applied first by the enforcer.
              </p>
              {rules.map((rule, index) => (
                <Card key={rule.id} className="bg-slate-900 border-slate-800">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Priority controls */}
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={() => adjustPriority(rule.id, 1)}
                            className="text-slate-600 hover:text-orange-400 transition-colors"
                            title="Increase priority"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <span className="text-xs text-center text-slate-500 font-mono min-w-[20px]">
                            {rule.priority || 0}
                          </span>
                          <button
                            onClick={() => adjustPriority(rule.id, -1)}
                            className="text-slate-600 hover:text-orange-400 transition-colors"
                            title="Decrease priority"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className={`w-3 h-3 rounded-full ${rule.is_active ? "bg-green-500" : "bg-slate-600"}`} />
                        <CardTitle className="text-slate-100 text-lg">{rule.name}</CardTitle>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => populateForm(rule)}
                          className="text-slate-500 hover:text-orange-400"
                          title="Edit rule"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteRule(rule.id)}
                          className="text-slate-500 hover:text-red-400"
                          title="Delete rule"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-slate-400 text-sm space-y-1">
                      <p><span className="text-slate-500">Days:</span> {formatDays(rule.days)}</p>
                      <p><span className="text-slate-500">Time:</span> {rule.start_time} - {rule.end_time}</p>
                      {(rule.allowed_ratings || rule.blocked_ratings) && (
                        <p>
                          <span className="text-slate-500">🎬 Movies:</span>{" "}
                          {rule.allowed_ratings ? (
                            <span className="text-green-400">Allowed only: {rule.allowed_ratings}</span>
                          ) : (
                            <span>Blocked: {rule.blocked_ratings}</span>
                          )}
                        </p>
                      )}
                      {(rule.allowed_tv_ratings || rule.blocked_tv_ratings) && (
                        <p>
                          <span className="text-slate-500">📺 TV:</span>{" "}
                          {rule.allowed_tv_ratings ? (
                            <span className="text-green-400">Allowed only: {rule.allowed_tv_ratings}</span>
                          ) : (
                            <span>Blocked: {rule.blocked_tv_ratings}</span>
                          )}
                        </p>
                      )}
                      {rule.include_labels && (
                        <p><span className="text-slate-500">Include:</span> {rule.include_labels}</p>
                      )}
                      {rule.exclude_labels && (
                        <p><span className="text-slate-500">Exclude:</span> {rule.exclude_labels}</p>
                      )}
                      {(rule.priority || 0) > 0 && (
                        <p><span className="text-slate-500">Priority:</span> {rule.priority}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
