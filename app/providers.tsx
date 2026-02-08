"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode, useEffect } from "react";
import { ToastProvider } from "@/components/ui/use-toast";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Start the rule enforcer on the server side only
    if (typeof window === 'undefined') {
      import("@/lib/enforcer").then(({ startEnforcer }) => {
        startEnforcer(1); // Check every minute
      });
    }
  }, []);

  return (
    <SessionProvider>
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}
