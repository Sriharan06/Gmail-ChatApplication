import React, { useState, useEffect } from "react";
import { LogIn, Key, Mail, ShieldCheck, AlertCircle, Sparkles } from "lucide-react";
import { User } from "../types";

interface GoogleSignInProps {
  onLoginSuccess: (user: User) => void;
}

export default function GoogleSignIn({ onLoginSuccess }: GoogleSignInProps) {
  const [mockEmail, setMockEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Retrieve current APP_URL for instructions (fallback if undefined)
  const appBaseUrl = window.location.origin;

  // Listen to popup authentication callbacks (OAUTH_AUTH_SUCCESS / FAILURE)
  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      // Security: verify our origin (either localhost or run.app)
      const origin = event.origin;
      if (!origin.endsWith(".run.app") && !origin.includes("localhost") && !origin.includes("127.0.0.1")) {
        return;
      }

      if (event.data?.type === "OAUTH_AUTH_SUCCESS" && event.data?.user) {
        setLoading(false);
        setInfoMsg(`Auth successful! Welcome, ${event.data.user.name}`);
        setTimeout(() => {
          onLoginSuccess(event.data.user);
        }, 800);
      } else if (event.data?.type === "OAUTH_AUTH_FAILURE") {
        setLoading(false);
        setErrorMsg(event.data.error || "Google Sign-In failed or was aborted by the user.");
      }
    };

    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [onLoginSuccess]);

  const triggerGoogleOAuth = async () => {
    setErrorMsg(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/url");
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Google OAuth client is not fully configured yet on the server.");
      }

      const { url } = await response.json();

      // Open OAuth login in popup
      const width = 520;
      const height = 640;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const authPopup = window.open(
        url,
        "google_oauth_popup",
        `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes`
      );

      if (!authPopup) {
        throw new Error("Pop-up blocker detected! Please allow pop-ups for this site to complete your Google Sign-In.");
      }
    } catch (err: any) {
      setLoading(false);
      setErrorMsg(err.message || "Failed to trigger Google Sign-In.");
    }
  };

  const handleMockSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mockEmail || !mockEmail.includes("@")) {
      setErrorMsg("Please enter a valid Gmail ID (e.g. alice@gmail.com).");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const response = await fetch("/api/auth/mock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: mockEmail }),
      });

      const data = await response.json();
      if (!response.ok || !data.user) {
        throw new Error(data.error || "Dev sandbox login failed.");
      }

      // Success
      setLoading(false);
      onLoginSuccess(data.user);
    } catch (err: any) {
      setLoading(false);
      setErrorMsg(err.message || "Failed to log in.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center p-4">
      {/* Container Card */}
      <div className="w-full max-w-md bg-[#161616] shadow-2xl rounded-3xl border border-white/5 p-8 flex flex-col text-slate-200">
        
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/10 mb-4 animate-pulse">
            <Mail className="w-9 h-9" />
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white">
            Gmail Chat & Calls
          </h2>
          <p className="text-slate-400 mt-2 text-sm max-w-xs mx-auto">
            Connect and start voice or video calls in real-time using secure Gmail accounts.
          </p>
        </div>

        {/* Message Feeds */}
        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-orange-950/20 border border-orange-900 text-orange-300 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div className="mb-4 p-3 rounded-xl bg-blue-950/20 border border-blue-900 text-blue-300 text-xs flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{infoMsg}</span>
          </div>
        )}

        {/* Authentication Modes */}
        <div className="flex flex-col gap-6">
          
          {/* 1. Official OAuth Login */}
          <div>
            <button
              id="google-oauth-btn"
              type="button"
              disabled={loading}
              onClick={triggerGoogleOAuth}
              className="w-full h-12 flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-[#242424] hover:bg-white/5 text-white font-bold shadow-md hover:shadow-lg transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.9h6.6c-.28 1.5-1.12 2.77-2.38 3.63v3.02h3.85c2.25-2.07 3.55-5.12 3.55-8.62z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.97-1.07 7.96-2.92l-3.85-3.02c-1.07.72-2.44 1.15-4.11 1.15-3.17 0-5.85-2.13-6.81-5h-3.98v3.1C3.18 21.3 7.31 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.19 14.23c-.24-.72-.38-1.5-.38-2.3 0-.8.14-1.57.38-2.3V6.53H1.21C.44 8.08 0 9.81 0 11.63c0 1.93.44 3.75 1.21 5.3l3.98-3.1z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.77c1.77 0 3.35.6 4.6 1.8l3.43-3.43C17.96 1.19 15.24 0 12 0 7.31 0 3.18 2.7 1.21 6.53l3.98 3.1c.96-2.87 3.64-5 6.81-5z"
                />
              </svg>
              <span>{loading ? "Connecting..." : "Sign in with Google"}</span>
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <span className="h-[1px] w-full bg-white/5" />
            <span className="text-slate-500 text-xs font-bold shrink-0 uppercase tracking-widest">
              or Dev Sandbox
            </span>
            <span className="h-[1px] w-full bg-white/5" />
          </div>

          {/* 2. Mock Mode for Rapid Testing */}
          <form onSubmit={handleMockSignIn} className="flex flex-col gap-3">
            <p className="text-[11px] text-slate-400 leading-relaxed text-center">
              Enter any Gmail to start instantly in **Dev Sandbox Mode**. 
              You can open a 2nd tab/window with another email to text or video-call directly!
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mock-email" className="text-xs font-bold text-slate-400">
                Sandbox Gmail address:
              </label>
              <div className="relative">
                <input
                  id="mock-email"
                  type="email"
                  disabled={loading}
                  value={mockEmail}
                  onChange={(e) => setMockEmail(e.target.value)}
                  placeholder="e.g. alice@gmail.com"
                  className="w-full h-11 px-4 pl-10 rounded-xl border border-white/5 bg-[#242424] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm font-medium"
                  required
                />
                <Key className="w-4.5 h-4.5 text-slate-500 absolute left-3.5 top-3.5" />
              </div>
            </div>

            <button
              id="mock-signin-btn"
              type="submit"
              disabled={loading}
              className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all text-white font-bold cursor-pointer shadow-md shadow-blue-500/10 text-sm"
            >
              <LogIn className="w-4 h-4" />
              <span>{loading ? "Entering..." : "Launch Sandbox Client"}</span>
            </button>
          </form>

        </div>

        {/* Setup documentation */}
        <div className="mt-8 pt-6 border-t border-white/5 flex flex-col gap-3.5">
          <div className="flex items-center gap-2 text-blue-400">
            <Sparkles className="w-4 h-4 shrink-0" />
            <span className="text-xs font-extrabold uppercase tracking-wide">
              OAuth Setup Guide for Production
            </span>
          </div>
          
          <ul className="text-[11px] text-slate-400 flex flex-col gap-2">
            <li>
              1. Register a project in the <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300 font-semibold">Google Cloud Console</a>.
            </li>
            <li className="break-all leading-normal bg-[#242424] border border-white/5 p-2 rounded-lg text-slate-300">
              2. Add this exact Authorized Redirect URI: <br/>
              <strong className="text-white text-xs font-mono select-all">
                {appBaseUrl}/auth/callback
              </strong>
            </li>
            <li>
              3. Set secrets in **AI Studio Build** Settings:
              <span className="block mt-1 font-mono text-slate-300">
                - GOOGLE_CLIENT_ID <br/>
                - GOOGLE_CLIENT_SECRET
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
