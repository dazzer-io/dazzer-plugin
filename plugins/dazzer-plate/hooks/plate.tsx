// The plate pane: a person's plate from their Dazzer board, drawn beside the chat when they ask.
//
// WHEN IT DRAWS. Only once the person asks: /plate, or the pane's own refresh once it is open.
// Nothing here opens a pane, reads the board or sets a status line from the session's start, a
// timer or anything the AI does on its own; until the person asks, the pane's state is "unasked"
// and it draws nothing.
//
// HOW IT READS. It holds no connection and no credentials. It finds the board among the tools the
// session has connected now: a server offering both `recall` and `track`, so the person's words,
// zone and conversation name never go to a server that is not a board. It calls that server's
// `recall` for the plate view through the session's own connection (`$.mcp.call`); the first whose
// answer holds a plate is the board. Every read ends within 20 seconds, in the plate or in one
// failed line, never in an endless "Reading your plate."
//
// WHERE THE ENGINE WILL NOT LET IT. In auto mode the engine's classifier refuses the pane's own
// call (seen live in the Desktop app). Only for a read the person started (/plate or Refresh), and
// only when the auto mode classifier refused it, the pane puts one question to the person's AI, as
// the person's own words: "What is on my plate? My time zone is <the machine's zone>.". When the
// AI's own recall returns a plate, the pane draws it. One question at a time: while it is
// unanswered, /plate and Refresh still try the board and send nothing more. The question ends with
// its own turn, or failing that the first turn to end after the session took it; if no plate came,
// the pane says so. Any other refusal of the engine's (a deny rule, don't-ask mode, a hook) is not
// cured by asking: the pane says Claude Code does not let it read here, and asks nothing. Every
// read the person starts tries the board first, so a change of mode takes effect at once.
//
// WHAT NEVER POSTS. Nothing but those two acts of the person's ever submits anything in their
// name: the AI's track (a subagent's included), a timer and the session's start never do. After the
// AI's own call to the board, the pane only reads the board again itself, and not at all once the
// engine has refused it in this session (so refusals never pile up), nor while a read the person
// started is still on its way; refused, it keeps what it shows and asks no one.
//
// WHO WRITES. Never this pane. A row's done sends the person's AI one sentence carrying the item's
// number and nothing else ("Mark item 7236 done."); the AI marks it done through its own
// connection. The title never travels with it: anyone in the workspace can write a title, and done
// speaks as the person. A row counts as sent only once the session took that sentence, and stays
// sent until a plate arrives without that item.
//
// WHAT IT KEEPS. The last plate this session read, in the session's own state (`$.state`), so a
// failed read can still show it with its time. Nothing is written to disk and nothing is shared
// with another session, so a failed read never shows anyone else's plate.
//
// WHOSE WORDS. The counted sentence, each row's marks and the later line are the board's own plain
// words, taken from the reply's `plain`. They and every title pass through the same one
// neutralising pass the board applies, and are only ever plain text, never a link or a control.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, McpToolResult, Register, ToolCallResult, ToolInfo } from 'claude-code'

import type { PlateAsk, PlateQuestion, PlateReply, PlateRow, PlateView } from '../types'

/** The one pane, by id and title. */
const PANE = 'plate'
const TITLE = 'Your plate'
/** What the pane asks the board, in the person's own words, and the conversation it names. */
const WORDS = 'what is on my plate'
const CONVERSATION = 'plate-pane'
/** How long one read of the plate may take before the pane says it could not reach Dazzer. */
const READ_LIMIT_MS = 20_000
/** A connected server's recall tool, as the session names it. */
const RECALL = /^mcp__(.+)__recall$/
/** Between a row's title and its marks, in the board's plain words. */
const MARK = ' \u{b7} '
/** The reply's own line for how much can wait. */
const LATER = /^\d+ (more )?things? can wait until later\.$/
const BACKSLASH = '\x5c'

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

/** The groups, in the order a person reads them, named by what they ask of the person. */
const GROUPS = [
  { key: 'now', name: 'Needs you now' },
  { key: 'waiting', name: 'Waiting on someone else' },
  { key: 'coming', name: 'Coming up' },
] as const

/** The line that says how to connect, as the README's connection step says it. */
const CONNECT =
  'To connect it, type /plugin install dazzer-connect@dazzer in Claude Code in a terminal, then restart and sign in. Already connected? Try Refresh.'

const view = atom({ plugin: 'dazzer-plate', key: 'view' } as const, { kind: 'unasked' } as PlateView)
const asked = atom({ plugin: 'dazzer-plate', key: 'asked' } as const, {} as Record<string, PlateAsk>)
const boards = atom({ plugin: 'dazzer-plate', key: 'boards' } as const, [] as string[])
const question = atom({ plugin: 'dazzer-plate', key: 'question' } as const, { state: 'none' } as PlateQuestion)
const refusedHere = atom({ plugin: 'dazzer-plate', key: 'refusedHere' } as const, false)
const runningTurn = atom({ plugin: 'dazzer-plate', key: 'runningTurn' } as const, null as string | null)

/** The newest read; an older one that answers late changes nothing. */
let newestRead = 0
/** Reads the person started that are still on their way; a track's read never overtakes one. */
let personReads = 0

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

/** The machine's own time zone, so the board counts the person's own day; none when unknown. */
function machineZone(): string | undefined {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return typeof zone === 'string' && zone.length > 0 ? zone : undefined
}

/** The question the pane puts to the person's AI, in the person's own words. */
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

/** The plate a value holds, rows that are not rows left out; undefined when it is no plate. */
function asPlate(body: unknown): PlateReply | undefined {
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
  return {
    ...whole,
    now: whole.now.filter(isRow),
    waiting: whole.waiting.filter(isRow),
    coming: whole.coming.filter(isRow),
    people: whole.people ?? {},
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

/** The first plate among some texts, each read on its own. */
function plateAmong(texts: readonly string[]): PlateReply | undefined {
  for (const text of texts) {
    for (const body of objectsIn(text)) {
      const plate = asPlate(body)
      if (plate !== undefined) return plate
    }
  }
  return undefined
}

/** A reply's text blocks, each as its own text. */
const blocksOf = (result: McpToolResult): string[] =>
  result.content.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))

/** The plate in the AI's own recall reply: the reply as it read it, else the reply's blocks. */
function plateInCall(ran: ToolCallResult): PlateReply | undefined {
  if (ran.deny !== undefined || ran.isError === true) return undefined
  const fromText = typeof ran.text === 'string' ? plateAmong([ran.text]) : undefined
  if (fromText !== undefined) return fromText
  const result = ran.result as Partial<McpToolResult> | undefined
  return Array.isArray(result?.content) ? plateAmong(blocksOf(result as McpToolResult)) : undefined
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

/**
 * A row's marks in the board's own words: its line in `plain`, after its number and title, through
 * the same neutralising as the title. When the words do not carry the row, what the reply marks as
 * suggested still shows.
 */
function marksOf(plate: PlateReply, row: PlateRow): { text: string; source: string } | undefined {
  const head = `- #${row.id} ${neutral(row.title)}`
  const line = (plate.plain ?? '').split('\n').find(one => one === head || one.startsWith(head + MARK))
  if (line !== undefined && line.length > head.length) {
    return { text: neutral(line.slice(head.length + MARK.length)), source: 'plain' }
  }
  const flag = (['due_suggested', 'waiting_suggested', 'doer_suggested'] as const).find(name => row[name] === true)
  return flag === undefined ? undefined : { text: '(suggested)', source: `row.${flag}` }
}

/** The last plate this session read, as the pane holds it now. */
function lastOf(current: PlateView): PlateReply | null {
  if (current.kind === 'shown') return current.plate
  if ('last' in current) return current.last
  return null
}

/**
 * Shows a plate. A row's done stays where it stood while its item is still on the plate, and is
 * forgotten once a plate arrives without it.
 */
async function show($: EngineInterface, plate: PlateReply, server: string, named: boolean): Promise<void> {
  const onPlate = new Set([...plate.now, ...plate.waiting, ...plate.coming].map(row => String(row.id)))
  await update($, asked, current => Object.fromEntries(Object.entries(current).filter(([id]) => onPlate.has(id))))
  await update($, view, (): PlateView => ({ kind: 'shown', plate, server, named }))
}

/** What one read found, before the pane shows it, and the boards it found on the way. */
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
      const plate = result.isError ? undefined : plateAmong(blocks)
      if (plate !== undefined) return { kind: 'plate', plate, server, named: servers.length > 1, servers }
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
 * Puts the one question to the person's AI, for a read the person started that the engine refused.
 * While a question is out, nothing more is sent: the pane says it asked. The question goes from a
 * timer, outside the dispatch that asked, so it never waits on a turn that dispatch holds.
 */
async function askTheAI($: EngineInterface): Promise<void> {
  const text = theQuestion()
  let isNew = false
  await update($, question, (current): PlateQuestion => {
    isNew = current.state === 'none'
    return isNew ? { state: 'sending', text, turnId: null } : current
  })
  const out = await read($, question)
  const kind = isNew || out.state === 'sending' ? 'asking' : 'asked'
  await update($, view, (current): PlateView => ({ kind, last: lastOf(current) }))
  if (!isNew) return
  $.clock.after(0, () => {
    void putTheQuestion($, text).catch(() => undefined)
  })
}

/** Submits the question as the person's own words, and says so plainly when it was not taken. */
async function putTheQuestion($: EngineInterface, text: string): Promise<void> {
  let isTaken = false
  try {
    isTaken = (await $.prompt.submit({ text, asUser: true })).drop === undefined
  } catch {
    isTaken = false
  }
  if (isTaken) {
    await update($, question, (current): PlateQuestion => (current.state === 'sending' ? { ...current, state: 'waiting' } : current))
    await update($, view, (current): PlateView => (current.kind === 'asking' ? { kind: 'asked', last: current.last } : current))
    return
  }
  await update($, question, (): PlateQuestion => ({ state: 'none' }))
  await update($, view, (current): PlateView =>
    current.kind === 'asking' || current.kind === 'asked' ? { kind: 'unsent', last: current.last } : current,
  )
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
  let giveUp: () => void = () => {}
  const late = new Promise<'late'>(resolve => {
    giveUp = () => resolve('late')
  })
  const timer = $.clock.after(READ_LIMIT_MS, () => giveUp())
  let found: Found | 'late'
  try {
    found = await Promise.race([findThePlate($), late])
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
    if (by === 'person') await askTheAI($)
  } else if (found.kind === 'blocked') {
    if (by === 'person') await update($, view, (current): PlateView => ({ kind: 'blocked', last: lastOf(current) }))
  } else {
    const kind = found.kind
    await update($, view, (): PlateView => ({ kind }))
  }
}

/**
 * Asks the person's AI to mark one item done, by its number alone. Sent as the person's own words,
 * so it carries nothing anyone else wrote. The row counts as sent only once the session took it.
 */
async function askDone($: EngineInterface, row: PlateRow): Promise<void> {
  const id = String(row.id)
  const now = (await read($, asked))[id]
  if (now === 'sending' || now === 'sent') return
  await update($, asked, (current): Record<string, PlateAsk> => ({ ...current, [id]: 'sending' }))
  let isTaken = false
  try {
    const entered = await $.prompt.submit({ text: `Mark item ${row.id} done.`, asUser: true })
    isTaken = entered.drop === undefined
  } catch {
    isTaken = false
  }
  const outcome: PlateAsk = isTaken ? 'sent' : 'unsent'
  await update($, asked, (current): Record<string, PlateAsk> => ({ ...current, [id]: outcome }))
}

/**
 * Follows the AI's own call to a board, once that call has answered, while the pane is open: a
 * plate it read is drawn, and answers the question if one is out; after anything else the pane
 * reads the board again itself, and never asks the AI.
 */
async function followTheAI($: EngineInterface, plate: PlateReply | undefined, server: string): Promise<void> {
  const current = await read($, view)
  if (current.kind === 'unasked') return
  if (!(await $.ui.panes()).some(pane => pane.id === PANE)) return
  if (plate === undefined) {
    await readPlate($, 'ai')
    return
  }
  const known = await read($, boards)
  await update($, question, (): PlateQuestion => ({ state: 'none' }))
  await show($, plate, server, known.length > 1)
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
          void followTheAI($, undefined, server).catch(() => undefined)
        })
      } else {
        const plate = plateInCall(ran)
        if (plate !== undefined) {
          $.clock.after(0, () => {
            void followTheAI($, plate, server).catch(() => undefined)
          })
        }
      }
    } catch {
      // The AI's call stands whatever happens here; the pane is only ever behind.
    }
    return ran
  }).catch(($, e, next) => next(e))

  // The main loop's turns, once the person has asked: which one runs now, and the question's own,
  // known by its words when it starts. Before the person asks, these do nothing.
  on('turn.start', async ($, e, next) => {
    try {
      if ((await read($, view)).kind !== 'unasked') {
        await update($, runningTurn, () => e.turnId)
        const out = await read($, question)
        if (out.state !== 'none' && out.turnId === null && e.text === out.text) {
          await update($, question, (current): PlateQuestion =>
            current.state !== 'none' && current.turnId === null ? { ...current, turnId: e.turnId } : current,
          )
        }
      }
    } catch {
      // The turn goes on whatever happens here.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A question ends with its own turn or, failing that, with the first main-loop turn to end after
  // the session took it, whatever words that turn opened with: it never stays out for the session.
  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    try {
      if (e.agentId === undefined && (await read($, view)).kind !== 'unasked') {
        await update($, runningTurn, current => (current === e.turnId ? null : current))
        const out = await read($, question)
        if (out.state !== 'none' && (out.turnId === e.turnId || out.state === 'waiting')) {
          await update($, question, (): PlateQuestion => ({ state: 'none' }))
          await update($, view, (current): PlateView =>
            current.kind === 'asking' || current.kind === 'asked' ? { kind: 'unanswered', last: current.last } : current,
          )
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

    const refresh = (
      <Box key="actions" marginTop={1}>
        <Button key="refresh" label="Refresh" onPress={() => readPlate($, 'person')} />
      </Box>
    )

    const done = (item: PlateRow) => <Button key={`done:${item.id}`} label="done" plain onPress={() => askDone($, item)} />

    const askOf = (item: PlateRow) => {
      const ask = asks[String(item.id)]
      if (ask === 'sending') {
        return (
          <Box key={`status:sending:${item.id}`}>
            <Text dimColor>Sending to your AI.</Text>
          </Box>
        )
      }
      if (ask === 'sent') {
        return (
          <Box key={`status:sent:${item.id}`}>
            <Text dimColor>Sent to your AI.</Text>
          </Box>
        )
      }
      if (ask === 'unsent') {
        return (
          <Box gap={1}>
            <Box key={`status:unsent:${item.id}`}>
              <Text>Not sent. Try again.</Text>
            </Box>
            {done(item)}
          </Box>
        )
      }
      return done(item)
    }

    const row = (plate: PlateReply, item: PlateRow) => {
      const marks = marksOf(plate, item)
      return (
        <Box key={`row:${item.id}`} gap={1}>
          <Box key={`datum:row.id:${item.id}`}>
            <Text dimColor>{`#${item.id}`}</Text>
          </Box>
          <Box key={`datum:row.title:${item.id}`} flexShrink={1}>
            <Text>{neutral(item.title)}</Text>
          </Box>
          {marks !== undefined && (
            <Box key={`datum:${marks.source}:mark:${item.id}`}>
              <Text dimColor>{marks.text}</Text>
            </Box>
          )}
          {askOf(item)}
        </Box>
      )
    }

    const body = (plate: PlateReply) => {
      const lines = (plate.plain ?? '').split('\n')
      const sentence = neutral(lines[0] ?? '').trim()
      const isClear = GROUPS.every(group => plate.counts[group.key] === 0)
      const later = lines.find(line => LATER.test(line))
      return (
        <Box flexDirection="column">
          {sentence !== '' && (
            <Box key={isClear ? 'status:sentence' : 'datum:plain:sentence'}>
              <Text bold>{sentence}</Text>
            </Box>
          )}
          {GROUPS.filter(group => plate.counts[group.key] > 0 || plate[group.key].length > 0).map(group => {
            const rows = plate[group.key]
            const more = plate.counts[group.key] - rows.length
            return (
              <Box key={`group:${group.key}`} flexDirection="column" marginTop={1}>
                <Box gap={1}>
                  <Text bold>{group.name}</Text>
                  <Box key={`datum:counts.${group.key}:head`}>
                    <Text dimColor>{String(plate.counts[group.key])}</Text>
                  </Box>
                </Box>
                {rows.map(item => row(plate, item))}
                {more > 0 && (
                  <Box key={`datum:counts.${group.key}:more`}>
                    <Text dimColor>{`And ${more} more.`}</Text>
                  </Box>
                )}
              </Box>
            )
          })}
          {later !== undefined ? (
            <Box key="datum:plain:later" marginTop={1}>
              <Text dimColor>{neutral(later)}</Text>
            </Box>
          ) : (
            plate.counts.later > 0 && (
              <Box key="datum:counts.later:later" marginTop={1}>
                <Text dimColor>{`${plate.counts.later} can wait until later.`}</Text>
              </Box>
            )
          )}
        </Box>
      )
    }

    // The pane's layout with placeholder rows: never an empty plate while one is on its way.
    const placeholders = GROUPS.map(group => (
      <Box key={`group:${group.key}`} flexDirection="column" marginTop={1}>
        <Text bold>{group.name}</Text>
        <Text dimColor>{'\u{b7} \u{b7} \u{b7}'}</Text>
        <Text dimColor>{'\u{b7} \u{b7} \u{b7}'}</Text>
      </Box>
    ))

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
      // The AI answers after its current reply only while some other turn of the main loop runs.
      const running = await read($, runningTurn)
      const out = await read($, question)
      const isBusy = running !== null && (out.state === 'none' || out.turnId !== running)
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
              {isBusy && <Text dimColor>It answers after its current reply.</Text>}
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
