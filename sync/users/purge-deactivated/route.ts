import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/users/purge-deactivated - permanently delete all deactivated users
export async function POST() {
  try {
    // Get all deactivated users
    const deactivatedUsers = db
      .prepare("SELECT id, plex_username FROM users WHERE deactivated = 1")
      .all() as { id: number; plex_username: string }[];
    
    if (deactivatedUsers.length === 0) {
      return NextResponse.json({ success: true, deleted: 0, message: "No deactivated users to purge" });
    }
    
    let deletedCount = 0;
    
    for (const user of deactivatedUsers) {
      // Delete related records first
      db.prepare("DELETE FROM user_rules WHERE user_id = ?").run(user.id);
      db.prepare("DELETE FROM temporary_bypasses WHERE user_id = ?").run(user.id);
      db.prepare("DELETE FROM user_preferences WHERE user_id = ?").run(user.id);
      db.prepare("DELETE FROM applied_restrictions WHERE user_id = ?").run(user.id);
      
      // Delete the user
      db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
      deletedCount++;
    }
    
    // Log the purge
    db.prepare("INSERT INTO activity_log (plex_username, action, details) VALUES (?, ?, ?)").run(
      "System",
      "users_purge",
      `Purged ${deletedCount} deactivated users: ${deactivatedUsers.map(u => u.plex_username).join(", ")}`
    );
    
    return NextResponse.json({ 
      success: true, 
      deleted: deletedCount,
      users: deactivatedUsers.map(u => u.plex_username)
    });
  } catch (error: any) {
    console.error("Purge deactivated error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
