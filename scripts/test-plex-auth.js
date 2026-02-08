/**
 * Simple Node.js test for Plex API authentication
 * Run with: node scripts/test-plex-auth.js <token>
 */

async function testPlexAuth(token) {
  console.log("Testing Plex authentication...");
  console.log("Token:", token.substring(0, 5) + "... (" + token.length + " chars)");

  const headers = {
    "Accept": "application/json",
    "X-Plex-Token": token,
    "X-Plex-Client-Identifier": "plexguard-test",
    "X-Plex-Product": "PlexGuard",
    "X-Plex-Version": "1.0.0",
    "X-Plex-Platform": "Web",
  };

  try {
    const response = await fetch("https://plex.tv/api/v2/user", {
      method: "GET",
      headers,
    });

    console.log("\nResponse status:", response.status, response.statusText);
    console.log("Content-Type:", response.headers.get("content-type"));

    const text = await response.text();
    console.log("\nResponse body (" + text.length + " chars):");
    console.log(text.substring(0, 2000));

    if (!response.ok) {
      console.error("\n❌ Authentication failed");
      return false;
    }

    // Try to parse as JSON
    if (text.trim().startsWith("{")) {
      const user = JSON.parse(text);
      console.log("\n✅ JSON Response parsed successfully");
      console.log("User:", JSON.stringify(user, null, 2));
      return true;
    }

    // Try to parse as XML
    if (text.trim().startsWith("<?xml") || text.trim().startsWith("<user")) {
      console.log("\n✅ XML Response received");
      const idMatch = text.match(/<user[^>]*id="(\d+)"/);
      const usernameMatch = text.match(/<user[^>]*username="([^"]*)"/);
      const emailMatch = text.match(/<user[^>]*email="([^"]*)"/);
      
      console.log("Extracted from XML:");
      console.log("  ID:", idMatch?.[1] || "not found");
      console.log("  Username:", usernameMatch?.[1] || "not found");
      console.log("  Email:", emailMatch?.[1] || "not found");
      return true;
    }

    console.log("\n⚠️ Unknown response format");
    return false;

  } catch (error) {
    console.error("\n❌ Request failed:", error);
    return false;
  }
}

// Get token from command line
const token = process.argv[2];
if (!token) {
  console.log("Usage: node scripts/test-plex-auth.js <your-plex-token>");
  console.log("\nTo find your Plex token, see:");
  console.log("https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/");
  process.exit(1);
}

testPlexAuth(token);
