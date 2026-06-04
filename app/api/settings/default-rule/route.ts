import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Auth-gated by middleware. Read/write the "default rule for new users" setting.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'default_rule_id'")
      .get() as { value: string } | undefined;
    return NextResponse.json(
      { default_rule_id: row?.value || "" },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { default_rule_id } = await request.json();
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('default_rule_id', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).run(String(default_rule_id ?? ""));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
