// The plate pane's contract: the reply it reads and the state it draws from.

/** One row of a plate, as the board's recall answers it for the plate view. */
export type PlateRow = {
  /** The item's number: what a person says, and what the AI marks done. */
  id: number
  /** The item's name, else its summary, as its writer wrote it. */
  title: string
  /** Why it sits where it does: late, today, tomorrow, started, due, waiting, handed. */
  why: string
  due?: string
  due_suggested?: boolean
  days_late?: number
  /** On whom or what a waiting row waits: a member's number, or words. */
  on?: string | number
  since?: string
  since_days?: number
  waiting_suggested?: boolean
  doer_suggested?: boolean
  /** The writer, when it is not the person whose plate this is. */
  from?: number
}

/** How many items each group holds in all, beyond the rows it lists. */
export type PlateCounts = { now: number; waiting: number; coming: number; later: number }

/** The whole plate reply: the counts, up to five rows a group, and the plain words. */
export type PlateReply = {
  view: 'plate'
  as_of: string
  today: string
  time_zone: string
  counts: PlateCounts
  now: PlateRow[]
  waiting: PlateRow[]
  coming: PlateRow[]
  people: Record<string, string>
  /** The plate in plain words, as a chat shows it; the pane takes its sentence and marks here. */
  plain?: string
}

/** Where one row's done stands: on its way to the AI, taken by the session, or not taken. */
export type PlateAsk = 'sending' | 'sent' | 'unsent'

/** What the pane shows. Unasked until the person asks, and nothing is drawn while it is. */
export type PlateView =
  | { kind: 'unasked' }
  | { kind: 'loading' }
  | { kind: 'absent' }
  | { kind: 'off' }
  | { kind: 'shown'; plate: PlateReply; server: string; named: boolean }
  | { kind: 'failed'; last: PlateReply | null }

declare module 'claude-code' {
  interface PluginState {
    'dazzer-plate': {
      /**
       * What the pane shows. The last plate this session read lives here and nowhere else: held by
       * the host for this session, never written to disk, never shared with another session.
       */
      view: PlateView
      /** Each row's done, by item number, kept until that item leaves the plate. */
      asked: Record<string, PlateAsk>
      /** The connected server the plate was last read from, in this session. */
      board: string | null
    }
  }
}
