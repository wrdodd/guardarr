import { NextRequest, NextResponse } from "next/server";

// SIMPLE TEST: Call this with ?token=YOUR_PLEX_TOKEN
// Returns EXACTLY what Plex API returns - no parsing, no magic
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { 
        error: "No token provided",
        usage: "GET /api/test-plex?token=YOUR_PLEX_TOKEN"
      },
      { status: 400 }
    );
  }

  const plexUrl = "https://plex.tv/api/v2/user";
  
  // Headers EXACTLY as Plex expects them
  const headers: Record<string, string> = {
    "X-Plex-Token": token,
    "X-Plex-Client-Identifier": "plexguard-test",
  };

  try {
    const response = await fetch(plexUrl, {
      method: "GET",
      headers,
    });

    const responseText = await response.text();
    
    // Collect all response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return NextResponse.json({
      // Request details
      request: {
        url: plexUrl,
        headers: {
          ...headers,
          "X-Plex-Token": token.substring(0, 5) + "..." + token.substring(token.length - 5) // Partial redaction for debugging
        }
      },
      // Response details
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseText,
        bodyLength: responseText.length,
      },
      // Quick analysis
      analysis: {
        isJson: responseText.trim().startsWith("{"),
        isXml: responseText.trim().startsWith("<?xml") || responseText.trim().startsWith("<user"),
        isError: !response.ok,
      }
    });
  } catch (error) {
    return NextResponse.json({
      error: "Fetch failed",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}
