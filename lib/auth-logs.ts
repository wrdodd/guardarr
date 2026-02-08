// In-memory debug storage for auth logs
export interface AuthLogEntry {
  timestamp: string;
  type: "info" | "error" | "success";
  message: string;
  data?: any;
}

declare global {
  var authDebugLogs: AuthLogEntry[];
  var lastAuthError: string | undefined;
}

// Initialize global storage
if (typeof global !== "undefined") {
  if (!global.authDebugLogs) {
    global.authDebugLogs = [];
  }
}

export function addAuthLog(type: "info" | "error" | "success", message: string, data?: any) {
  const entry: AuthLogEntry = {
    timestamp: new Date().toISOString(),
    type,
    message,
    data,
  };
  
  if (typeof global !== "undefined" && global.authDebugLogs) {
    global.authDebugLogs.push(entry);
    // Keep only last 100 entries
    if (global.authDebugLogs.length > 100) {
      global.authDebugLogs = global.authDebugLogs.slice(-100);
    }
  }
  
  // Also log to console
  const prefix = `[AUTH ${type.toUpperCase()}]`;
  if (type === "error") {
    console.error(prefix, message, data || "");
  } else {
    console.log(prefix, message, data || "");
  }
}

export function getAuthLogs(): AuthLogEntry[] {
  if (typeof global !== "undefined" && global.authDebugLogs) {
    return [...global.authDebugLogs];
  }
  return [];
}

export function clearAuthLogs() {
  if (typeof global !== "undefined") {
    global.authDebugLogs = [];
    global.lastAuthError = undefined;
  }
}

export function setLastAuthError(error: string) {
  if (typeof global !== "undefined") {
    global.lastAuthError = error;
  }
}

export function getLastAuthError(): string | undefined {
  if (typeof global !== "undefined") {
    return global.lastAuthError;
  }
  return undefined;
}
