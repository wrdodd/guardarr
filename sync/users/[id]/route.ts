import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// DELETE /api/users/[id] - permanently delete a user
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = parseInt(id, 10);
    
    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }
    
    // Get user info for logging
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    
    // Delete related records first
    db.prepare("DELETE FROM user_rules WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM temporary_bypasses WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_preferences WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM applied_restrictions WHERE user_id = ?").run(userId);
    
    // Delete the user
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    
    // Log the deletion
    db.prepare("INSERT INTO activity_log (plex_username, action, details) VALUES (?, ?, ?)").run(
      "System",
      "user_delete",
      `Permanently deleted user ${user.plex_username} (ID: ${userId})`
    );
    
    return NextResponse.json({ success: true, deleted: userId });
  } catch (error: any) {
    console.error("Delete user error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
