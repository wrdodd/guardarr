import { enforceRules, startEnforcer } from "@/lib/enforcer";

// Singleton to track if enforcer is running
let enforcerStarted = false;

// GET /api/enforcer - run enforcement check now
export async function GET() {
  try {
    // Auto-start enforcer on first request if not running
    if (!enforcerStarted) {
      startEnforcer(1);
      enforcerStarted = true;
    }
    
    // Run enforcement immediately
    await enforceRules();
    
    return Response.json({ 
      success: true, 
      message: "Enforcement check completed",
      enforcerRunning: true 
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
