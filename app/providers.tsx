"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/use-toast";

// Note: this used to try to start the rule enforcer from a useEffect guarded by
// `typeof window === 'undefined'` — a condition that is never true in a "use client"
// effect, so it never ran. Enforcement belongs to the standalone enforcer process.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}
