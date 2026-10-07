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
// WHO WRITES. Never this pane. A row's done sends the person's AI one sentence carrying the item's
// number and nothing else ("Mark item 7236 done."); the AI marks it done through its own
// connection. The title never travels with it: anyone in the workspace can write a title, and done
// speaks as the person. A row counts as sent only once the session took that sentence, and stays
// sent until its item leaves the plate, so a read in between can never offer it twice. After the
// AI's own call to the board has answered, the pane reads the plate again, never holding that call.
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

import type { PlateAsk, PlateReply, PlateRow, PlateView } from '../types'

/** The one pane, by id and title. */
const PANE = 'plate'
const TITLE = 'Your plate'
/** What the pane asks the board, in the person's own words, and the conversation it names. */
const WORDS = 'what is on my plate'
const CONVERSATION = 'plate-pane'
/** How long one read of the plate may take before the pane says it could not reach Dazzer. */
const READ_LIMIT_MS = 20_000
/** A connected server's tools, as the session names them. */
const RECALL = /^mcp__(.+)__recall$/
/** Between a row's title and its marks, in the board's plain words. */
const MARK = ' \u{b7} '
/** The reply's own line for how much can wait. */
const LATER = /^\d+ (more )?things? can wait until later\.$/
const BACKSLASH = '\x5c'

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
const board = atom({ plugin: 'dazzer-plate', key: 'board' } as const, null as string | null)

/** The newest read; an older one that answers late changes nothing. */
let newestRead = 0

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
const lastOf = (current: PlateView): PlateReply | null =>
  current.kind === 'shown' ? current.plate : current.kind === 'failed' ? current.last : null

/**
 * Shows a plate that was read. A row's done stays where it stood while its item is still on the
 * plate, and is forgotten once the item has left it.
 */
async function show($: EngineInterface, plate: PlateReply, server: string, named: boolean): Promise<void> {
  const onPlate = new Set([...plate.now, ...plate.waiting, ...plate.coming].map(row => String(row.id)))
  await update($, asked, current => Object.fromEntries(Object.entries(current).filter(([id]) => onPlate.has(id))))
  await update($, board, () => server)
  await update($, view, (): PlateView => ({ kind: 'shown', plate, server, named }))
}

/** What one read found, before the pane shows it. */
type Found =
  | { kind: 'plate'; plate: PlateReply; server: string; named: boolean }
  | { kind: 'absent' }
  | { kind: 'off' }
  | { kind: 'failed' }

/** Finds the board among the connected tools and asks it for the plate; changes nothing. */
async function findThePlate($: EngineInterface): Promise<Found> {
  let servers: string[]
  try {
    servers = boardsAmong(await $.tool.list())
  } catch {
    return { kind: 'failed' }
  }
  if (servers.length === 0) return { kind: 'absent' }
  const zone = machineZone()
  const args = { query: WORDS, view: 'plate', ...(zone === undefined ? {} : { time_zone: zone }), conversation: CONVERSATION }
  let isFailed = false
  let isOff = false
  for (const server of servers) {
    let words: string
    try {
      const result = await $.mcp.call(server, 'recall', args)
      const blocks = blocksOf(result)
      const plate = result.isError ? undefined : plateAmong(blocks)
      if (plate !== undefined) return { kind: 'plate', plate, server, named: servers.length > 1 }
      // Answered, and not with a plate: a server that is not this person's board.
      if (!result.isError) continue
      words = blocks.join('\n')
    } catch (error) {
      words = error instanceof Error ? error.message : String(error)
    }
    if (namesThePlate(words)) isOff = true
    else isFailed = true
  }
  return isFailed ? { kind: 'failed' } : isOff ? { kind: 'off' } : { kind: 'absent' }
}

/**
 * Reads the plate and shows what it found, within READ_LIMIT_MS: a read that has not answered by
 * then ends in the failed line, with the last plate this session read. A newer read wins over an
 * older one that answers late.
 */
async function readPlate($: EngineInterface): Promise<void> {
  newestRead += 1
  const mine = newestRead
  let giveUp: () => void = () => {}
  const late = new Promise<'late'>(resolve => {
    giveUp = () => resolve('late')
  })
  const timer = $.clock.after(READ_LIMIT_MS, () => giveUp())
  const found = await Promise.race([findThePlate($), late])
  timer.cancel()
  if (mine !== newestRead) return
  if (found === 'late' || found.kind === 'failed') {
    await update($, view, (current): PlateView => ({ kind: 'failed', last: lastOf(current) }))
  } else if (found.kind === 'plate') {
    await show($, found.plate, found.server, found.named)
  } else {
    if (found.kind === 'absent') await update($, board, () => null)
    await update($, view, (): PlateView => ({ kind: found.kind }))
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
 * Follows the AI's own call to the board, once that call has answered: a plate it read is drawn,
 * and after anything else the pane reads the plate again. Only while the pane is open.
 */
async function followTheAI($: EngineInterface, plate: PlateReply | undefined): Promise<void> {
  const current = await read($, view)
  if (current.kind === 'unasked') return
  if (!(await $.ui.panes()).some(pane => pane.id === PANE)) return
  if (plate === undefined) {
    await readPlate($)
    return
  }
  const server = await read($, board)
  if (server !== null) await show($, plate, server, current.kind === 'shown' && current.named)
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
    await readPlate($)
    return { text: opened.isPlaced ? 'Your plate is open.' : 'Your plate opens as soon as there is room for it.' }
  })

  // The AI's own calls to the board. Its call answers first, untouched; what the pane does about
  // it runs afterwards, from a timer, so the AI never waits on the pane.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      const server = await read($, board)
      if (server === null) return ran
      const name = String(e.tool)
      if (name === `mcp__${server}__track`) {
        $.clock.after(0, () => {
          void followTheAI($, undefined).catch(() => undefined)
        })
      } else if (name === `mcp__${server}__recall`) {
        const plate = plateInCall(ran)
        if (plate !== undefined) {
          $.clock.after(0, () => {
            void followTheAI($, plate).catch(() => undefined)
          })
        }
      }
    } catch {
      // The AI's call stands whatever happens here; the pane is only ever behind.
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await read($, view)
    const { Box, Text, Button } = $.ui.resolve(e)
    if (current.kind === 'unasked') return <Box />
    const asks = await read($, asked)

    const refresh = (
      <Box key="actions" marginTop={1}>
        <Button key="refresh" label="Refresh" onPress={() => readPlate($)} />
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

    if (current.kind === 'loading') {
      return (
        <Box flexDirection="column">
          <Box key="status:loading">
            <Text dimColor>Reading your plate.</Text>
          </Box>
          {GROUPS.map(group => (
            <Box key={`group:${group.key}`} flexDirection="column" marginTop={1}>
              <Text bold>{group.name}</Text>
              <Text dimColor>{'\u{b7} \u{b7} \u{b7}'}</Text>
              <Text dimColor>{'\u{b7} \u{b7} \u{b7}'}</Text>
            </Box>
          ))}
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
