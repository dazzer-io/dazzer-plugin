// The plate pane's contract: the reply it reads and the state it draws from.

/**
 * What an item is part of: its readable parent, by number and name, or, for work not filed yet,
 * no number and no name, only the mark.
 */
export type PlatePart =
  | { id: number; name: string | null; unfiled?: undefined }
  | { id: null; name: null; unfiled: true }

/** One row of a plate, as the board's recall answers it for the plate view. */
export type PlateRow = {
  /** The item's number: what a person says, and what the AI marks done. */
  id: number
  /** The item's name, else its summary, as its writer wrote it. */
  title: string
  /** Why it sits where it does: late, today, tomorrow, waiting_on_you, started, due, waiting, handed. */
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
  /** What it is part of; absent when it has no parent the person can read (and from today's server). */
  part?: PlatePart
  /** The calendar day it last moved (YYYY-MM-DD), in the reply's zone; absent from today's server. */
  moved?: string
  /** A line of what it is, beyond its title; absent when the title already says it. */
  about?: string
}

/** One later group: a readable parent, the unfiled group, or the group of items part of nothing. */
export type PlateLaterGroup = {
  id: number | null
  name: string | null
  unfiled?: boolean
  count: number
}

/** One row of a later group read: what it is and the day it last moved. */
export type PlateLaterRow = { id: number; title: string; moved?: string }

/** How many items each group holds in all, beyond the rows it lists. */
export type PlateCounts = { now: number; waiting: number; coming: number; later: number }

/**
 * The whole plate reply: the counts, the rows each group lists, and the plain words. A later
 * group read is the same reply with the active groups empty and `later` holding that group's rows.
 */
export type PlateReply = {
  view: 'plate'
  as_of: string
  today: string
  time_zone: string
  counts: PlateCounts
  now: PlateRow[]
  waiting: PlateRow[]
  coming: PlateRow[]
  /** The later items by what each belongs to, the largest 30; absent from today's server. */
  later_groups?: PlateLaterGroup[]
  /** How many later groups there are beyond those listed. */
  later_groups_more?: number
  /** A later group read's rows; absent on a plate look. */
  later?: PlateLaterRow[]
  people: Record<string, string>
  /** The plate in plain words, as a chat shows it. The pane draws nothing from it. */
  plain?: string
}

/** Where one row's done, or its talk, stands: on its way to the AI, taken by the session, or not taken. */
export type PlateAsk = 'sending' | 'sent' | 'unsent'

/** The tabs, one per group. */
export type PlateTab = 'now' | 'waiting' | 'coming' | 'later'

/**
 * The one question the pane may have put to the person's AI, when the engine refused the pane its
 * own read: none, on its way, or taken by the session and waiting for its turn (`turnId` once that
 * turn has started). `group` names the later group it asks for; absent, it asks for the plate.
 * `behind` is the main-loop turn that was running when it was put, which it queued behind.
 */
export type PlateQuestion =
  | { state: 'none' }
  | { state: 'sending' | 'waiting'; text: string; turnId: string | null; group?: string; behind?: string }

/**
 * What one later group shows once opened. Its rows, once read, are kept for the session. `held`
 * means its read was refused while another question was out, so nothing was sent.
 */
export type PlateGroupView =
  | { kind: 'loading' }
  | { kind: 'rows'; rows: PlateLaterRow[]; count: number }
  | { kind: 'asking' }
  | { kind: 'asked' }
  | { kind: 'held' }
  | { kind: 'unanswered' }
  | { kind: 'unsent' }
  | { kind: 'blocked' }
  | { kind: 'failed' }

/** What the pane shows. Unasked until the person asks, and nothing is drawn while it is. */
export type PlateView =
  | { kind: 'unasked' }
  | { kind: 'loading' }
  | { kind: 'asking'; last: PlateReply | null }
  | { kind: 'asked'; last: PlateReply | null }
  | { kind: 'unanswered'; last: PlateReply | null }
  | { kind: 'unsent'; last: PlateReply | null }
  | { kind: 'blocked'; last: PlateReply | null }
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
      /** Each row's talk about it, by item number, until a plate arrives again. */
      talks: Record<string, PlateAsk>
      /** The servers offering both recall and track, as the latest read found them. */
      boards: string[]
      /** The server the plate shown came from: the one a later group is read from. */
      source: string | null
      /** The one question to the person's AI, while there is one. */
      question: PlateQuestion
      /**
       * Whether the engine has refused the pane its own read in this session. A read the person
       * starts still tries the board every time; one a track starts does not, so refusals never
       * pile up in a busy session.
       */
      refusedHere: boolean
      /** The main loop's turn running now, if any. */
      runningTurn: string | null
      /** The tab chosen. */
      tab: PlateTab
      /** The one card open, by item number. */
      openCard: number | null
      /** The one later group open, by its key: its number, `unfiled` or `none`. */
      openGroup: string | null
      /** Each later group opened this session, by its key. */
      groups: Record<string, PlateGroupView>
      /** A plate read the person started was refused while a group's question was out. */
      plateHeld: boolean
    }
  }
}
