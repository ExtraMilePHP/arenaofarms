import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  copySessionThemes,
  isCopySession,
} from "../../functions/copySessionThemes";
import "./copySession.css";

/**
 * Standalone page for other games / hosts to sync duplicate-session themes.
 *
 * Query params:
 *   sessionId          – NEW (duplicate) session id (required)
 *   organizationId     – org id (required)
 *   originalSessionId  – source session to copy themes from (required if isCopy)
 *   isCopy             – optional; if "false", page skips copy and redirects
 *   redirect           – where to go after success (default "/")
 *   backendUrl         – optional override for REACT_APP_BACKEND_URL
 *
 * Example:
 *   /copy-session?sessionId=NEW&organizationId=ORG&originalSessionId=ORIG&redirect=/login
 */
function CopySession() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Syncing session themes…");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const sessionId = searchParams.get("sessionId")?.trim();
      const organizationId = searchParams.get("organizationId")?.trim();
      const originalSessionId = searchParams.get("originalSessionId")?.trim();
      const redirect = searchParams.get("redirect") || "/";
      const backendUrl = searchParams.get("backendUrl") || undefined;
      const isCopyParam = searchParams.get("isCopy");

      if (isCopyParam != null && !isCopySession(isCopyParam)) {
        if (!cancelled) {
          setStatus("skipped");
          setMessage("Not a copy session; redirecting…");
          setTimeout(() => {
            window.location.href = redirect;
          }, 400);
        }
        return;
      }

      if (!sessionId || !organizationId || !originalSessionId) {
        if (!cancelled) {
          setStatus("error");
          setMessage(
            "Missing sessionId, organizationId, or originalSessionId"
          );
        }
        return;
      }

      try {
        const result = await copySessionThemes({
          sessionId,
          organizationId,
          originalSessionId,
          backendUrl,
        });

        if (cancelled) return;

        setStatus("succeeded");
        setMessage(
          result.copied
            ? `Copied ${result.themesCopied} themes (${result.dataCopied} fields)`
            : result.message || "Nothing to copy"
        );

        setTimeout(() => {
          if (redirect.startsWith("http")) {
            window.location.href = redirect;
          } else {
            navigate(redirect, { replace: true });
          }
        }, 600);
      } catch (err) {
        if (cancelled) return;
        console.error("CopySession:", err);
        setStatus("error");
        setMessage(err?.message || "Failed to copy session themes");
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [searchParams, navigate]);

  return (
    <div className="copy-session-page">
      <div className="copy-session-card">
        <div className="copy-session-loader" aria-hidden="true" />
        <p className="copy-session-title">
          {status === "error" ? "Sync failed" : "Duplicate session sync"}
        </p>
        <p className="copy-session-message">{message}</p>
        {status === "error" && (
          <button
            type="button"
            className="copy-session-retry"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export default CopySession;
