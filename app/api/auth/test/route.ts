import { NextRequest, NextResponse } from "next/server";

// This endpoint tests Plex authentication independently of NextAuth
// POST /api/auth/test with body: { "token": "your-plex-token" }

export async function POST(request: NextRequest) {
  const timestamp = new Date().toISOString();
  const logs: string[] = [];
  
  function log(msg: string) {
    const line = `[${timestamp}] ${msg}`;
    logs.push(line);
    console.error(line); // Write to stderr for server visibility
  }

  try {
    const body = await request.json();
    const token = body?.token?.trim();

    log("========== PLEX AUTH TEST ==========");
    log(`Token received: ${token ? token.substring(0, 10) + "..." : "NONE"}`);
    log(`Token length: ${token?.length || 0}`);

    if (!token) {
      log("ERROR: No token provided");
      return NextResponse.json({
        success: false,
        error: "No token provided",
        logs,
      }, { status: 400 });
    }

    // Validate token format
    if (!token.match(/^[A-Za-z0-9_-]+$/)) {
      log("WARNING: Token contains unusual characters");
    }

    const plexUrl = "https://plex.tv/api/v2/user";
    log(`Request URL: ${plexUrl}`);

    const headers: Record<string, string> = {
      "Accept": "application/json",
      "X-Plex-Token": token,
      "X-Plex-Client-Identifier": `plexguard-test-${Date.now()}`,
      "X-Plex-Product": "PlexGuard",
      "X-Plex-Version": "1.0.0",
      "X-Plex-Platform": "Web",
      "X-Plex-Device": "Test",
    };

    log("Sending request to Plex.tv...");
    
    let response;
    try {
      response = await fetch(plexUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15000),
      });
    } catch (fetchError: any) {
      log(`FETCH ERROR: ${fetchError?.message || String(fetchError)}`);
      return NextResponse.json({
        success: false,
        error: `Fetch failed: ${fetchError?.message || String(fetchError)}`,
        logs,
      }, { status: 500 });
    }

    log(`Response status: ${response.status} ${response.statusText}`);
    
    // Log all response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    log(`Response headers: ${JSON.stringify(responseHeaders)}`);

    let responseText: string;
    try {
      responseText = await response.text();
      log(`Response body length: ${responseText.length}`);
    } catch (textError: any) {
      log(`ERROR reading response body: ${textError?.message}`);
      return NextResponse.json({
        success: false,
        error: `Failed to read response: ${textError?.message}`,
        logs,
      }, { status: 500 });
    }

    // Show response preview
    const preview = responseText.substring(0, 1000).replace(/\n/g, '\\n');
    log(`Response preview: ${preview}`);

    if (!response.ok) {
      log(`ERROR: Plex returned ${response.status}`);
      return NextResponse.json({
        success: false,
        error: `Plex API error: ${response.status}`,
        responseBody: responseText,
        logs,
      }, { status: 401 });
    }

    // Parse user data
    let user: any = null;
    
    if (responseText.trim().startsWith("<?xml") || responseText.trim().startsWith("<user")) {
      log("Parsing XML response...");
      
      const idMatch = responseText.match(/<user[^>]*id="(\d+)"/i);
      const usernameMatch = responseText.match(/<user[^>]*username="([^"]*)"/i);
      const emailMatch = responseText.match(/<user[^>]*email="([^"]*)"/i);
      const thumbMatch = responseText.match(/<user[^>]*thumb="([^"]*)"/i);
      const titleMatch = responseText.match(/<user[^>]*title="([^"]*)"/i);
      
      log(`XML parse - idMatch: ${!!idMatch}, usernameMatch: ${!!usernameMatch}, emailMatch: ${!!emailMatch}`);
      
      if (idMatch) {
        user = {
          id: idMatch[1],
          username: usernameMatch?.[1] || titleMatch?.[1] || "",
          email: emailMatch?.[1] || "",
          thumb: thumbMatch?.[1] || "",
          title: titleMatch?.[1] || "",
        };
      }
    } else if (responseText.trim().startsWith("{")) {
      log("Parsing JSON response...");
      try {
        user = JSON.parse(responseText);
        log(`JSON parsed successfully`);
      } catch (e: any) {
        log(`JSON parse error: ${e?.message}`);
      }
    }

    if (!user) {
      log("ERROR: Could not parse user from response");
      return NextResponse.json({
        success: false,
        error: "Could not parse user data",
        responseBody: responseText,
        logs,
      }, { status: 500 });
    }

    log(`SUCCESS! User: ${user.username || user.title || user.email || user.id}`);
    log("========== TEST COMPLETE ==========");

    return NextResponse.json({
      success: true,
      user: {
        id: String(user.id),
        name: user.username || user.title || user.email || String(user.id),
        email: user.email || null,
        image: user.thumb || null,
      },
      logs,
    });

  } catch (error: any) {
    log(`UNEXPECTED ERROR: ${error?.message || String(error)}`);
    log(`Stack: ${error?.stack || 'no stack'}`);
    
    return NextResponse.json({
      success: false,
      error: `Unexpected error: ${error?.message || String(error)}`,
      logs,
    }, { status: 500 });
  }
}

// Also allow GET for quick testing (with token in query param)
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  
  if (!token) {
    return NextResponse.json({
      success: false,
      error: "No token provided. Use ?token=YOUR_TOKEN",
      usage: "GET /api/auth/test?token=YOUR_PLEX_TOKEN or POST with JSON body { \"token\": \"...\" }",
    }, { status: 400 });
  }
  
  // Reuse POST logic
  const mockRequest = {
    json: async () => ({ token }),
  } as NextRequest;
  
  return POST(mockRequest);
}
