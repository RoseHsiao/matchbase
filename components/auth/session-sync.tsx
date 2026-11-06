"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

/**
 * Keeps the shell's idea of who is viewing in step with the session. A client
 * navigation re-renders only the changed page, not the shared app layout, so
 * without this a tab whose session ended elsewhere would keep the signed-in
 * shell around the demo catalogue the server now sends it (and the demo shell
 * around real data, the other way round). The data is always right; the server
 * decides it per request. This corrects the frame around it.
 *
 * Sign-in and sign-out in this browser announce themselves, so other visible
 * tabs refresh at once. A session that ended some other way (expiry, a password
 * reset on another device) is picked up when the tab next regains focus, at
 * most once a minute, because each refresh is a server render.
 *
 * Nothing here polls, and a hidden tab makes no request: told of a change, it
 * waits and refreshes when shown. A tab ignores its own announcement, since the
 * sign-in or sign-out that made it already refreshes that tab.
 */

const AUTH_CHANNEL = "matchbase-auth"
const FOCUS_REFRESH_INTERVAL_MS = 60_000
const THIS_TAB = Math.random().toString(36).slice(2)

/** Tells this browser's other tabs that the session changed. */
export function announceAuthChange(): void {
  if (typeof BroadcastChannel === "undefined") return
  const channel = new BroadcastChannel(AUTH_CHANNEL)
  channel.postMessage(THIS_TAB)
  channel.close()
}

export function SessionSync() {
  const router = useRouter()

  React.useEffect(() => {
    let lastRefresh = Date.now()
    let sessionChanged = false
    const isVisible = () => document.visibilityState === "visible"
    const refresh = () => {
      lastRefresh = Date.now()
      sessionChanged = false
      router.refresh()
    }
    const onSessionChange = (event: MessageEvent) => {
      if (event.data === THIS_TAB) return
      if (isVisible()) refresh()
      else sessionChanged = true
    }
    const onReturn = () => {
      if (isVisible() && (sessionChanged || Date.now() - lastRefresh >= FOCUS_REFRESH_INTERVAL_MS)) refresh()
    }

    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(AUTH_CHANNEL)
    if (channel) channel.onmessage = onSessionChange
    window.addEventListener("focus", onReturn)
    document.addEventListener("visibilitychange", onReturn)
    return () => {
      channel?.close()
      window.removeEventListener("focus", onReturn)
      document.removeEventListener("visibilitychange", onReturn)
    }
  }, [router])

  return null
}
