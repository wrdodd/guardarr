import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { error: "No token provided. Use ?token=YOUR_PLEX_TOKEN" },
      { status: 400 }
    );
  }

  const results: any = {
    timestamp: new Date().toISOString(),
    tokenProvided: token.substring(0, 5) + "...",
    steps: [],
  };

  try {
    // Step 1: Validate token format
    results.steps.push({ step: 1, name: "Token format validation", status: "running" });
    if (!token.match(/^[A-Za-z0-9_-]+$/)) {
      results.steps[0].status = "failed";
      results.steps[0].error = "Token contains invalid characters";
      return NextResponse.json(results, { status: 400 });
    }
    results.steps[0].status = "passed";
    results.steps[0].details = `Token length: ${token.length}`;

    // Step 2: Call Plex API
    results.steps.push({ step: 2, name: "Plex API call", status: "running" });
    const plexUrl = "https://plex.tv/api/v2/user";
    const headers = {
      "Accept": "application/json",
      "X-Plex-Token": token,
      "X-Plex-Client-Identifier": "guardarr-test",
      "X-Plex-Product": "Guardarr Test",
      "X-Plex-Version": "1.0.0",
      "X-Plex-Platform": "Web",
    };

    const response = await fetch(plexUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(30000),
    });

    results.steps[1].status = "completed";
    results.steps[1].httpStatus = response.status;
    results.steps[1].httpStatusText = response.statusText;

    // Step 3: Read response
    results.steps.push({ step: 3, name: "Read response body", status: "running" });
    const responseText = await response.text();
    results.steps[2].status = "completed";
    results.steps[2].bodyLength = responseText.length;
    results.steps[2].bodyPreview = responseText.substring(0, 500);

    // Step 4: Parse response
    results.steps.push({ step: 4, name: "Parse response", status: "running" });
    if (!response.ok) {
      results.steps[3].status = "failed";
      results.steps[3].error = `HTTP ${response.status}: ${responseText.substring(0, 200)}`;
      results.success = false;
      return NextResponse.json(results, { status: 200 });
    }

    let user;
    if (responseText.trim().startsWith("<?xml") || responseText.trim().startsWith("<")) {
      results.steps[3].format = "xml";
      const idMatch = responseText.match(/<user[^>]*id="(\d+)"/);
      const usernameMatch = responseText.match(/<user[^>]*username="([^"]*)"/);
      const emailMatch = responseText.match(/<user[^>]*email="([^"]*)"/);
      
      user = {
        id: idMatch?.[1],
        username: usernameMatch?.[1],
        email: emailMatch?.[1],
      };
    } else {
      results.steps[3].format = "json";
      try {
        user = JSON.parse(responseText);
      } catch (e) {
        results.steps[3].status = "failed";
        results.steps[3].error = `JSON parse error: ${e instanceof Error ? e.message : String(e)}`;
        results.success = false;
        return NextResponse.json(results, { status: 200 });
      }
    }

    results.steps[3].status = "completed";
    results.steps[3].parsedUser = {
      id: user?.id,
      username: user?.username,
      email: user?.email,
      title: user?.title,
    };

    // Step 5: Validate user
    results.steps.push({ step: 5, name: "Validate user data", status: "running" });
    if (!user || !user.id) {
      results.steps[4].status = "failed";
      results.steps[4].error = "No user ID found in response";
      results.success = false;
      return NextResponse.json(results, { status: 200 });
    }

    results.steps[4].status = "passed";
    results.success = true;
    results.user = {
      id: String(user.id),
      name: user.username || user.title || user.email || String(user.id),
      email: user.email || null,
      image: user.thumb || null,
    };

    return NextResponse.json(results, { status: 200 });

  } catch (error) {
    results.success = false;
    results.error = error instanceof Error ? error.message : String(error);
    results.errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(results, { status: 200 });
  }
}
