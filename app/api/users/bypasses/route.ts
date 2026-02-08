import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/users/bypasses - list all active temporary bypasses
export async function GET() {
  try {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const bypasses = db.prepare(
      "SELECT * FROM temporary_bypasses WHERE expires_at > ?"
    ).all(now);
    return NextResponse.json(bypasses);
  } catch (error: any) {
    // Table might not exist yet
    return NextResponse.json([]);
  }
}
