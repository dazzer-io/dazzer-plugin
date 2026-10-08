// The plate pane: a person's plate from their Dazzer board, drawn beside the chat when they ask.
//
// WHEN IT DRAWS. Only once the person asks: /plate, or the pane's own refresh once it is open.
// Nothing here opens a pane, reads the board or sets a status line from the session's start, a
// timer or anything the AI does on its own; until the person asks, the pane's state is "unasked"
// and it draws nothing. It only notes which main-loop turn is running, so that a question it puts
// later is never ended by the turn it was queued behind.
//
// WHAT IT DRAWS (the design approved on 8 Oct, parts/where-it-shows.md section 8). The day and one
// line of counts; four tabs, one per group, the chosen one the primary button; a bordered card per
// row, lit on hover, with a coloured tag read from the row's own fields (never from the plain
// words), its title, and one dim line of what it is part of, who it is from and when it last
// moved. A card opens in place to what it is, Done and Talk about it. Later is its groups, each
// opening to its items' titles and when each last moved. An answer from a board without those
// fields (no part, moved, about or later groups) still draws every tag, and later as a count.
//
// HOW IT READS. It holds no connection and no credentials. It finds the board among the tools the
// session has connected now: a server offering both `recall` and `track`, so the person's words,
// zone and conversation name never go to a server that is not a board. It calls that server's
// `recall` for the plate view through the session's own connection (`$.mcp.call`); the first whose
// answer holds a plate is the board. Opening a later group reads that group (`part`) from the board
// the plate came from, the same way. Every read ends within 20 seconds, in what it read or in one
// failed line, never in an endless "Reading".
//
// WHERE THE ENGINE WILL NOT LET IT. In auto mode the engine's classifier refuses the pane's own
// call (seen live in the Desktop app). Only for a read the person started (/plate, Refresh, or
// opening a later group), and only when the auto mode classifier refused it, the pane puts one
// question to the person's AI, as the person's own words: "What is on my plate? My time zone is
// <the machine's zone>." for the plate, "Show my later items in plate group <part>." for a group.
// When the AI's own recall returns that plate or that group, the pane draws it. One question
// at a time, across the plate and its groups: while one is unanswered, every read the person starts
// still tries the board and sends nothing more, and the pane says it waits on the AI. The question
// ends with its own turn, or failing that the first turn to end after the session took it; if
// nothing came, the pane says so. Put while another turn is running, it waits behind that turn:
// that turn's end does not end it. The turn opening with its own words is its turn; a turn opening
// with other words may be it reworded, or a turn queued ahead of it (a message the person typed, a
// task notification), so it holds the question only tentatively, and the question ends after such
// a turn only once no turn has started for 10 seconds. A question that never runs (its queued turn
// cancelled) is lost once the session has been idle for 10 seconds since the turn it waited
// behind: the person's next press may ask again. Any other refusal of the engine's (a deny rule, don't-ask mode, a
// hook) is not cured by asking: the pane says Claude Code does not let it read here, and asks
// nothing. Every read the person starts tries the board first, so a change of mode takes effect at
// once.
//
// WHAT NEVER POSTS. Nothing but the person's own presses ever submits anything in their name:
// /plate and Refresh (the plate's question), opening a later group (its question), and a card's
// Done and Talk about it. The AI's track (a subagent's included), its own reads, a timer and the
// session's start never do. After the AI's own call to the board, the pane only reads the board
// again itself, and not at all once the engine has refused it in this session (so refusals never
// pile up), nor while a read the person started is still on its way; refused, it keeps what it
// shows and asks no one.
//
// WHO WRITES. Never this pane. A card's Done sends the person's AI one sentence carrying the item's
// number and nothing else ("Mark item 7236 done."); Talk about it sends "Tell me about item 7236.".
// The AI acts through its own connection. A title never travels with either, nor a group's name
// with its question: anyone in the workspace can write those, and these sentences speak as the
// person. A press counts as sent
// only once the session took that sentence; a sent Done stays sent until a plate arrives without
// that item.
//
// WHAT IT KEEPS. The last plate this session read, and each later group it read, in the session's
// own state (`$.state`), so a failed read can still show the plate with its time and a group opened
// again is not read again: until the next Refresh, which forgets every group's rows, or a plate
// arriving with that group's count changed. Nothing is written to disk and nothing is shared with another session,
// so a failed read never shows anyone else's plate.
//
// WHOSE WORDS. Titles, what a row is, the names of what it is part of, and the members it names
// are other people's words: each passes through the same one neutralising pass the board applies,
// and is only ever plain text, never a link or a control.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, McpToolResult, Register, ToolCallResult, ToolInfo } from 'claude-code'

import type {
  PlateAsk,
  PlateCounts,
  PlateGroupView,
  PlateLaterGroup,
  PlateLaterRow,
  PlatePart,
  PlateQuestion,
  PlateReply,
  PlateRow,
  PlateTab,
  PlateView,
} from '../types'

/** The one pane, by id and title. */
const PANE = 'plate'
const TITLE = 'Your plate'
/** What the pane asks the board, in the person's own words, and the conversation it names. */
const WORDS = 'what is on my plate'
const GROUP_WORDS = 'what can wait until later'
const CONVERSATION = 'plate-pane'
/** How long one read may take before the pane says it could not reach Dazzer. */
const READ_LIMIT_MS = 20_000
/**
 * How long with no turn starting before a question that is not running counts as not going to: one
 * held only tentatively by a turn that has ended, or one queued behind a turn that has ended.
 */
const QUIET_MS = 10_000
/** A connected server's recall tool, as the session names it. */
const RECALL = /^mcp__(.+)__recall$/
const BACKSLASH = '\x5c'
/** Between the pieces of one line: the counts, a tag's parts. */
const DOT = ' \u{b7} '

/**
 * The engine's own words when it refuses a call (read from Claude Code 2.1.293 itself). Nothing a
 * server says matches these, so a server's "Access denied" stays a failure to reach the board.
 * The auto mode classifier's refusal is the one the person's own request cures: only it asks the
 * AI. The engine's other refusals (a deny rule, don't-ask mode, a hook) are not, and ask nothing.
 */
const CLASSIFIER_REFUSAL = /auto mode classifier/i
const ENGINE_REFUSALS = [
  /\bPermission for this (?:action|tool use) (?:was|has been) denied\b/,
  /\bPermission to use \S+ has been denied\b/,
  /\bPermission denied by (?:PermissionRequest )?hook\b/,
]

/** The tabs, in the order a person reads them, named by what they ask of the person. */
const TABS: readonly { key: PlateTab; name: string }[] = [
  { key: 'now', name: 'Needs you' },
  { key: 'waiting', name: 'Waiting' },
  { key: 'coming', name: 'Coming up' },
  { key: 'later', name: 'Later' },
]
const ACTIVE = ['now', 'waiting', 'coming'] as const

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The line that says how to connect, as the README's connection step says it. */
const CONNECT =
  'To connect it, type /plugin install dazzer-connect@dazzer in Claude Code in a terminal, then restart and sign in. Already connected? Try Refresh.'

const view = atom({ plugin: 'dazzer-plate', key: 'view' } as const, { kind: 'unasked' } as PlateView)
const asked = atom({ plugin: 'dazzer-plate', key: 'asked' } as const, {} as Record<string, PlateAsk>)
const talks = atom({ plugin: 'dazzer-plate', key: 'talks' } as const, {} as Record<string, PlateAsk>)
const boards = atom({ plugin: 'dazzer-plate', key: 'boards' } as const, [] as string[])
const source = atom({ plugin: 'dazzer-plate', key: 'source' } as const, null as string | null)
const question = atom({ plugin: 'dazzer-plate', key: 'question' } as const, { state: 'none' } as PlateQuestion)
const refusedHere = atom({ plugin: 'dazzer-plate', key: 'refusedHere' } as const, false)
const runningTurn = atom({ plugin: 'dazzer-plate', key: 'runningTurn' } as const, null as string | null)
const tab = atom({ plugin: 'dazzer-plate', key: 'tab' } as const, 'now' as PlateTab)
const openCard = atom({ plugin: 'dazzer-plate', key: 'openCard' } as const, null as number | null)
const openGroup = atom({ plugin: 'dazzer-plate', key: 'openGroup' } as const, null as string | null)
const groups = atom({ plugin: 'dazzer-plate', key: 'groups' } as const, {} as Record<string, PlateGroupView>)
const plateHeld = atom({ plugin: 'dazzer-plate', key: 'plateHeld' } as const, false)

/** The newest plate read; an older one that answers late changes nothing. */
let newestRead = 0
/** Plate reads the person started that are still on their way; a track's read never overtakes one. */
let personReads = 0
/** The newest read of each later group, by its key; an older one that answers late changes nothing. */
const newestGroupRead = new Map<string, number>()
let groupReadsMade = 0
/** Main-loop turns started this session, so a later check can tell whether one has started since. */
let turnsStarted = 0
/** Questions put this session: each question's own number. */
let questionsPut = 0

/** The line the pane shows when the engine refuses it in a way asking cannot cure. */
const NOT_ALLOWED = 'Claude Code does not let the pane read your plate here.'

/**
 * The board's one neutralising pass on someone else's words (its `neutralizeText`): a broken
 * character half becomes the replacement character, a line break or control character a space, a
 * direction override or hidden tag character goes, and a backtick becomes an apostrophe. A title
 * can bend its own row and nothing more.
 */
function neutral(value: string): string {
  return value
    .replace(/[\u{d800}-\u{dfff}]/gu, '\u{fffd}')
    .replace(/[\x00-\x1f\x7f-\x9f\u{2028}\u{2029}]/gu, ' ')
    .replace(/[\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu, '')
    .replace(/[\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu, '')
    .replace(/`/g, "'")
}

/** Someone else's words on one line: neutralised, every run of spaces one space, trimmed. */
const oneLine = (value: string) => neutral(value).replace(/\s+/g, ' ').trim()

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
/** A string with something in it, else nothing. */
const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

/** The machine's own time zone, so the board counts the person's own day; none when unknown. */
function machineZone(): string | undefined {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return typeof zone === 'string' && zone.length > 0 ? zone : undefined
}

/** The question the pane puts to the person's AI for the plate, in the person's own words. */
function theQuestion(): string {
  const zone = machineZone()
  return zone === undefined ? 'What is on my plate?' : `What is on my plate? My time zone is ${zone}.`
}

/** The servers offering both recall and track, each once, in the order the session lists them. */
function boardsAmong(tools: readonly ToolInfo[]): string[] {
  const names = new Set(tools.filter(tool => tool.mcp).map(tool => tool.name))
  const found: string[] = []
  for (const name of names) {
    const server = RECALL.exec(name)?.[1]
    if (server !== undefined && names.has(`mcp__${server}__track`) && !found.includes(server)) found.push(server)
  }
  return found
}

const isRow = (row: unknown): row is PlateRow =>
  row !== null &&
  typeof row === 'object' &&
  typeof (row as PlateRow).id === 'number' &&
  typeof (row as PlateRow).title === 'string'

const isLaterRow = (row: unknown): row is PlateLaterRow =>
  row !== null &&
  typeof row === 'object' &&
  typeof (row as PlateLaterRow).id === 'number' &&
  typeof (row as PlateLaterRow).title === 'string'

/** What a row is part of, when the reply says so in a shape the pane can read. */
function partOf(value: unknown): PlatePart | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const part = value as { id?: unknown; name?: unknown; unfiled?: unknown }
  // What is not filed yet has no number and no name: known by its mark, read first.
  if (part.unfiled === true) return { id: null, name: null, unfiled: true }
  if (!isNumber(part.id)) return undefined
  const name = textOf(part.name)
  return name === undefined ? undefined : { id: part.id, name }
}

/** One later group, when the reply says it in a shape the pane can read. */
function laterGroupOf(value: unknown): PlateLaterGroup | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const group = value as Partial<PlateLaterGroup>
  if (!isNumber(group.count) || group.count < 0) return undefined
  if (group.unfiled === true) return { id: null, name: null, unfiled: true, count: group.count }
  if (group.id === null) return { id: null, name: null, count: group.count }
  if (!isNumber(group.id)) return undefined
  return { id: group.id, name: textOf(group.name) ?? null, count: group.count }
}

/** A later group's key: its number, `unfiled`, or `none`; what `part` asks the board for. */
const keyOf = (group: PlateLaterGroup) => (group.unfiled === true ? 'unfiled' : group.id === null ? 'none' : String(group.id))
const partOfKey = (key: string): number | string => (key === 'unfiled' || key === 'none' ? key : Number(key))

/** The key of the group a call asked for by `part`, as recall reads it; none when unreadable. */
function keyOfAsked(part: unknown): string | undefined {
  if (isNumber(part)) return String(part)
  if (typeof part !== 'string') return undefined
  const word = part.trim().toLowerCase()
  if (word === 'unfiled' || word === 'none') return word
  return /^\d{1,15}$/.test(word) ? String(Number(word)) : undefined
}

/** A later group's name as the pane shows it. Its question never carries it. */
function groupName(group: PlateLaterGroup): string {
  if (group.unfiled === true) return 'Not filed yet'
  if (group.id === null) return 'Not part of anything'
  return group.name === null ? 'No name' : oneLine(group.name)
}

/**
 * The question for one later group, in the person's own words: its number, `unfiled` or `none`,
 * and nothing anyone else wrote. A group's name is someone else's words, as a title is.
 */
const groupQuestion = (group: PlateLaterGroup) => `Show my later items in plate group ${keyOf(group)}.`

/** What a plate-view reply holds: a plate look, or the read of one later group. */
type Answer =
  | { kind: 'plate'; plate: PlateReply }
  | { kind: 'group'; key: string | undefined; rows: PlateLaterRow[]; count: number }

/** What a value answers, rows that are not rows left out; undefined when it is no plate reply. */
function answerOf(body: unknown): Answer | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const plate = body as Partial<PlateReply>
  const counts = plate.counts as Record<string, unknown> | undefined
  const isPlate =
    plate.view === 'plate' &&
    counts !== undefined &&
    counts !== null &&
    ['now', 'waiting', 'coming', 'later'].every(key => typeof counts[key] === 'number') &&
    Array.isArray(plate.now) &&
    Array.isArray(plate.waiting) &&
    Array.isArray(plate.coming)
  if (!isPlate) return undefined
  const whole = plate as PlateReply
  const listed = Array.isArray(whole.later_groups)
    ? whole.later_groups.map(laterGroupOf).filter((group): group is PlateLaterGroup => group !== undefined)
    : undefined
  if (Array.isArray(whole.later)) {
    const rows = whole.later.filter(isLaterRow)
    const group = listed?.[0]
    return { kind: 'group', key: group === undefined ? undefined : keyOf(group), rows, count: group?.count ?? rows.length }
  }
  const people = whole.people !== null && typeof whole.people === 'object' ? whole.people : {}
  return {
    kind: 'plate',
    plate: {
      ...whole,
      now: whole.now.filter(isRow),
      waiting: whole.waiting.filter(isRow),
      coming: whole.coming.filter(isRow),
      people,
      // Absent from today's server: later is then a count, with no groups to open.
      later_groups: listed,
    },
  }
}

/**
 * Every JSON object written at the top level of a text, in order, whatever lies between them:
 * how the AI's own reply reads once its blocks are joined.
 */
function objectsIn(text: string): unknown[] {
  const found: unknown[] = []
  let depth = 0
  let start = -1
  let isInString = false
  let isEscaped = false
  for (let at = 0; at < text.length; at++) {
    const char = text[at]
    if (isInString) {
      if (isEscaped) isEscaped = false
      else if (char === BACKSLASH) isEscaped = true
      else if (char === '"') isInString = false
      continue
    }
    if (char === '"' && depth > 0) isInString = true
    else if (char === '{') {
      if (depth === 0) start = at
      depth += 1
    } else if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0) {
        try {
          found.push(JSON.parse(text.slice(start, at + 1)))
        } catch {
          // Not JSON after all; the next object may be.
        }
      }
    }
  }
  return found
}

/** The first plate reply among some texts, each read on its own. */
function answerAmong(texts: readonly string[]): Answer | undefined {
  for (const text of texts) {
    for (const body of objectsIn(text)) {
      const answer = answerOf(body)
      if (answer !== undefined) return answer
    }
  }
  return undefined
}

/** A reply's text blocks, each as its own text. */
const blocksOf = (result: McpToolResult): string[] =>
  result.content.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))

/** The plate reply in the AI's own recall: the reply as it read it, else the reply's blocks. */
function answerInCall(ran: ToolCallResult): Answer | undefined {
  if (ran.deny !== undefined || ran.isError === true) return undefined
  const fromText = typeof ran.text === 'string' ? answerAmong([ran.text]) : undefined
  if (fromText !== undefined) return fromText
  const result = ran.result as Partial<McpToolResult> | undefined
  return Array.isArray(result?.content) ? answerAmong(blocksOf(result as McpToolResult)) : undefined
}

/**
 * Whether a refusal names the plate: the plate view refused, or the plate not switched on. The
 * plate as a word of its own, since a refused call's words carry this plugin's name too.
 */
const namesThePlate = (words: string) => /(^|[^\w-])plate\b/i.test(words)

/**
 * How the engine refused a call that threw, in its own words: by the auto mode classifier, which
 * the person's own request cures; otherwise, which it does not; or not at all.
 */
function refusalOf(words: string): 'classifier' | 'engine' | undefined {
  if (CLASSIFIER_REFUSAL.test(words)) return 'classifier'
  return ENGINE_REFUSALS.some(pattern => pattern.test(words)) ? 'engine' : undefined
}

/** When a plate was read, as a person reads a time: "as of Wed 7 Oct 09:12". */
function asOf(at: string): string | undefined {
  const time = Date.parse(at)
  if (Number.isNaN(time)) return undefined
  const zone = machineZone()
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(zone === undefined ? {} : { timeZone: zone }),
  }).formatToParts(time)
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `as of ${part('weekday')} ${part('day')} ${part('month')} ${part('hour')}:${part('minute')}`
}

/** A calendar day (YYYY-MM-DD) as its parts; the reply's days are already the person's own. */
function dayOf(day: string): { weekday: string; date: number; month: string; year: number } | undefined {
  if (!isDay(day)) return undefined
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const at = new Date(Date.UTC(year, month - 1, date))
  if (at.getUTCMonth() !== month - 1) return undefined
  return { weekday: WEEKDAYS[at.getUTCDay()]!, date, month: MONTHS[month - 1]!, year }
}

/** "Thu 8 Oct". */
function dayName(day: string): string | undefined {
  const parts = dayOf(day)
  return parts === undefined ? undefined : `${parts.weekday} ${parts.date} ${parts.month}`
}

/** "last moved 2 Sep", with the year when it is not today's. */
function movedLabel(day: string, today: string): string | undefined {
  const parts = dayOf(day)
  if (parts === undefined) return undefined
  const isThisYear = dayOf(today)?.year === parts.year
  return `last moved ${parts.date} ${parts.month}${isThisYear ? '' : ` ${parts.year}`}`
}

/** "15 need you · 3 waiting on others · 1 coming up · 197 later". */
const countsLine = (counts: PlateCounts) =>
  [
    `${counts.now} ${counts.now === 1 ? 'needs' : 'need'} you`,
    `${counts.waiting} waiting on others`,
    `${counts.coming} coming up`,
    `${counts.later} later`,
  ].join(DOT)

/** A member's name from the reply's people, on one line; none when the reply has no name. */
function nameOf(people: Record<string, string>, who: number): string | undefined {
  const name = textOf(people[String(who)])
  return name === undefined ? undefined : oneLine(name)
}

/** A card's tag: its words, the row field they are read from, and its colour. */
type Tag = { text: string; source: string; tone: string }

/**
 * A card's tag, from the row's own fields and never from the plain words: how late, how long it
 * has waited on the person, started, on whom it waits and how long, or when it is due; "(A GUESS)"
 * where the fact it states was read from words and is unsure.
 */
function tagOf(row: PlateRow, people: Record<string, string>): Tag | undefined {
  const guess = (flag: unknown) => (flag === true ? ' (A GUESS)' : '')
  const days = (n: number) => `${n} ${n === 1 ? 'DAY' : 'DAYS'}`
  const since = isNumber(row.since_days) && row.since_days >= 0 ? `${DOT}${row.since_days === 0 ? 'TODAY' : days(row.since_days)}` : ''
  const due = isDay(row.due) ? dayName(row.due) : undefined
  switch (row.why) {
    case 'late': {
      const late = isNumber(row.days_late) && row.days_late > 0 ? `${days(row.days_late)} LATE` : 'LATE'
      return { text: `${late}${guess(row.due_suggested)}`, source: 'row.days_late', tone: 'red' }
    }
    case 'today':
      return { text: `DUE TODAY${guess(row.due_suggested)}`, source: 'row.why', tone: 'yellow' }
    case 'tomorrow':
      return { text: `DUE TOMORROW${guess(row.due_suggested)}`, source: 'row.why', tone: 'yellow' }
    case 'waiting_on_you':
      return { text: `WAITING ON YOU${since}${guess(row.waiting_suggested)}`, source: 'row.since_days', tone: 'yellow' }
    case 'started':
      return { text: 'STARTED', source: 'row.why', tone: 'green' }
    case 'waiting':
    case 'handed': {
      const on = isNumber(row.on) ? nameOf(people, row.on) : typeof row.on === 'string' ? textOf(oneLine(row.on)) : undefined
      const head = on === undefined ? 'WAITING' : `ON ${on.toUpperCase()}`
      const unsure = row.why === 'handed' ? row.doer_suggested : row.waiting_suggested
      return { text: `${head}${since}${guess(unsure)}`, source: 'row.on', tone: 'magenta' }
    }
    case 'due':
    default:
      return due === undefined
        ? undefined
        : { text: `DUE ${due.toUpperCase()}${guess(row.due_suggested)}`, source: 'row.due', tone: 'cyan' }
  }
}

/**
 * A card's dim line: what it is part of, who it is from, when it last moved, each where known, and
 * "maybe yours (a guess)" where the board is unsure the item is the person's to do. On a handed row
 * that guess is about the member it waits on, and its tag says so.
 */
function linePieces(row: PlateRow, plate: PlateReply): { key: string; text: string }[] {
  const pieces: { key: string; text: string }[] = []
  const part = partOf(row.part)
  if (part !== undefined) {
    pieces.push({ key: `datum:row.part:${row.id}`, text: part.unfiled === true ? 'Not filed yet' : oneLine(part.name ?? '') })
  }
  if (row.from === undefined) {
    // The reply names a writer only when it is not the person whose plate this is.
    pieces.push({ key: `datum:row.from:${row.id}`, text: 'written by you' })
  } else if (isNumber(row.from)) {
    const writer = nameOf(plate.people, row.from)
    if (writer !== undefined) pieces.push({ key: `datum:people:from:${row.id}`, text: `from ${writer}` })
  }
  const moved = isDay(row.moved) ? movedLabel(row.moved, plate.today) : undefined
  if (moved !== undefined) pieces.push({ key: `datum:row.moved:${row.id}`, text: moved })
  if (row.doer_suggested === true && row.why !== 'handed') {
    pieces.push({ key: `datum:row.doer_suggested:${row.id}`, text: 'maybe yours (a guess)' })
  }
  return pieces
}

/** The last plate this session read, as the pane holds it now. */
function lastOf(current: PlateView): PlateReply | null {
  if (current.kind === 'shown') return current.plate
  if ('last' in current) return current.last
  return null
}

/** Sets one later group's view. */
const setGroup = ($: EngineInterface, key: string, next: PlateGroupView) =>
  update($, groups, (current): Record<string, PlateGroupView> => ({ ...current, [key]: next }))

/**
 * Shows a plate. A row's done stays where it stood while its item is still on the plate, and is
 * forgotten once a plate arrives without it; its talk is offered again by every plate that arrives.
 * A later group whose count changed (or that is no longer listed) loses its kept rows, and closes.
 */
async function show($: EngineInterface, plate: PlateReply, server: string, named: boolean): Promise<void> {
  const onPlate = new Set([...plate.now, ...plate.waiting, ...plate.coming].map(row => String(row.id)))
  await update($, asked, (current): Record<string, PlateAsk> =>
    Object.fromEntries(Object.entries(current).filter(([id]) => onPlate.has(id))),
  )
  await update($, talks, (current): Record<string, PlateAsk> =>
    Object.fromEntries(Object.entries(current).filter(([id, state]) => onPlate.has(id) && state === 'sending')),
  )
  const counts = new Map((plate.later_groups ?? []).map(group => [keyOf(group), group.count]))
  const stale = Object.entries(await read($, groups))
    .filter(([key, state]) => state.kind === 'rows' && counts.get(key) !== state.count)
    .map(([key]) => key)
  if (stale.length > 0) {
    await update($, groups, (current): Record<string, PlateGroupView> =>
      Object.fromEntries(
        Object.entries(current).filter(([key, state]) => !(stale.includes(key) && state.kind === 'rows' && counts.get(key) !== state.count)),
      ),
    )
    await update($, openGroup, current => (current !== null && stale.includes(current) ? null : current))
  }
  await update($, source, () => server)
  await update($, plateHeld, () => false)
  await update($, view, (): PlateView => ({ kind: 'shown', plate, server, named }))
}

/** What one plate read found, before the pane shows it, and the boards it found on the way. */
type Found = { servers?: string[] } & (
  | { kind: 'plate'; plate: PlateReply; server: string; named: boolean }
  | { kind: 'refused' }
  | { kind: 'blocked' }
  | { kind: 'absent' }
  | { kind: 'off' }
  | { kind: 'failed' }
)

/** Finds the board among the connected tools and asks it for the plate; changes nothing. */
async function findThePlate($: EngineInterface): Promise<Found> {
  let servers: string[]
  try {
    servers = boardsAmong(await $.tool.list())
  } catch {
    return { kind: 'failed' }
  }
  if (servers.length === 0) return { kind: 'absent', servers }
  const zone = machineZone()
  const args = { query: WORDS, view: 'plate', ...(zone === undefined ? {} : { time_zone: zone }), conversation: CONVERSATION }
  let isRefused = false
  let isBlocked = false
  let isFailed = false
  let isOff = false
  for (const server of servers) {
    let words: string
    try {
      const result = await $.mcp.call(server, 'recall', args)
      const blocks = blocksOf(result)
      const answer = result.isError ? undefined : answerAmong(blocks)
      if (answer?.kind === 'plate') return { kind: 'plate', plate: answer.plate, server, named: servers.length > 1, servers }
      // Answered, and not with a plate: a server that is not this person's board. An error the
      // board itself answered is the board's word, never the engine refusing the pane.
      if (!result.isError) continue
      words = blocks.join('\n')
    } catch (error) {
      words = error instanceof Error ? error.message : String(error)
      const refusal = refusalOf(words)
      if (refusal !== undefined) {
        if (refusal === 'classifier') isRefused = true
        else isBlocked = true
        continue
      }
    }
    if (namesThePlate(words)) isOff = true
    else isFailed = true
  }
  if (isRefused) return { kind: 'refused', servers }
  if (isBlocked) return { kind: 'blocked', servers }
  return { kind: isFailed ? 'failed' : isOff ? 'off' : 'absent', servers }
}

/**
 * Lifts every wait on the AI once the one question slot is free: the plate's line goes, and a
 * group that was waiting closes, so its Open asks again on the person's next press.
 */
async function releaseHolds($: EngineInterface): Promise<void> {
  await update($, plateHeld, () => false)
  const held = Object.entries(await read($, groups))
    .filter(([, state]) => state.kind === 'held')
    .map(([key]) => key)
  if (held.length === 0) return
  await update($, groups, (current): Record<string, PlateGroupView> =>
    Object.fromEntries(Object.entries(current).filter(([key]) => !held.includes(key))),
  )
  await update($, openGroup, current => (current !== null && held.includes(current) ? null : current))
}

/**
 * Ends the question that is out, by its own number: answered (what it asked for has been drawn),
 * unanswered (its turn ended with nothing), or unsent (the session did not take it). The slot is
 * then free. A question that is no longer the one out is left alone, so a press that saw an older
 * question can never end the one another press has just put.
 */
async function endQuestion($: EngineInterface, how: 'answered' | 'unanswered' | 'unsent', id: number | undefined): Promise<void> {
  let ended = null as PlateQuestion | null
  await update($, question, (current): PlateQuestion => {
    const isIt = current.state !== 'none' && current.id === id
    ended = isIt ? current : null
    return isIt ? { state: 'none' } : current
  })
  if (ended === null || ended.state === 'none') return
  const out = ended
  if (how !== 'answered') {
    const kind = how
    const group = out.group
    if (group === undefined) {
      await update($, view, (current): PlateView =>
        current.kind === 'asking' || current.kind === 'asked' ? { kind, last: current.last } : current,
      )
    } else {
      await update($, groups, (current): Record<string, PlateGroupView> => {
        const now = current[group]
        return now?.kind === 'asking' || now?.kind === 'asked' ? { ...current, [group]: { kind } } : current
      })
    }
  }
  await releaseHolds($)
}

/**
 * The number of the question out when it is lost: taken by the session, held by no turn, the
 * session idle, and the turn it waited behind ended more than QUIET_MS ago. Queued behind a turn
 * the person then cancelled, it never runs, and would otherwise keep every later press from asking.
 */
async function lostQuestion($: EngineInterface): Promise<number | undefined> {
  const out = await read($, question)
  if (out.state !== 'waiting' || out.turnId !== null || out.behindEndedAt === undefined) return undefined
  if ((await read($, runningTurn)) !== null) return undefined
  return (await $.clock.now()) - out.behindEndedAt > QUIET_MS ? out.id : undefined
}

/**
 * Ends a question a turn held only tentatively, once QUIET_MS has passed after that turn with no
 * turn starting: had that turn been one queued ahead of it, the question's own would have started.
 */
async function endIfQuiet($: EngineInterface, id: number | undefined, startedAtEnd: number): Promise<void> {
  const out = await read($, question)
  if (out.state === 'none' || out.id !== id || out.turnId !== null || turnsStarted !== startedAtEnd) return
  await endQuestion($, 'unanswered', id)
}

/**
 * Puts one question to the person's AI, for a read the person started that the engine refused:
 * the plate's, or a later group's (`group`). One question at a time: while another is out, nothing
 * is sent and the pane says it waits on the AI. The question goes from a timer, outside the
 * dispatch that asked, so it never waits on a turn that dispatch holds.
 */
async function askTheAI($: EngineInterface, text: string, group?: string): Promise<void> {
  // A question that will never run frees the slot for this press: that question, by its number.
  const lost = await lostQuestion($)
  if (lost !== undefined) await endQuestion($, 'unanswered', lost)
  questionsPut += 1
  const id = questionsPut
  let isNew = false
  await update($, question, (current): PlateQuestion => {
    isNew = current.state === 'none'
    return isNew ? { state: 'sending', id, text, turnId: null, ...(group === undefined ? {} : { group }) } : current
  })
  const out = await read($, question)
  if (out.state === 'none' || out.group !== group) {
    if (group === undefined) await update($, plateHeld, () => true)
    else await setGroup($, group, { kind: 'held' })
    return
  }
  const kind = isNew || out.state === 'sending' ? 'asking' : 'asked'
  if (group === undefined) await update($, view, (current): PlateView => ({ kind, last: lastOf(current) }))
  else await setGroup($, group, { kind })
  if (!isNew) return
  $.clock.after(0, () => {
    void putTheQuestion($, id, text, group).catch(() => undefined)
  })
}

/**
 * Submits the question as the person's own words, and says so plainly when it was not taken. It
 * drops out, sending nothing, when its question is no longer the one out. A question put while
 * another main-loop turn runs is queued behind it, and the session takes it at once: so the turn
 * running now is noted on the question, and its end does not end it.
 */
async function putTheQuestion($: EngineInterface, id: number, text: string, group: string | undefined): Promise<void> {
  const behind = await read($, runningTurn)
  let isOut = false
  await update($, question, (current): PlateQuestion => {
    if (current.state !== 'sending' || current.id !== id) {
      isOut = false
      return current
    }
    isOut = true
    return behind === null ? current : { ...current, behind }
  })
  if (!isOut) return
  let isTaken = false
  try {
    isTaken = (await $.prompt.submit({ text, asUser: true })).drop === undefined
  } catch {
    isTaken = false
  }
  if (!isTaken) {
    await endQuestion($, 'unsent', id)
    return
  }
  await update($, question, (current): PlateQuestion =>
    current.state === 'sending' && current.id === id ? { ...current, state: 'waiting' } : current,
  )
  if (group === undefined) {
    await update($, view, (current): PlateView => (current.kind === 'asking' ? { kind: 'asked', last: current.last } : current))
  } else {
    await update($, groups, (current): Record<string, PlateGroupView> =>
      current[group]?.kind === 'asking' ? { ...current, [group]: { kind: 'asked' } } : current,
    )
  }
}

/** A promise that answers 'late' once READ_LIMIT_MS has passed, and the timer to cancel. */
function limit($: EngineInterface): { late: Promise<'late'>; cancel: () => void } {
  let giveUp: () => void = () => {}
  const late = new Promise<'late'>(resolve => {
    giveUp = () => resolve('late')
  })
  const timer = $.clock.after(READ_LIMIT_MS, () => giveUp())
  return { late, cancel: () => timer.cancel() }
}

/**
 * Reads the plate and shows what it found, within READ_LIMIT_MS: a read that has not answered by
 * then ends in the failed line, with the last plate this session read. A newer read wins over an
 * older one that answers late.
 *
 * A read the person started tries the board every time. One a track started does not run while a
 * person's read is on its way, nor at all once the engine has refused the pane in this session, so
 * refusals never pile up. When the engine refuses, only a read the person started acts on it: the
 * classifier's refusal asks the AI, any other says the pane may not read here. Any other read
 * keeps what the pane shows.
 */
async function readPlate($: EngineInterface, by: 'person' | 'ai'): Promise<void> {
  if (by === 'ai' && (personReads > 0 || (await read($, refusedHere)))) return
  newestRead += 1
  const mine = newestRead
  if (by === 'person') personReads += 1
  const timer = limit($)
  let found: Found | 'late'
  try {
    found = await Promise.race([findThePlate($), timer.late])
  } finally {
    timer.cancel()
    if (by === 'person') personReads -= 1
  }
  if (found !== 'late' && (found.kind === 'refused' || found.kind === 'blocked')) {
    await update($, refusedHere, () => true)
  } else if (found !== 'late' && found.kind === 'plate' && by === 'person') {
    await update($, refusedHere, () => false)
  }
  if (mine !== newestRead) return
  if (found !== 'late' && found.servers !== undefined) {
    const servers = found.servers
    await update($, boards, () => servers)
  }
  if (found === 'late' || found.kind === 'failed') {
    await update($, view, (current): PlateView => ({ kind: 'failed', last: lastOf(current) }))
  } else if (found.kind === 'plate') {
    await show($, found.plate, found.server, found.named)
  } else if (found.kind === 'refused') {
    if (by === 'person') await askTheAI($, theQuestion())
  } else if (found.kind === 'blocked') {
    if (by === 'person') await update($, view, (current): PlateView => ({ kind: 'blocked', last: lastOf(current) }))
  } else {
    const kind = found.kind
    await update($, view, (): PlateView => ({ kind }))
  }
}

/** What one later group's read found. */
type GroupFound = { kind: 'rows'; rows: PlateLaterRow[]; count: number } | { kind: 'refused' } | { kind: 'blocked' } | { kind: 'failed' }

/** Asks the board the plate came from for one later group; changes nothing. */
async function findTheGroup($: EngineInterface, server: string, key: string): Promise<GroupFound> {
  const zone = machineZone()
  const args = {
    query: GROUP_WORDS,
    view: 'plate',
    part: partOfKey(key),
    ...(zone === undefined ? {} : { time_zone: zone }),
    conversation: CONVERSATION,
  }
  try {
    const result = await $.mcp.call(server, 'recall', args)
    const answer = result.isError ? undefined : answerAmong(blocksOf(result))
    return answer?.kind === 'group' ? { kind: 'rows', rows: answer.rows, count: answer.count } : { kind: 'failed' }
  } catch (error) {
    const refusal = refusalOf(error instanceof Error ? error.message : String(error))
    return refusal === 'classifier' ? { kind: 'refused' } : refusal === 'engine' ? { kind: 'blocked' } : { kind: 'failed' }
  }
}

/**
 * Reads one later group the person opened, the same way a plate read goes: directly, within
 * READ_LIMIT_MS; refused by the classifier, one question to the AI on this press; refused
 * otherwise, the line saying the pane may not read here. Its rows, once read, are kept. A group
 * closed before its read answers drops that read: it asks no one.
 */
async function readGroup($: EngineInterface, group: PlateLaterGroup): Promise<void> {
  const key = keyOf(group)
  groupReadsMade += 1
  const mine = groupReadsMade
  newestGroupRead.set(key, mine)
  await setGroup($, key, { kind: 'loading' })
  const server = await read($, source)
  let found: GroupFound | 'late' = { kind: 'failed' }
  if (server !== null) {
    const timer = limit($)
    try {
      found = await Promise.race([findTheGroup($, server, key), timer.late])
    } finally {
      timer.cancel()
    }
  }
  if (found !== 'late' && (found.kind === 'refused' || found.kind === 'blocked')) {
    await update($, refusedHere, () => true)
  } else if (found !== 'late' && found.kind === 'rows') {
    await update($, refusedHere, () => false)
  }
  if (newestGroupRead.get(key) !== mine) return
  // Closed while its read was on its way: the read is dropped, and asks no one.
  if ((await read($, openGroup)) !== key) {
    await update($, groups, (current): Record<string, PlateGroupView> =>
      current[key]?.kind === 'loading' ? Object.fromEntries(Object.entries(current).filter(([one]) => one !== key)) : current,
    )
    return
  }
  if (found === 'late' || found.kind === 'failed') await setGroup($, key, { kind: 'failed' })
  else if (found.kind === 'rows') await setGroup($, key, found)
  else if (found.kind === 'blocked') await setGroup($, key, { kind: 'blocked' })
  else await askTheAI($, groupQuestion(group), key)
}

/**
 * Refresh: forgets every later group's kept rows, closing the open one if it held them, so the
 * next Open reads that group again; then reads the plate the way any read the person starts does.
 */
async function refreshPlate($: EngineInterface): Promise<void> {
  const kept = Object.entries(await read($, groups))
    .filter(([, state]) => state.kind === 'rows')
    .map(([key]) => key)
  if (kept.length > 0) {
    await update($, groups, (current): Record<string, PlateGroupView> =>
      Object.fromEntries(Object.entries(current).filter(([key, state]) => !(kept.includes(key) && state.kind === 'rows'))),
    )
    await update($, openGroup, current => (current !== null && kept.includes(current) ? null : current))
  }
  await readPlate($, 'person')
}

/** Opens a later group, closing any other, and reads it unless its rows are kept or on their way. */
async function pressGroup($: EngineInterface, group: PlateLaterGroup): Promise<void> {
  const key = keyOf(group)
  if ((await read($, openGroup)) === key) {
    await update($, openGroup, () => null)
    return
  }
  await update($, openGroup, () => key)
  const now = (await read($, groups))[key]
  if (now?.kind === 'rows' || now?.kind === 'loading') return
  await readGroup($, group)
}

/**
 * Sends the person's AI one sentence, as the person's own words; it counts as sent only once the
 * session took it.
 */
async function isTakenBy($: EngineInterface, text: string): Promise<boolean> {
  try {
    return (await $.prompt.submit({ text, asUser: true })).drop === undefined
  } catch {
    return false
  }
}

/**
 * Done: asks the person's AI to mark one item done, by its number alone ("Mark item <n> done."),
 * once while the item is on the plate. It carries nothing anyone else wrote.
 */
async function askDone($: EngineInterface, row: PlateRow): Promise<void> {
  const key = String(row.id)
  // Decided where the value is written, so a double press posts once.
  let isMine = false
  await update($, asked, (current): Record<string, PlateAsk> => {
    isMine = current[key] !== 'sending' && current[key] !== 'sent'
    return isMine ? { ...current, [key]: 'sending' } : current
  })
  if (!isMine) return
  const outcome: PlateAsk = (await isTakenBy($, `Mark item ${row.id} done.`)) ? 'sent' : 'unsent'
  await update($, asked, (current): Record<string, PlateAsk> => ({ ...current, [key]: outcome }))
}

/**
 * Talk about it: asks the person's AI about one item, by its number alone ("Tell me about item
 * <n>."), once per item until a plate arrives again. It carries nothing anyone else wrote.
 */
async function askTalk($: EngineInterface, row: PlateRow): Promise<void> {
  const key = String(row.id)
  // Decided where the value is written, so a double press posts once.
  let isMine = false
  await update($, talks, (current): Record<string, PlateAsk> => {
    isMine = current[key] !== 'sending' && current[key] !== 'sent'
    return isMine ? { ...current, [key]: 'sending' } : current
  })
  if (!isMine) return
  const outcome: PlateAsk = (await isTakenBy($, `Tell me about item ${row.id}.`)) ? 'sent' : 'unsent'
  await update($, talks, (current): Record<string, PlateAsk> => ({ ...current, [key]: outcome }))
}

/**
 * Follows the AI's own call to a board, once that call has answered, while the pane is open: a
 * plate it read is drawn, and answers the plate's question if that is out; a later group it read
 * is kept for that group, and answers that group's question; after anything else the pane reads
 * the board again itself, and never asks the AI.
 */
async function followTheAI(
  $: EngineInterface,
  answer: Answer | undefined,
  server: string,
  askedFor: string | undefined,
): Promise<void> {
  const current = await read($, view)
  if (current.kind === 'unasked') return
  if (!(await $.ui.panes()).some(pane => pane.id === PANE)) return
  if (answer === undefined) {
    await readPlate($, 'ai')
    return
  }
  const out = await read($, question)
  if (answer.kind === 'plate') {
    const known = await read($, boards)
    if (out.state !== 'none' && out.group === undefined) await endQuestion($, 'answered', out.id)
    await show($, answer.plate, server, known.length > 1)
    return
  }
  // A later group's read never replaces the plate: it is that group's rows, kept under the part
  // the AI named, else the group the reply names.
  const key = askedFor ?? answer.key
  if (key === undefined) return
  groupReadsMade += 1
  newestGroupRead.set(key, groupReadsMade)
  await setGroup($, key, { kind: 'rows', rows: answer.rows, count: answer.count })
  if (out.state !== 'none' && out.group === key) await endQuestion($, 'answered', out.id)
}

export const register: Register = (on, options) => {
  if (options.plate === 'off') return

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'plate',
      description: 'Open your plate in a pane: what needs you now, what waits on someone else, what is coming up',
    })
    return next(e)
  })

  on('command.run', { command: 'plate' }, async $ => {
    await update($, view, (current): PlateView => (current.kind === 'unasked' ? { kind: 'loading' } : current))
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    await readPlate($, 'person')
    return { text: opened.isPlaced ? 'Your plate is open.' : 'Your plate opens as soon as there is room for it.' }
  })

  // The AI's own calls to a board, a subagent's included. Its call answers first, untouched; what
  // the pane does about it runs afterwards, from a timer, and never asks the AI anything.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      const known = await read($, boards)
      const name = String(e.tool)
      const server = known.find(one => name === `mcp__${one}__track` || name === `mcp__${one}__recall`)
      if (server === undefined) return ran
      if (name === `mcp__${server}__track`) {
        $.clock.after(0, () => {
          void followTheAI($, undefined, server, undefined).catch(() => undefined)
        })
      } else {
        const answer = answerInCall(ran)
        if (answer !== undefined) {
          const askedFor = answer.kind === 'group' ? keyOfAsked((e as { part?: unknown }).part) : undefined
          $.clock.after(0, () => {
            void followTheAI($, answer, server, askedFor).catch(() => undefined)
          })
        }
      }
    } catch {
      // The AI's call stands whatever happens here; the pane is only ever behind.
    }
    return ran
  }).catch(($, e, next) => next(e))

  // The main loop's turns: which one runs now (noted from the start, and nothing else before the
  // person asks), and the question's own. The turn opening with the question's words is its own,
  // even after another turn held it. For a question queued behind a running turn, a later turn
  // opening with other words holds it only tentatively: it may be the question reworded, or a turn
  // queued ahead of it.
  on('turn.start', async ($, e, next) => {
    try {
      turnsStarted += 1
      await update($, runningTurn, () => e.turnId)
      const out = await read($, question)
      if (out.state !== 'none' && e.text === out.text) {
        await update($, question, (current): PlateQuestion =>
          current.state !== 'none' && current.id === out.id ? { ...current, turnId: e.turnId, exact: true } : current,
        )
      } else if (out.state !== 'none' && out.turnId === null && out.behind !== undefined && e.turnId !== out.behind) {
        await update($, question, (current): PlateQuestion =>
          current.state !== 'none' && current.id === out.id && current.turnId === null
            ? { ...current, turnId: e.turnId, exact: false }
            : current,
        )
      }
    } catch {
      // The turn goes on whatever happens here.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A question ends with its own turn or, put while no turn ran, with the first main-loop turn to end
  // after the session took it, whatever words that turn opened with: it never stays out for the
  // session. The turn it was queued behind is not its turn: its end leaves the question out, and is
  // noted. A turn that held it only tentatively ends it only once no turn has started for QUIET_MS.
  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    try {
      if (e.agentId === undefined) {
        await update($, runningTurn, current => (current === e.turnId ? null : current))
        const out = await read($, question)
        if (out.state === 'none') {
          // Nothing out.
        } else if (out.turnId === e.turnId && out.exact === false) {
          const at = await $.clock.now()
          const startedAtEnd = turnsStarted
          await update($, question, (current): PlateQuestion =>
            current.state !== 'none' && current.id === out.id && current.turnId === e.turnId
              ? { ...current, turnId: null, exact: undefined, behindEndedAt: at }
              : current,
          )
          $.clock.after(QUIET_MS, () => {
            void endIfQuiet($, out.id, startedAtEnd).catch(() => undefined)
          })
        } else if (out.turnId === e.turnId) {
          await endQuestion($, 'unanswered', out.id)
        } else if (out.behind === e.turnId) {
          const at = await $.clock.now()
          await update($, question, (current): PlateQuestion =>
            current.state !== 'none' && current.id === out.id ? { ...current, behindEndedAt: at } : current,
          )
        } else if (out.state === 'waiting' && out.turnId === null && out.behind === undefined) {
          await endQuestion($, 'unanswered', out.id)
        }
      }
    } catch {
      // The turn has ended whatever happens here.
    }
    return ended
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await read($, view)
    const { Box, Text, Button } = $.ui.resolve(e)
    if (current.kind === 'unasked') return <Box />
    const asks = await read($, asked)
    const talkAsks = await read($, talks)
    const chosen = await read($, tab)
    const openId = await read($, openCard)
    const openKey = await read($, openGroup)
    const groupViews = await read($, groups)
    const isHeld = await read($, plateHeld)
    // The AI answers after its current reply only while some other turn of the main loop runs.
    const running = await read($, runningTurn)
    const out = await read($, question)
    const isBusy = running !== null && (out.state === 'none' || out.turnId !== running)

    const refresh = (
      <Box key="actions" marginTop={1}>
        <Button key="refresh" label="Refresh" onPress={() => refreshPlate($)} />
      </Box>
    )

    // A read the person started was refused while a group's question was out: nothing was sent.
    const held = isHeld && (
      <Box gap={1}>
        <Box key="status:held">
          <Text dimColor>Waiting on your AI.</Text>
        </Box>
        <Text dimColor>Try again once it answers.</Text>
      </Box>
    )

    const busyLine = isBusy && <Text dimColor>It answers after its current reply.</Text>

    // A row's Done: its button, or where its sentence stands.
    const doneControl = (row: PlateRow) => {
      const ask = asks[String(row.id)]
      const button = <Button key={`done:${row.id}`} label="Done" variant="primary" onPress={() => askDone($, row)} />
      if (ask === 'sending') {
        return (
          <Box key={`status:sending:${row.id}`}>
            <Text dimColor>Sending to your AI.</Text>
          </Box>
        )
      }
      if (ask === 'sent') {
        return (
          <Box key={`status:sent:${row.id}`}>
            <Text dimColor>Sent to your AI.</Text>
          </Box>
        )
      }
      if (ask === 'unsent') {
        return [
          <Box key={`status:unsent:${row.id}`}>
            <Text>Not sent. Try again.</Text>
          </Box>,
          button,
        ]
      }
      return button
    }

    // A row's Talk about it: its button, and where its sentence stands.
    const talkControl = (row: PlateRow) => {
      const ask = talkAsks[String(row.id)]
      const button = (
        <Button key={`talk:${row.id}`} label="Talk about it" variant="secondary" onPress={() => askTalk($, row)} />
      )
      if (ask === 'sending') {
        return (
          <Box key={`status:talk-sending:${row.id}`}>
            <Text dimColor>Sending to your AI.</Text>
          </Box>
        )
      }
      if (ask === 'sent') {
        return (
          <Box key={`status:talk-sent:${row.id}`}>
            <Text dimColor>Sent to your AI.</Text>
          </Box>
        )
      }
      if (ask === 'unsent') {
        return [
          <Box key={`status:talk-unsent:${row.id}`}>
            <Text>Not sent. Try again.</Text>
          </Box>,
          button,
        ]
      }
      return button
    }

    const card = (plate: PlateReply, row: PlateRow) => {
      const isOpen = openId === row.id
      const tag = tagOf(row, plate.people)
      const tone = tag?.tone ?? 'gray'
      const pieces = linePieces(row, plate)
      const about = isOpen ? textOf(row.about) : undefined
      const done = asks[String(row.id)]
      return (
        <Box
          key={`card:${row.id}`}
          flexDirection="column"
          borderStyle="round"
          borderColor={isOpen ? tone : 'gray'}
          paddingX={1}
          marginTop={1}
          hover={{ borderColor: tone }}
        >
          <Box justifyContent="space-between" gap={1}>
            {tag === undefined ? (
              <Box />
            ) : (
              <Box key={`datum:${tag.source}:tag:${row.id}`} flexShrink={1}>
                <Text backgroundColor={tag.tone} color="black" bold wrap="truncate-end">{` ${tag.text} `}</Text>
              </Box>
            )}
            <Button
              key={`open:${row.id}`}
              label={isOpen ? 'Close' : 'Open'}
              dimColor
              onPress={() => update($, openCard, current => (current === row.id ? null : row.id))}
            />
          </Box>
          <Box key={`datum:row.title:${row.id}`}>
            <Text bold wrap={isOpen ? 'wrap' : 'truncate-end'}>
              {neutral(row.title)}
            </Text>
          </Box>
          {pieces.length > 0 && (
            <Box key={`line:${row.id}`} gap={1}>
              {pieces.flatMap((piece, at) => [
                ...(at > 0 ? [<Text key={`sep:${row.id}:${at}`} dimColor>{'\u{b7}'}</Text>] : []),
                <Box key={piece.key} flexShrink={1}>
                  <Text dimColor wrap="truncate-end">
                    {piece.text}
                  </Text>
                </Box>,
              ])}
            </Box>
          )}
          {about !== undefined && (
            <Box key={`datum:row.about:${row.id}`} marginTop={1}>
              <Text wrap="wrap">{oneLine(about)}</Text>
            </Box>
          )}
          {isOpen ? (
            <Box key={`actions:${row.id}`} gap={1} marginTop={1} flexWrap="wrap">
              {doneControl(row)}
              {talkControl(row)}
            </Box>
          ) : (
            (done === 'sending' || done === 'sent') && doneControl(row)
          )}
        </Box>
      )
    }

    const nothingHere = (
      <Box key="status:tab-empty" marginTop={1}>
        <Text dimColor>Nothing here.</Text>
      </Box>
    )

    const cards = (plate: PlateReply, key: (typeof ACTIVE)[number]) => {
      const rows = plate[key]
      const more = plate.counts[key] - rows.length
      if (rows.length === 0 && more <= 0) return nothingHere
      return (
        <Box flexDirection="column">
          {rows.map(row => card(plate, row))}
          {more > 0 && (
            <Box key={`datum:counts.${key}:more`} marginTop={1}>
              <Text dimColor>{`And ${more} more.`}</Text>
            </Box>
          )}
        </Box>
      )
    }

    // What one open later group shows: its rows, or where its read stands.
    const groupBody = (plate: PlateReply, key: string) => {
      const state = groupViews[key]
      const line = (kind: string, words: string, isDim = true) => (
        <Box key={`status:group-${kind}:${key}`} marginTop={1}>
          <Text dimColor={isDim}>{words}</Text>
        </Box>
      )
      if (state === undefined) return null
      if (state.kind === 'loading') return line('loading', 'Reading this group.')
      if (state.kind === 'asking') return line('asking', 'Asking your AI.')
      if (state.kind === 'asked') {
        return (
          <Box gap={1}>
            {line('asked', 'Asked your AI.')}
            {busyLine}
          </Box>
        )
      }
      if (state.kind === 'held') {
        return (
          <Box gap={1}>
            {line('held', 'Waiting on your AI.')}
            <Box marginTop={1}>
              <Text dimColor>Try again once it answers.</Text>
            </Box>
          </Box>
        )
      }
      if (state.kind === 'unanswered') return line('unanswered', 'No answer from your AI.', false)
      if (state.kind === 'unsent') return line('unsent', 'Your question was not sent.', false)
      if (state.kind === 'failed') return line('failed', 'Could not reach Dazzer.', false)
      if (state.kind === 'blocked') {
        return (
          <Box gap={1}>
            {line('blocked', 'Not allowed here.', false)}
            <Box marginTop={1}>
              <Text>{NOT_ALLOWED}</Text>
            </Box>
          </Box>
        )
      }
      if (state.rows.length === 0) return line('empty', 'Nothing in this group now.')
      const more = state.count - state.rows.length
      return (
        <Box flexDirection="column">
          {state.rows.map(row => {
            const moved = isDay(row.moved) ? movedLabel(row.moved, plate.today) : undefined
            return (
              <Box key={`later:${row.id}`} flexDirection="column" marginTop={1}>
                <Box key={`datum:later.title:${row.id}`}>
                  <Text wrap="truncate-end">{neutral(row.title)}</Text>
                </Box>
                {moved !== undefined && (
                  <Box key={`datum:later.moved:${row.id}`}>
                    <Text dimColor>{moved}</Text>
                  </Box>
                )}
              </Box>
            )
          })}
          {more > 0 && (
            <Box key={`datum:later_groups:more:${key}`} marginTop={1}>
              <Text dimColor>{`And ${more} more.`}</Text>
            </Box>
          )}
        </Box>
      )
    }

    const groupBox = (plate: PlateReply, group: PlateLaterGroup) => {
      const key = keyOf(group)
      const isOpen = openKey === key
      return (
        <Box
          key={`group:${key}`}
          flexDirection="column"
          borderStyle="round"
          borderColor={isOpen ? 'cyan' : 'gray'}
          paddingX={1}
          marginTop={1}
          hover={{ borderColor: 'cyan' }}
        >
          <Box justifyContent="space-between" gap={1}>
            <Box key={`datum:later_groups:name:${key}`} flexShrink={1}>
              <Text bold wrap="truncate-end">
                {groupName(group)}
              </Text>
            </Box>
            <Box gap={1}>
              <Box key={`datum:later_groups:count:${key}`}>
                <Text dimColor>{String(group.count)}</Text>
              </Box>
              <Button key={`group-open:${key}`} label={isOpen ? 'Close' : 'Open'} dimColor onPress={() => pressGroup($, group)} />
            </Box>
          </Box>
          {isOpen && groupBody(plate, key)}
        </Box>
      )
    }

    const later = (plate: PlateReply) => {
      const listed = plate.later_groups
      const count = plate.counts.later
      if (listed === undefined) {
        // An answer with no groups: later as a count.
        if (count <= 0) return nothingHere
        return (
          <Box key="datum:counts.later:later" marginTop={1}>
            <Text dimColor>{`${count} ${count === 1 ? 'thing' : 'things'} can wait until later.`}</Text>
          </Box>
        )
      }
      // The board lists the largest groups and counts the rest.
      const more = isNumber(plate.later_groups_more) && plate.later_groups_more > 0 ? plate.later_groups_more : 0
      if (listed.length === 0 && more === 0) return nothingHere
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor wrap="wrap">
            Grouped by what each item belongs to.
          </Text>
          {listed.map(group => groupBox(plate, group))}
          {more > 0 && (
            <Box key="datum:later_groups_more:later" marginTop={1}>
              <Text dimColor>{`And ${more} more ${more === 1 ? 'group' : 'groups'}.`}</Text>
            </Box>
          )}
        </Box>
      )
    }

    const body = (plate: PlateReply) => {
      const day = dayName(plate.today)
      const isClear = ACTIVE.every(key => plate.counts[key] === 0) && plate.counts.later === 0
      return (
        <Box flexDirection="column">
          {day !== undefined && (
            <Box key="datum:today:head">
              <Text bold>{day}</Text>
            </Box>
          )}
          {isClear ? (
            <Box key="status:clear">
              <Text>Nothing on your plate.</Text>
            </Box>
          ) : (
            <Box key="datum:counts:head">
              <Text dimColor wrap="wrap">
                {countsLine(plate.counts)}
              </Text>
            </Box>
          )}
          {!isClear && (
            <Box key="tabs" gap={1} marginTop={1} flexWrap="wrap">
              {TABS.map(each => (
                <Button
                  key={`tab:${each.key}`}
                  label={`${each.name} ${plate.counts[each.key]}`}
                  variant={chosen === each.key ? 'primary' : 'secondary'}
                  onPress={() => update($, tab, () => each.key)}
                />
              ))}
            </Box>
          )}
          {!isClear && (chosen === 'later' ? later(plate) : cards(plate, chosen))}
        </Box>
      )
    }

    // The pane's layout with placeholder cards: never an empty plate while one is on its way.
    const placeholders = (
      <Box flexDirection="column">
        <Box gap={1} marginTop={1}>
          {TABS.map(each => (
            <Text key={`placeholder-tab:${each.key}`} dimColor>
              {each.name}
            </Text>
          ))}
        </Box>
        {[1, 2].map(n => (
          <Box key={`placeholder:${n}`} borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
            <Text dimColor>{'\u{b7} \u{b7} \u{b7}'}</Text>
          </Box>
        ))}
      </Box>
    )

    if (current.kind === 'loading') {
      return (
        <Box flexDirection="column">
          <Box key="status:loading">
            <Text dimColor>Reading your plate.</Text>
          </Box>
          {placeholders}
          {refresh}
        </Box>
      )
    }

    if (current.kind === 'asking' || current.kind === 'asked') {
      return (
        <Box flexDirection="column">
          {current.kind === 'asking' ? (
            <Box key="status:asking">
              <Text dimColor>Asking your AI.</Text>
            </Box>
          ) : (
            <Box gap={1}>
              <Box key="status:asked">
                <Text dimColor>Asked your AI.</Text>
              </Box>
              {busyLine}
            </Box>
          )}
          {current.last === null ? placeholders : body(current.last)}
          {refresh}
        </Box>
      )
    }

    if (current.kind === 'unanswered' || current.kind === 'unsent' || current.kind === 'blocked') {
      return (
        <Box flexDirection="column">
          {held}
          {current.kind === 'unanswered' ? (
            <Box key="status:unanswered">
              <Text>No plate from your AI.</Text>
            </Box>
          ) : current.kind === 'unsent' ? (
            <Box key="status:unsent">
              <Text>Your question was not sent.</Text>
            </Box>
          ) : (
            <Box gap={1}>
              <Box key="status:blocked">
                <Text>Not allowed here.</Text>
              </Box>
              <Text>{NOT_ALLOWED}</Text>
            </Box>
          )}
          {current.last !== null && body(current.last)}
          {refresh}
        </Box>
      )
    }

    if (current.kind === 'absent') {
      return (
        <Box flexDirection="column">
          {held}
          <Box gap={1}>
            <Box key="status:absent">
              <Text>Dazzer was not found here.</Text>
            </Box>
            <Text>{CONNECT}</Text>
          </Box>
          {refresh}
        </Box>
      )
    }

    if (current.kind === 'off') {
      return (
        <Box flexDirection="column">
          {held}
          <Box key="status:off">
            <Text>Your plate is switched off.</Text>
          </Box>
          {refresh}
        </Box>
      )
    }

    if (current.kind === 'failed') {
      const when = current.last === null ? undefined : asOf(current.last.as_of)
      return (
        <Box flexDirection="column">
          {held}
          <Box gap={1}>
            <Box key="status:failed">
              <Text>Could not reach Dazzer.</Text>
            </Box>
            {when !== undefined && (
              <Box key="datum:as_of:last">
                <Text dimColor>{when}</Text>
              </Box>
            )}
          </Box>
          {current.last !== null && body(current.last)}
          {refresh}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {held}
        {current.named && (
          <Box key="datum:tool.list:from">
            <Text dimColor>{`From ${neutral(current.server)}`}</Text>
          </Box>
        )}
        {body(current.plate)}
        {refresh}
      </Box>
    )
  })
}
