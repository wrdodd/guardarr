import { NextResponse } from "next/server";

// In-memory storage
interface AuthLogEntry {
  timestamp: string;
  type: "info" | "error" | "success";
  message: string;
}

declare global {
  var authDebugLogs: AuthLogEntry[];
}

// Initialize
if (typeof global !== "undefined" && !global.authDebugLogs) {
  global.authDebugLogs = [];
}

function addLog(type: "info" | "error" | "success", message: string) {
  if (typeof global !== "undefined" && global.authDebugLogs) {
    global.authDebugLogs.push({
      timestamp: new Date().toISOString(),
      type,
      message,
    });
    if (global.authDebugLogs.length > 100) {
      global.authDebugLogs = global.authDebugLogs.slice(-100);
    }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  
  if (action === "clear") {
    if (typeof global !== "undefined") {
      global.authDebugLogs = [];
    }
    return NextResponse.json({ cleared: true, serverTime: new Date().toISOString() });
  }
  
  const logs = (typeof global !== "undefined" && global.authDebugLogs) ? global.authDebugLogs : [];
  
  return NextResponse.json({
    logCount: logs.length,
    serverTime: new Date().toISOString(),
    logs: logs,
  });
}

export async function DELETE(request: Request) {
  console.error("[DEBUG API] Clear logs via DELETE");
  if (typeof global !== "undefined") {
    global.authDebugLogs = [];
  }
  return NextResponse.json({ cleared: true, serverTime: new Date().toISOString() });
}
