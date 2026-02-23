"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";

type Status = "polling" | "success" | "error" | "timeout";
type Mode = "login" | "popup";

export default function PlexCallbackPage() {
  const [status, setStatus] = useState<Status>("polling");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pinId = params.get("pinId");
    const mode = (params.get("mode") as Mode) || "login";

    if (!pinId) {
      setStatus("error");
      setErrorMessage("Missing pinId parameter");
      return;
    }

    let attempts = 0;
    const MAX_ATTEMPTS = 150; // 5 minutes at 2s intervals
    let timeoutId: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/plex-auth/pin?id=${pinId}`);
        const data = await res.json();

        if (data.authorized && data.token) {
          setStatus("success");

          if (mode === "popup") {
            if (window.opener) {
              window.opener.postMessage(
                { type: "PLEX_AUTH_SUCCESS", token: data.token },
                window.location.origin
              );
            }
            window.close();
          } else {
            const result = await signIn("credentials", {
              token: data.token,
              redirect: false,
              callbackUrl: "/",
            });

            if (result?.ok) {
              window.location.href = result.url || "/";
            } else {
              setStatus("error");
              setErrorMessage(result?.error || "Sign in failed after OAuth");
            }
          }
          return;
        }

        if (data.error) {
          setStatus("error");
          setErrorMessage(data.error);
          return;
        }

        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          setStatus("timeout");
          return;
        }

        timeoutId = setTimeout(poll, 2000);
      } catch (err: any) {
        setStatus("error");
        setErrorMessage(err.message);
      }
    }

    timeoutId = setTimeout(poll, 500);
    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md text-center space-y-4">
        <h1 className="text-3xl font-bold text-orange-500">Guardarr</h1>

        {status === "polling" && (
          <>
            <p className="text-slate-300 text-lg">Completing Plex authentication...</p>
            <p className="text-slate-500 text-sm">Please wait while we verify your sign-in.</p>
            <div className="flex justify-center">
              <div className="h-8 w-8 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
            </div>
          </>
        )}

        {status === "success" && (
          <p className="text-green-400 text-lg">Authentication successful! Redirecting...</p>
        )}

        {status === "timeout" && (
          <>
            <p className="text-red-400 text-lg">Authentication timed out</p>
            <p className="text-slate-500 text-sm">The sign-in window was not completed in time.</p>
            <a href="/login" className="text-orange-400 hover:underline text-sm">
              Return to login
            </a>
          </>
        )}

        {status === "error" && (
          <>
            <p className="text-red-400 text-lg">Authentication failed</p>
            {errorMessage && (
              <p className="text-slate-500 text-sm font-mono">{errorMessage}</p>
            )}
            <a href="/login" className="text-orange-400 hover:underline text-sm">
              Return to login
            </a>
          </>
        )}
      </div>
    </div>
  );
}
