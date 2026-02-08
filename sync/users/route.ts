import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Helper to get a setting from DB or env
function getSetting(key: string, envKey: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value || process.env[envKey] || "";
}

// GET /api/users - list all synced users with their assigned rules
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeDeactivated = searchParams.get("includeDeactivated") === "true";
    
    const query = includeDeactivated
      ? `SELECT u.*, 
          (SELECT GROUP_CONCAT(r.id) FROM user_rules ur JOIN rules r ON r.id = ur.rule_id WHERE ur.user_id = u.id) as rule_ids,
          (SELECT GROUP_CONCAT(r.name) FROM user_rules ur JOIN rules r ON r.id = ur.rule_id WHERE ur.user_id = u.id) as rule_names
        FROM users u ORDER BY u.deactivated, u.plex_username`
      : `SELECT u.*, 
          (SELECT GROUP_CONCAT(r.id) FROM user_rules ur JOIN rules r ON r.id = ur.rule_id WHERE ur.user_id = u.id) as rule_ids,
          (SELECT GROUP_CONCAT(r.name) FROM user_rules ur JOIN rules r ON r.id = ur.rule_id WHERE ur.user_id = u.id) as rule_names
        FROM users u WHERE u.deactivated = 0 ORDER BY u.plex_username`;
    
    const users = db.prepare(query).all();
    return NextResponse.json(users);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/users/sync - sync users from Plex server
export async function POST() {
  try {
    const serverUrl = getSetting("plex_server_url", "PLEX_SERVER_URL");
    const token = getSetting("plex_admin_token", "PLEX_ADMIN_TOKEN");

    if (!serverUrl || !token) {
      return NextResponse.json(
        { error: "Plex server URL and admin token not configured. Go to Settings." },
        { status: 400 }
      );
    }

    // Fetch ALL accounts from local Plex server (this has ALL users including managed/home users)
    const localAccountsRes = await fetch(`${serverUrl.replace(/\/$/, "")}/accounts`, {
      headers: {
        Accept: "application/json",
        "X-Plex-Token": token,
      },
      signal: AbortSignal.timeout(10000),
    });

    // Also fetch from plex.tv for email/thumb info
    const adminRes = await fetch("https://plex.tv/api/v2/user", {
      headers: {
        Accept: "application/json",
        "X-Plex-Token": token,
        "X-Plex-Client-Identifier": "plexguard-web",
      },
      signal: AbortSignal.timeout(10000),
    });

    const sharedRes = await fetch("https://plex.tv/api/v2/friends", {
      headers: {
        Accept: "application/json",
        "X-Plex-Token": token,
        "X-Plex-Client-Identifier": "plexguard-web",
      },
      signal: AbortSignal.timeout(10000),
    });

    // Build a map of plex.tv users for extra info
    const plexTvUsers: Record<string, any> = {};
    
    if (adminRes.ok) {
      const admin = await adminRes.json();
      if (admin.id) plexTvUsers[String(admin.id)] = admin;
    }
    
    if (sharedRes.ok) {
      const friends = await sharedRes.json();
      for (const friend of friends) {
        if (friend.id) plexTvUsers[String(friend.id)] = friend;
      }
    }

    const upsert = db.prepare(`
      INSERT INTO users (plex_id, plex_username, plex_email, plex_thumb, is_admin, is_home, is_restricted, updated_at, deactivated)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 0)
      ON CONFLICT(plex_id) DO UPDATE SET
        plex_username = excluded.plex_username,
        plex_email = excluded.plex_email,
        plex_thumb = excluded.plex_thumb,
        is_admin = excluded.is_admin,
        is_home = excluded.is_home,
        is_restricted = excluded.is_restricted,
        updated_at = excluded.updated_at,
        deactivated = excluded.deactivated
    `);

    // Mark potentially deactivated users
    const markDeactivated = db.prepare(`
      UPDATE users SET deactivated = 1, updated_at = datetime('now') WHERE plex_id = ?
    `);

    let syncedCount = 0;
    const activePlexIds = new Set<string>();

    // Process local server accounts (the complete list)
    if (localAccountsRes.ok) {
      const data = await localAccountsRes.json();
      const accounts = data?.MediaContainer?.Account || [];
      
      for (const account of accounts) {
        // Skip the default/system account with id 0
        if (!account.id || account.id === 0 || account.id === "0") continue;
        
        const plexId = String(account.id);
        const username = account.name || account.username || account.title || `User ${account.id}`;
        
        // Filter out deactivated/guest accounts:
        // 1. No username or placeholder name
        // 2. Account marked as deleted in any field
        // 3. Guest/Home users that no longer have library access
        const isPlaceholderName = !username || username.startsWith("Guest") || username.startsWith("User ");
        const isDeleted = account.deleted || account.status === "deleted" || account.$?.deleted === "1";
        
        if (isDeleted) {
          markDeactivated.run(plexId);
          continue;
        }
        
        // Track active IDs for cleanup later
        activePlexIds.add(plexId);
        
        // Get extra info from plex.tv if available
        const tvInfo = plexTvUsers[plexId];
        const email = tvInfo?.email || account.email || null;
        const thumb = tvInfo?.thumb || account.thumb || null;
        
        // Check if this user actually has library access
        // If they're in plex.tv friends list, they're definitely active
        const hasServerAccess = tvInfo !== undefined;
        const isServerAdmin = account.name === "wrdodd" || account.admin === true;
        
        // Determine user type
        const isAdmin = isServerAdmin;
        const isHome = true; // All local accounts are home users
        const isRestricted = account.restricted === true;

        upsert.run(
          plexId,
          username,
          email,
          thumb,
          isAdmin ? 1 : 0,
          isHome ? 1 : 0,
          isRestricted ? 1 : 0
        );
        syncedCount++;
      }
    }

    // Also mark as deactivated any users that weren't returned in the sync
    // and don't exist in the plex.tv friends list
    const allDbUsers = db.prepare("SELECT plex_id FROM users WHERE deactivated = 0").all() as { plex_id: string }[];
    for (const user of allDbUsers) {
      if (!activePlexIds.has(user.plex_id) && !plexTvUsers[user.plex_id]) {
        markDeactivated.run(user.plex_id);
      }
    }

    // Also add any plex.tv friends not in local accounts (edge case)
    for (const [id, user] of Object.entries(plexTvUsers)) {
      if (id === "0") continue;
      try {
        upsert.run(
          id,
          user.username || user.title || user.friendlyName || `User ${id}`,
          user.email || null,
          user.thumb || null,
          0,
          0,
          user.restricted ? 1 : 0
        );
        syncedCount++;
      } catch (e) {
        // User likely already exists, ignore
      }
    }

    // Log the sync activity
    db.prepare(
      "INSERT INTO activity_log (plex_username, action, details) VALUES (?, ?, ?)"
    ).run("System", "user_sync", `Synced ${syncedCount} users from Plex`);

    return NextResponse.json({ success: true, synced: syncedCount });
  } catch (error: any) {
    console.error("Sync error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/users/purge-deactivated - permanently delete all deactivated users
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("id");
    
    if (userId) {
      // Delete specific user
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      
      // Delete related records first (cascade should handle this, but be explicit)
      db.prepare("DELETE FROM user_rules WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM temporary_bypasses WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM user_preferences WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM applied_restrictions WHERE user_id = ?").run(userId);
      
      // Delete the user
      db.prepare("DELETE FROM users WHERE id = ?").run(userId);
      
      db.prepare("INSERT INTO activity_log (plex_username, action, details) VALUES (?, ?, ?)").run(
        "System",
        "user_delete",
        `Deleted user ${user.plex_username} (ID: ${userId})`
      );
      
      return NextResponse.json({ success: true });
    }
    
    return NextResponse.json({ error: "User ID required" }, { status: 400 });
  } catch (error: any) {
    console.error("Delete error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
