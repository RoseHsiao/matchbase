"use client";

/**
 * Last-resort boundary for errors thrown by the root layout itself. Renders
 * its own html and body without any application code or styling, so it
 * cannot fail the same way twice.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>MatchBase could not load</h1>
        <p style={{ color: "#666", marginBottom: "1rem" }}>{error.digest ? `Reference: ${error.digest}` : "Please try again in a moment."}</p>
        <button type="button" onClick={reset} style={{ padding: "0.5rem 1rem", cursor: "pointer" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
