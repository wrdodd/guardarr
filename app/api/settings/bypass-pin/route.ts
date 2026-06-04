import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createHash } from "crypto";

// Auth-gated by middleware. Manage the optional parent PIN required to grant a bypass.
export const dynamic = "force-dynamic";

function hashPin(pin: string): string {
  return createHash("sha256").update(String(pin)).digest("hex");
}

export async function GET() {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'bypass_pin_hash'")
    .get() as { value: string } | undefined;
  return NextResponse.json(
    { pin_set: !!(row && row.value) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  try {
    const { pin } = await request.json();
    // Empty/null clears the PIN.
    if (pin === "" || pin == null) {
      db.prepare("DELETE FROM settings WHERE key = 'bypass_pin_hash'").run();
      return NextResponse.json({ success: true, pin_set: false });
    }
    if (!/^\d{4,8}$/.test(String(pin))) {
      return NextResponse.json({ error: "PIN must be 4–8 digits" }, { status: 400 });
    }
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('bypass_pin_hash', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).run(hashPin(String(pin)));
    return NextResponse.json({ success: true, pin_set: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
