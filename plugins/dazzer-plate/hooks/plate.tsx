// The plate pane: a person's plate from their Dazzer board, drawn beside the chat when they ask.
//
// WHEN IT DRAWS. Only once the person asks: /plate, or the pane's own refresh once it is open.
// Nothing here opens a pane, reads the board or sets a status line from the session's start, a
// timer or anything the AI does on its own; until the person asks, the pane's state is "unasked"
// and it draws nothing.
//
// HOW IT READS. It holds no connection and no credentials. It finds the board among the tools the
// session already has connected (any server offering `recall`) and calls that server's `recall` for
// the plate view through the session's own connection (`$.mcp.call`). The first server whose answer
// is a plate is the board.
//
// WHO WRITES. Never this pane. A row's done sends the person's AI one sentence carrying the item's
// number and title; the AI marks it done through its own connection, and the pane reads the plate
// again once the AI's own call has run.
//
// WHOSE WORDS. The counted sentence, each row's marks and the later line are the board's own plain
// words, taken from the reply's `plain`; a title is drawn as its writer wrote it, through the same
// one neutralising pass the board applies, and only ever as plain text, never as a link or a
// control.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, McpToolResult, Register, ToolInfo } from 'claude-code'

import type { PlateReply, PlateRow, PlateView } from '../types'

/** The one pane, by id and title. */
const PANE = 'plate'
const TITLE = 'Your plate'
/** What the pane asks the board, in the person's own words, and the conversation it names. */
const WORDS = 'what is on my plate'
const CONVERSATION = 'plate-pane'
/** The last plate read, kept on this machine so a failed read can still show it, with its time. */
const LAST_PLATE = 'last-plate'
/** A connected server's recall tool, as the session names it. */
const RECALL = /^mcp__(.+)__recall$/
/** Between a row's title and its marks, in the board's plain words. */
const MARK = ' \u{b7} '

/** The groups, in the order a person reads them, named by what they ask of the person. */
const GROUPS = [
  { key: 'now', name: 'Needs you now' },
  { key: 'waiting', name: 'Waiting on someone else' },
  { key: 'coming', name: 'Coming up' },
] as const

/** The line that says how to connect, as the README's connection step says it. */
const CONNECT =
  'To connect it, type /plugin install dazzer-connect@dazzer in Claude Code in a terminal, then restart and sign in.'

const view = atom({ plugin: 'dazzer-plate', key: 'view' } as const, { kind: 'unasked' } as PlateView)
const sent = atom({ plugin: 'dazzer-plate', key: 'sent' } as const, [] as number[])
const board = atom({ plugin: 'dazzer-plate', key: 'board' } as const, null as string | null)

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

/** The servers offering recall, each once, in the order the session lists its tools. */
function boardsAmong(tools: readonly ToolInfo[]): string[] {
  const found: string[] = []
  for (const tool of tools) {
    if (!tool.mcp) continue
    const server = RECALL.exec(tool.name)?.[1]
    if (server !== undefined && !found.includes(server)) found.push(server)
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

/** The plate a reply's words hold, when they are one. */
function plateIn(text: string | undefined): PlateReply | undefined {
  if (text === undefined) return undefined
  try {
    return asPlate(JSON.parse(text))
  } catch {
    return undefined
  }
}

const wordsOf = (result: McpToolResult) =>
  result.content.map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('')

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
 * A row's marks in the board's own words: its line in `plain`, after its number and title. When the
 * words do not carry the row, what the reply marks as suggested still shows.
 */
function marksOf(plate: PlateReply, row: PlateRow): { text: string; source: string } | undefined {
  const head = `- #${row.id} ${neutral(row.title)}`
  const line = (plate.plain ?? '').split('\n').find(one => one === head || one.startsWith(head + MARK))
  if (line !== undefined && line.length > head.length) {
    return { text: line.slice(head.length + MARK.length), source: 'plain' }
  }
  const flag = (['due_suggested', 'waiting_suggested', 'doer_suggested'] as const).find(name => row[name] === true)
  return flag === undefined ? undefined : { text: '(suggested)', source: `row.${flag}` }
}

/** Shows a plate that was read, keeps it as the last one, and forgets which rows went to the AI. */
async function show($: EngineInterface, plate: PlateReply, server: string, named: boolean): Promise<void> {
  // Kept for a failed read later; a store that will not take it never stops the plate showing.
  await $.store.set(LAST_PLATE, plate).catch(() => undefined)
  await update($, sent, () => [])
  await update($, board, () => server)
  await update($, view, (): PlateView => ({ kind: 'shown', plate, server, named }))
}

/**
 * Reads the plate: finds the board among the connected tools and asks it. What it finds becomes
 * the pane's state; a read that fails keeps the last plate to show, never an empty one.
 */
async function readPlate($: EngineInterface): Promise<void> {
  const failed = async () => {
    const last = asPlate(await $.store.get(LAST_PLATE).catch(() => undefined)) ?? null
    await update($, view, (): PlateView => ({ kind: 'failed', last }))
  }
  let servers: string[]
  try {
    servers = boardsAmong(await $.tool.list())
  } catch {
    await failed()
    return
  }
  if (servers.length === 0) {
    await update($, board, () => null)
    await update($, view, (): PlateView => ({ kind: 'absent' }))
    return
  }
  const zone = machineZone()
  const args = { query: WORDS, view: 'plate', ...(zone === undefined ? {} : { time_zone: zone }), conversation: CONVERSATION }
  let isFailed = false
  let isOff = false
  for (const server of servers) {
    let words: string
    try {
      const result = await $.mcp.call(server, 'recall', args)
      words = wordsOf(result)
      const plate = result.isError ? undefined : plateIn(words)
      if (plate !== undefined) {
        await show($, plate, server, servers.length > 1)
        return
      }
      // Answered, and not with a plate: a server that is not the board.
      if (!result.isError) continue
    } catch (error) {
      words = error instanceof Error ? error.message : String(error)
    }
    if (namesThePlate(words)) isOff = true
    else isFailed = true
  }
  if (isFailed) {
    await failed()
  } else if (isOff) {
    await update($, view, (): PlateView => ({ kind: 'off' }))
  } else {
    await update($, board, () => null)
    await update($, view, (): PlateView => ({ kind: 'absent' }))
  }
}

/** Asks the person's AI to mark one item done, in a sentence carrying its number and title. */
async function askDone($: EngineInterface, row: PlateRow): Promise<void> {
  await update($, sent, ids => (ids.includes(row.id) ? ids : [...ids, row.id]))
  await $.prompt.submit({ text: `Mark item ${row.id}, ${neutral(row.title)}, done`, asUser: true })
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

  // The AI's own calls to the board, once the person has the pane open: after it marks an item, the
  // pane reads the plate again; when it reads the plate itself, the pane draws that answer.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      const server = await read($, board)
      if (server === null) return ran
      const name = String(e.tool)
      const isTrack = name === `mcp__${server}__track`
      const isRecall = name === `mcp__${server}__recall`
      if (!isTrack && !isRecall) return ran
      const current = await read($, view)
      if (current.kind === 'unasked') return ran
      if (!(await $.ui.panes()).some(pane => pane.id === PANE)) return ran
      if (isTrack) {
        await readPlate($)
        return ran
      }
      const plate = ran.isError === true ? undefined : plateIn(ran.text)
      if (plate !== undefined) await show($, plate, server, current.kind === 'shown' && current.named)
    } catch {
      // The AI's call stands whatever happens here; the pane is only ever behind.
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await read($, view)
    const { Box, Text, Button } = $.ui.resolve(e)
    if (current.kind === 'unasked') return <Box />
    const sentIds = await read($, sent)

    const refresh = (
      <Box key="actions" marginTop={1}>
        <Button key="refresh" label="Refresh" onPress={() => readPlate($)} />
      </Box>
    )

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
          {sentIds.includes(item.id) ? (
            <Box key={`status:sent:${item.id}`}>
              <Text dimColor>Sent to your AI.</Text>
            </Box>
          ) : (
            <Button key={`done:${item.id}`} label="done" plain onPress={() => askDone($, item)} />
          )}
        </Box>
      )
    }

    const body = (plate: PlateReply) => {
      const lines = (plate.plain ?? '').split('\n')
      const sentence = neutral(lines[0] ?? '').trim()
      const isClear = GROUPS.every(group => plate.counts[group.key] === 0)
      const later = lines.find(line => /can wait until later\.$/.test(line))
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
              <Text>Dazzer is not connected here.</Text>
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
