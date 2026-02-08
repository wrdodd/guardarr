import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/users/bypasses - list all active temporary bypasses
export async function GET() {
  try {
    const bypasses = db.prepare(
      "SELECT * FROM temporary_bypasses WHERE expires_at > datetime('now')"
    ).all();
    return NextResponse.json(bypasses);
  } catch (error: any) {
    // Table might not exist yet
    return NextResponse.json([]);
  }
}
