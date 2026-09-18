"use client"

import * as React from "react"

import { useSignInPrompt } from "@/components/auth/viewer-provider"
import type { ReminderActionResult } from "@/lib/data/user-state-actions"
import type { MatchStatus, WatchlistEntryView, WatchlistReminder } from "@/lib/data/types"
import { isReminderAvailable } from "@/lib/reminders"

/**
 * Client cache of the current user's watchlist reminders, layered on the
 * watchlist id store: the id store says *whether* a match is saved, this one
 * says *when* to remind. Seeded from the database on every server render and
 * re-synced whenever the server sends fresh entries (a refresh, a navigation,
 * or the revalidation a server action triggers). Changes apply optimistically
 * and roll back if the action reports a rule violation.
 */

export type ReminderEntry = WatchlistEntryView

type Store = {
  entries: ReadonlyMap<string, ReminderEntry>
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => ReadonlyMap<string, ReminderEntry>
  reset: (entries: ReminderEntry[]) => void
  set: (entry: ReminderEntry) => void
}

function createStore(initial: ReminderEntry[]): Store {
  let entries: ReadonlyMap<string, ReminderEntry> = new Map(initial.map((entry) => [entry.matchId, entry]))
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((listener) => listener())
  return {
    get entries() {
      return entries
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => entries,
    reset(next) {
      entries = new Map(next.map((entry) => [entry.matchId, entry]))
      emit()
    },
    set(entry) {
      const next = new Map(entries)
      next.set(entry.matchId, entry)
      entries = next
      emit()
    },
  }
}

function sameEntries(current: ReadonlyMap<string, ReminderEntry>, next: ReminderEntry[]): boolean {
  if (current.size !== next.length) return false
  return next.every((entry) => {
    const existing = current.get(entry.matchId)
    return existing !== undefined && existing.reminder === entry.reminder && existing.status === entry.status && existing.startsAt === entry.startsAt
  })
}

/** Persists one reminder change on the server. */
export type PersistReminder = (matchId: string, reminder: WatchlistReminder) => Promise<ReminderActionResult>

type ContextValue = {
  store: Store
  change: (entry: ReminderEntry) => Promise<ReminderActionResult>
}

const Context = React.createContext<ContextValue | null>(null)

type WatchlistRemindersProviderProps = {
  initialEntries: ReminderEntry[]
  persist?: PersistReminder
  /** True for an anonymous visitor: a change prompts sign-in instead of touching the store. */
  readOnly?: boolean
  children: React.ReactNode
}

export function WatchlistRemindersProvider({ initialEntries, persist, readOnly = false, children }: WatchlistRemindersProviderProps) {
  const [store] = React.useState(() => createStore(initialEntries))
  const persistRef = React.useRef(persist)
  const promptSignIn = useSignInPrompt()

  React.useEffect(() => {
    persistRef.current = persist
  }, [persist])

  React.useEffect(() => {
    if (!sameEntries(store.getSnapshot(), initialEntries)) store.reset(initialEntries)
  }, [initialEntries, store])

  const value = React.useMemo<ContextValue>(
    () => ({
      store,
      async change(entry) {
        if (readOnly) {
          promptSignIn()
          return { ok: false, error: "Sign in to set reminders." }
        }
        const previous = store.getSnapshot().get(entry.matchId)
        store.set(entry)
        const save = persistRef.current
        if (!save) return { ok: true, reminder: entry.reminder }
        try {
          const result = await save(entry.matchId, entry.reminder)
          if (!result.ok) {
            // Never leave the UI showing a preference the database refused.
            store.set(previous ?? { ...entry, reminder: "off" })
          }
          return result
        } catch (error) {
          store.set(previous ?? { ...entry, reminder: "off" })
          console.error(`Could not save the reminder for "${entry.matchId}".`, error)
          return { ok: false, error: "Could not save the reminder. Try again." }
        }
      },
    }),
    [store, readOnly, promptSignIn]
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}

/** All reminder entries, keyed by match id. Re-renders on every change. */
export function useWatchlistReminders() {
  const context = React.useContext(Context)
  if (!context) throw new Error("useWatchlistReminders must be used within a WatchlistRemindersProvider.")
  const entries = React.useSyncExternalStore(context.store.subscribe, context.store.getSnapshot, context.store.getSnapshot)
  return { entries, change: context.change }
}

export type MatchReminderState = {
  /** The stored preference, "off" when the match is not saved. */
  reminder: WatchlistReminder
  /** Whether a reminder can be chosen: saved and not started. */
  available: boolean
  /** Why it is not available, for a hint. */
  reason?: "not-watchlisted" | "started" | "finished"
  setReminder: (reminder: WatchlistReminder) => Promise<ReminderActionResult>
}

/**
 * Reminder state for one match. The caller supplies the match facts it
 * already has so a freshly saved match can take a reminder before the next
 * server sync fills the entry in.
 */
export function useMatchReminder(
  match: { id: string; title: string; startsAt: string; status: MatchStatus; leagueShortName: string; sport: WatchlistEntryView["sport"] },
  watchlisted: boolean
): MatchReminderState {
  const { entries, change } = useWatchlistReminders()
  const entry = entries.get(match.id)
  const reminder = watchlisted ? (entry?.reminder ?? "off") : "off"
  const status = entry?.status ?? match.status
  const available = watchlisted && isReminderAvailable(status)
  // A started or finished match can never take a reminder, so say that first; "add to Watchlist" would be a false promise.
  const reason = status === "live" ? "started" : status === "finished" ? "finished" : !watchlisted ? "not-watchlisted" : undefined
  const setReminder = React.useCallback(
    (next: WatchlistReminder) =>
      change({
        matchId: match.id,
        reminder: next,
        title: match.title,
        startsAt: match.startsAt,
        status: match.status,
        leagueShortName: match.leagueShortName,
        sport: match.sport,
      }),
    [change, match.id, match.title, match.startsAt, match.status, match.leagueShortName, match.sport]
  )
  return { reminder, available, reason, setReminder }
}
