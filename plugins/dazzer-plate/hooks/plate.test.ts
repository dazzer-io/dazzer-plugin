// The plate pane, held to what the person sees and when.
//
// Each test stands up the world beneath the plugin by hand: the tools connected now, what each
// connected server answers, the panes the surface opened, and what reached the conversation. The
// plugin reaches Dazzer only through `$.tool.list` and `$.mcp.call`, so answering those two here is
// answering for the board.
//
// KEPT STATES. `claude plugin test` gives a test no file system, so each state the person can see
// is printed as one line, "kept-state <state>-<surface> <page>", and the proof's
// scripts/kept-states.mjs writes the pages that the words check reads. A page is the drawn tree as
// marked markup: a Box keyed "status..." is a status line (data-status), and one keyed
// "datum:<field>:..." holds a datum from that reply field (data-source).

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PluginOptions, ToolInfo } from 'claude-code'

import type { PlateReply, PlateRow } from '../types'

// The test's environment has a console and timers (no DOM, so its lib declares neither): the
// console is how a kept state leaves the test, and a timer lets a held read be looked at mid-way.
declare const console: { log: (line: string) => void }
declare function setTimeout(run: () => void, ms: number): unknown

const PLUGIN = 'dazzer-plate'
const PANE = 'plate'
const SURFACES = ['terminal', 'desktop'] as const
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const NOT_ASKED = 'the pane drew before the person asked'

const PANE_PROPS = {
  title: 'Your plate',
  isFocused: false,
  bodyColumns: 72,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

/** The person typing /plate and pressing Enter. */
const ASK = {
  command: 'plate',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

const STARTED = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

// ---------------------------------------------------------------------------------------------
// A real plate: Tahel's, as the server answered it on 7 Oct (eval/live-2026-10-07), its plain
// words exactly as plate-words wrote them and its rows as the reply carries them.

const BEN = 842
const GAL = 850
const TAHEL = 843

const PLAIN = [
  'Wed 7 Oct: 29 things need you now, 12 are waiting on someone else and 4 are coming up.',
  '',
  'Needs you now',
  '- #6217 YC application, this week · 62 days late (suggested)',
  '- #6539 Review the trace-before-asking trial · 41 days late',
  '- #6922 Follow up with Noa at Airwallex · 13 days late (suggested)',
  '- #6985 Itzik demo: tentatively Tue 6 Oct 21:00 · 1 day late (suggested)',
  '- #6890 Bar Segev sit-down: Wed 7 Oct 10:30, Shoham · due today',
  '- And 24 more.',
  '',
  'Waiting on someone else',
  '- #6038 Short note to the Versa developers · waiting on Ben for 69 days',
  '- #6039 Re-onboarding the Versa developers · waiting on Ben for 69 days',
  '- #6215 Set up the Dave account and user emails · waiting on Gal for 65 days',
  '- #6464 Chase the three AI-lead calls · waiting on Ben for 52 days',
  "- #6466 Ben's daily LinkedIn comment · waiting on Ben for 52 days",
  '- And 7 more.',
  '',
  'Coming up',
  '- #7236 Ron Snir follow-up, Fri 9 Oct · due Fri 9 Oct',
  '- #6456 Accelerator applications · due Sat 10 Oct',
  '- #7060 Email Amir Shevat before his 13 Oct Google talk · due Tue 13 Oct',
  '- #7171 Applications and LinkedIn after the route call · due Thu 15 Oct (suggested)',
  '',
  '35 more things can wait until later.',
  '',
  'To act on one, tell me its number and say done.',
].join('\n')

const NOW: PlateRow[] = [
  { id: 6217, title: 'YC application, this week', why: 'late', due: '2026-08-06', days_late: 62, due_suggested: true },
  { id: 6539, title: 'Review the trace-before-asking trial', why: 'late', due: '2026-08-27', days_late: 41 },
  { id: 6922, title: 'Follow up with Noa at Airwallex', why: 'late', due: '2026-09-24', days_late: 13, due_suggested: true },
  { id: 6985, title: 'Itzik demo: tentatively Tue 6 Oct 21:00', why: 'late', due: '2026-10-06', days_late: 1, due_suggested: true },
  { id: 6890, title: 'Bar Segev sit-down: Wed 7 Oct 10:30, Shoham', why: 'today', due: '2026-10-07' },
]
const WAITING: PlateRow[] = [
  { id: 6038, title: 'Short note to the Versa developers', why: 'handed', on: BEN, since: '2026-07-30T08:00:00Z' },
  { id: 6039, title: 'Re-onboarding the Versa developers', why: 'handed', on: BEN, since: '2026-07-30T08:00:00Z' },
  { id: 6215, title: 'Set up the Dave account and user emails', why: 'waiting', on: GAL, since: '2026-08-03T08:00:00Z' },
  { id: 6464, title: 'Chase the three AI-lead calls', why: 'handed', on: BEN, since: '2026-08-16T08:00:00Z' },
  { id: 6466, title: "Ben's daily LinkedIn comment", why: 'handed', on: BEN, since: '2026-08-16T08:00:00Z' },
]
const COMING: PlateRow[] = [
  { id: 7236, title: 'Ron Snir follow-up, Fri 9 Oct', why: 'due', due: '2026-10-09' },
  { id: 6456, title: 'Accelerator applications', why: 'due', due: '2026-10-10' },
  { id: 7060, title: 'Email Amir Shevat before his 13 Oct Google talk', why: 'due', due: '2026-10-13' },
  { id: 7171, title: 'Applications and LinkedIn after the route call', why: 'due', due: '2026-10-15', due_suggested: true },
]

const PLATE: PlateReply = {
  view: 'plate',
  as_of: '2026-10-07T06:12:03Z',
  today: '2026-10-07',
  time_zone: 'Asia/Jerusalem',
  counts: { now: 29, waiting: 12, coming: 4, later: 35 },
  now: NOW,
  waiting: WAITING,
  coming: COMING,
  people: { [String(BEN)]: 'Ben', [String(GAL)]: 'Gal', [String(TAHEL)]: 'Tahel' },
  plain: PLAIN,
}

/** The same plate after 7236 was marked done. */
const PLATE_AFTER: PlateReply = {
  ...PLATE,
  as_of: '2026-10-07T06:20:00Z',
  counts: { ...PLATE.counts, coming: 3 },
  coming: COMING.filter(row => row.id !== 7236),
  plain: PLAIN.replace('- #7236 Ron Snir follow-up, Fri 9 Oct · due Fri 9 Oct\n', '').replace(
    'and 4 are coming up',
    'and 3 are coming up',
  ),
}

const EMPTY: PlateReply = {
  view: 'plate',
  as_of: '2026-10-07T06:12:03Z',
  today: '2026-10-07',
  time_zone: 'Asia/Jerusalem',
  counts: { now: 0, waiting: 0, coming: 0, later: 0 },
  now: [],
  waiting: [],
  coming: [],
  people: {},
  plain: 'Wed 7 Oct: all clear.',
}

// ---------------------------------------------------------------------------------------------
// The world beneath the plugin.

type McpAnswer = { content: { type: string; text?: string }[]; isError: boolean }
/** What one server's recall answers: a result, or a refusal of the call itself. */
type ServerAnswer = McpAnswer | { refuse: string }

const answered = (body: unknown, isError = false): McpAnswer => ({
  content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
  isError,
})

const tool = (name: string, mcp = true): ToolInfo => ({ name, description: name, mcp })
const DAZZER_TOOLS = [tool('Read', false), tool('mcp__dazzer__recall'), tool('mcp__dazzer__track')]

type Call = { server: string; tool: string; args: Record<string, unknown> }

type World = {
  opened: unknown[]
  calls: Call[]
  said: { text: string; origin: unknown }[]
  statuses: unknown[]
  registered: string[]
  /** Holds the next recall until `release` is called. */
  hold: () => void
  release: () => void
}

/**
 * Registers the world beneath the plugin. `servers` answers each server's calls in turn: the
 * first call gets the first answer, and the last answer repeats.
 */
function world(on: On, tools: ToolInfo[], servers: Record<string, ServerAnswer[]>): World {
  let gate: Promise<void> | undefined
  let open: () => void = () => {}
  const turns: Record<string, number> = {}
  const w: World = {
    opened: [],
    calls: [],
    said: [],
    statuses: [],
    registered: [],
    hold: () => {
      gate = new Promise<void>(resolve => {
        open = resolve
      })
    },
    release: () => {
      gate = undefined
      open()
    },
  }
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    w.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('tool.list', () => ({ value: tools }))
  on('mcp.call', async ($, e) => {
    w.calls.push({ server: e.server, tool: e.tool, args: e.args })
    if (gate !== undefined) await gate
    const answers = servers[e.server] ?? [{ refuse: `no server called ${e.server}` }]
    const at = turns[e.server] ?? 0
    turns[e.server] = at + 1
    const answer = answers[Math.min(at, answers.length - 1)]!
    return 'refuse' in answer ? { deny: answer.refuse } : { value: answer }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({
    value: w.opened.length === 0 ? [] : [{ id: PANE, title: 'Your plate', isShown: true, isFocused: false, isPlaced: true }],
  }))
  on('ui.status', ($, e) => {
    w.statuses.push(e)
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    w.said.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })
  // The session's own calls, as the AI makes them: its plate, and marking an item done.
  on('tool.call', ($, e) => {
    if (e.tool === 'mcp__dazzer__recall') return { result: answered(PLATE_AFTER), text: JSON.stringify(PLATE_AFTER) }
    return { result: answered({ done: true }), text: 'Marked item 7236 done.' }
  })
  return w
}

/** The surface drawing the pane, as it does once the pane is open. */
const mount = (engine: Engine, surface: (typeof SURFACES)[number]) =>
  engine.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })

// ---------------------------------------------------------------------------------------------
// Reading a drawing.

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** Every word the drawing shows, in order: string children and each Button's label. */
function wordsOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (node === null || typeof node !== 'object') return ''
  const el = node as Node
  const label = el.type === 'Button' && typeof el.props?.label === 'string' ? ` ${el.props.label} ` : ''
  return `${label}${(el.children ?? []).map(wordsOf).join(' ')}`.replace(/\s+/g, ' ').trim()
}

/** Every element of a type in the drawing. */
function allOf(node: unknown, type: string): Node[] {
  if (node === null || typeof node !== 'object') return []
  const el = node as Node
  const mine = el.type === type ? [el] : []
  return [...mine, ...(el.children ?? []).flatMap(child => allOf(child, type))]
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A Box's key says what it holds: a status line, or a datum from one reply field. */
function marksOf(key: unknown): string {
  if (typeof key !== 'string') return ''
  if (key.startsWith('status')) return ' data-status'
  const datum = /^datum:([^:]+):/.exec(key)
  return datum ? ` data-source="${escape(datum[1]!)}"` : ''
}

/** The drawn tree as marked markup, element for element. */
function markup(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return escape(String(node))
  if (node === null || typeof node !== 'object') return ''
  const el = node as Node
  const inner = (el.children ?? []).map(markup).join('')
  if (el.type === 'Box') return `<div${marksOf(el.props?.key)}>${inner}</div>`
  if (el.type === 'Button') return `<button>${escape(String(el.props?.label ?? ''))}${inner}</button>`
  return `<span>${inner}</span>`
}

/** Prints one kept state as the one line scripts/kept-states.mjs turns into a page. */
async function keep(state: string, ui: { surface: string; drawn: () => Promise<unknown> }) {
  const page = `<!doctype html><html lang="en"><meta charset="utf-8"><body>${markup(await ui.drawn())}</body></html>`
  console.log(`kept-state ${state}-${ui.surface} ${encodeURIComponent(page)}`)
}

const textAt = async (ui: { find: (q: { key: string }) => Promise<unknown> }, key: string) =>
  wordsOf(await ui.find({ key }))

// ---------------------------------------------------------------------------------------------

test('nothing draws before the person asks', async ($, on) => {
  const w = world(on, DAZZER_TOOLS, { dazzer: [answered(PLATE)] })
  await $.session.start(STARTED)
  // The AI reads the plate and marks an item done in the same session: still nobody asked.
  await $.tool.call({ tool: 'mcp__dazzer__recall', tool_use_id: 't1', query: 'what is on my plate', view: 'plate' })
  await $.tool.call({ tool: 'mcp__dazzer__track', tool_use_id: 't2', id: 7236 })

  expect(w.opened, NOT_ASKED).toEqual([])
  expect(w.statuses, NOT_ASKED).toEqual([])
  expect(w.calls, NOT_ASKED).toEqual([])
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(wordsOf(await ui.drawn()), NOT_ASKED).toBe('')
    await ui.unmount()
  }
  expect(w.registered).toEqual(['plate'])
})

test('/plate finds the board among the connected tools and reads the plate once', async ($, on) => {
  const w = world(on, [...DAZZER_TOOLS, tool('mcp__figma__get_screenshot')], { dazzer: [answered(PLATE)] })
  await $.session.start(STARTED)
  await $.command.run(ASK)

  expect(w.opened).toEqual([expect.objectContaining({ id: PANE })])
  expect(w.calls).toEqual([
    {
      server: 'dazzer',
      tool: 'recall',
      args: { query: 'what is on my plate', view: 'plate', time_zone: ZONE, conversation: 'plate-pane' },
    },
  ])
  expect(ZONE.length).toBeGreaterThan(0)
})

test('with no board connected it says so in one line, and how to connect it', async ($, on) => {
  const w = world(on, [tool('Read', false), tool('mcp__figma__get_screenshot')], {})
  await $.session.start(STARTED)
  await $.command.run(ASK)

  expect(w.calls).toEqual([])
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await textAt(ui, 'status:absent')).toBe('Dazzer is not connected here.')
    expect(wordsOf(await ui.drawn())).toContain('/plugin install dazzer-connect@dazzer')
    expect(wordsOf(await ui.drawn())).not.toContain('Needs you now')
    expect(allOf(await ui.drawn(), 'Button').map(b => b.props?.key)).toEqual(['refresh'])
    await keep('not-connected', ui)
    await ui.unmount()
  }
})

test('a plate is drawn with its groups on the terminal and the desktop', async ($, on) => {
  const w = world(on, DAZZER_TOOLS, { dazzer: [answered(PLATE)] })
  await $.session.start(STARTED)
  await $.command.run(ASK)

  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const drawn = await ui.drawn()
    expect(await textAt(ui, 'datum:plain:sentence')).toBe(
      'Wed 7 Oct: 29 things need you now, 12 are waiting on someone else and 4 are coming up.',
    )
    expect(await textAt(ui, 'group:now')).toStartWith('Needs you now 29')
    expect(await textAt(ui, 'group:waiting')).toStartWith('Waiting on someone else 12')
    expect(await textAt(ui, 'group:coming')).toStartWith('Coming up 4')
    expect(await textAt(ui, 'datum:counts.now:more')).toBe('And 24 more.')
    expect(await textAt(ui, 'datum:counts.waiting:more')).toBe('And 7 more.')
    expect(await ui.find({ key: 'datum:counts.coming:more' })).toBeUndefined()
    expect(await textAt(ui, 'datum:plain:later')).toBe('35 more things can wait until later.')

    // Each row: its number, its title as written, its time mark, (suggested) where marked.
    expect(await textAt(ui, 'datum:row.id:6217')).toBe('#6217')
    expect(await textAt(ui, 'datum:row.title:6217')).toBe('YC application, this week')
    expect(await textAt(ui, 'datum:plain:mark:6217')).toBe('62 days late (suggested)')
    expect(await textAt(ui, 'datum:plain:mark:6890')).toBe('due today')
    expect(await textAt(ui, 'datum:plain:mark:6215')).toBe('waiting on Gal for 65 days')
    expect(await textAt(ui, 'datum:row.title:7236')).toBe('Ron Snir follow-up, Fri 9 Oct')
    expect(await textAt(ui, 'datum:plain:mark:7171')).toBe('due Thu 15 Oct (suggested)')

    // Every row offers done, the pane offers refresh, and nothing else is a control or a link.
    const buttons = allOf(drawn, 'Button').map(b => b.props?.key)
    expect(buttons).toEqual([...NOW, ...WAITING, ...COMING].map(row => `done:${row.id}`).concat('refresh'))
    expect(allOf(drawn, 'Link')).toEqual([])
    expect(allOf(drawn, 'Markdown')).toEqual([])
    expect(wordsOf(drawn)).not.toMatch(/\u2014/)
    await keep('plate', ui)
    await ui.unmount()
  }
  expect(w.calls).toHaveLength(1)
})

test('while the plate is read, the pane shows its layout and never an empty plate', async ($, on) => {
  const w = world(on, DAZZER_TOOLS, { dazzer: [answered(PLATE)] })
  await $.session.start(STARTED)
  w.hold()
  const asking = $.command.run(ASK)
  while (w.calls.length === 0) await new Promise<void>(resolve => setTimeout(resolve, 5))

  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await textAt(ui, 'status:loading')).toBe('Reading your plate.')
    expect(wordsOf(await ui.drawn())).toContain('Needs you now')
    expect(wordsOf(await ui.drawn())).not.toContain('all clear')
    expect(allOf(await ui.drawn(), 'Button').map(b => b.props?.key)).toEqual(['refresh'])
    await keep('loading', ui)
    await ui.unmount()
  }
  w.release()
  await asking
})

test('a failed read says so in one line and never shows an empty plate', async ($, on) => {
  world(on, DAZZER_TOOLS, { dazzer: [{ refuse: 'connection refused' }] })
  await $.session.start(STARTED)
  await $.command.run(ASK)

  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await textAt(ui, 'status:failed')).toBe('Could not reach Dazzer.')
    expect(wordsOf(await ui.drawn())).not.toContain('Needs you now')
    expect(wordsOf(await ui.drawn())).not.toContain('all clear')
    await keep('failed', ui)
    await ui.unmount()
  }
})

test('a failed refresh keeps the last plate and says when it was read', async ($, on) => {
  const w = world(on, DAZZER_TOOLS, { dazzer: [answered(PLATE), { refuse: 'connection refused' }] })
  await $.session.start(STARTED)
  await $.command.run(ASK)

  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    if (surface === 'terminal') await ui.press({ key: 'refresh' })
    expect(await textAt(ui, 'status:failed')).toBe('Could not reach Dazzer.')
    expect(await textAt(ui, 'datum:as_of:last')).toMatch(/^as of [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}$/)
    expect(await textAt(ui, 'datum:row.title:6217')).toBe('YC application, this week')
    await keep('failed-last', ui)
    await ui.unmount()
  }
  expect(w.calls).toHaveLength(2)
})

test('refresh reads the plate again', async ($, on) => {
  const w = world(on, DAZZER_TOOLS, { dazzer: [answered(PLATE), answered(PLATE_AFTER)] })
  await $.session.start(STARTED)
  await $.command.run(ASK)

  const ui = await mount($, 'desktop')
  expect(await ui.find({ key: 'row:7236' })).toBeDefined()
  await ui.press({ key: 'refresh' })
  expect(w.calls).toHaveLength(2)
  expect(await ui.find({ key: 'row:7236' })).toBeUndefined()
  expect(await textAt(ui, 'group:coming')).toStartWith('Coming up 3')
})

test('done asks the AI to mark the item done, and the pane never writes to the board', async ($, on) => {
  const w = world(on, DAZZER_TOOLS, { dazzer: [answered(PLATE)] })
  await $.session.start(STARTED)
  await $.command.run(ASK)

  // Pressed on each surface in turn: each press is a row of its own, so both reach the AI.
  for (const [surface, id, sentence] of [
    ['terminal', 7236, 'Mark item 7236, Ron Snir follow-up, Fri 9 Oct, done'],
    ['desktop', 6217, 'Mark item 6217, YC application, this week, done'],
  ] as const) {
    const ui = await mount($, surface)
    await ui.press({ key: `done:${id}` })
    expect(w.said.at(-1)).toEqual({ text: sentence, origin: { kind: 'plugin', name: PLUGIN, asUser: true } })
    expect(await ui.find({ key: `done:${id}` })).toBeUndefined()
    expect(await textAt(ui, `status:sent:${id}`)).toBe('Sent to your AI.')
    // A row already sent stays sent wherever the pane is drawn.
    expect(await ui.find({ key: 'done:7236' })).toBeUndefined()
    expect(await textAt(ui, 'status:sent:7236')).toBe('Sent to your AI.')
    await keep('done-sent', ui)
    await ui.unmount()
  }
  expect(w.said).toHaveLength(2)
  expect(w.calls.map(call => call.tool)).toEqual(['recall'])
})

test("the session's own calls refresh an open pane", async ($, on) => {
  const w = world(on, DAZZER_TOOLS, { dazzer: [answered(PLATE), answered(PLATE_AFTER)] })
  await $.session.start(STARTED)
  await $.command.run(ASK)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ key: 'row:7236' })).toBeDefined()

  // The AI marks it done: the pane reads the plate again.
  await $.tool.call({ tool: 'mcp__dazzer__track', tool_use_id: 't1', id: 7236 })
  expect(w.calls).toHaveLength(2)
  expect(await ui.find({ key: 'row:7236' })).toBeUndefined()

  // The AI reads the plate itself: the pane draws that answer without a call of its own.
  await $.tool.call({ tool: 'mcp__dazzer__recall', tool_use_id: 't2', query: 'what is on my plate' })
  expect(w.calls).toHaveLength(2)
  expect(await textAt(ui, 'group:coming')).toStartWith('Coming up 3')
})

test('nothing on the plate is one plain line', async ($, on) => {
  world(on, DAZZER_TOOLS, { dazzer: [answered(EMPTY)] })
  await $.session.start(STARTED)
  await $.command.run(ASK)

  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await textAt(ui, 'status:sentence')).toBe('Wed 7 Oct: all clear.')
    expect(wordsOf(await ui.drawn())).not.toContain('Needs you now')
    expect(allOf(await ui.drawn(), 'Button').map(b => b.props?.key)).toEqual(['refresh'])
    await keep('empty', ui)
    await ui.unmount()
  }
})

test('a board with the plate switched off says so in one line', async ($, on) => {
  const off = answered(
    { reason_code: 'invalid_input', what: 'The plate is not switched on in this memory, so it cannot be shown here.' },
    true,
  )
  world(on, DAZZER_TOOLS, { dazzer: [off] })
  await $.session.start(STARTED)
  await $.command.run(ASK)

  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await textAt(ui, 'status:off')).toBe('Your plate is switched off.')
    expect(wordsOf(await ui.drawn())).not.toContain('Needs you now')
    await keep('off', ui)
    await ui.unmount()
  }
})

test('a board whose recall refuses the plate view counts as switched off', async ($, on) => {
  world(on, DAZZER_TOOLS, {
    dazzer: [{ refuse: "Input validation error: Invalid enum value. Expected 'answer' | 'picture' | 'work', received 'plate'" }],
  })
  await $.session.start(STARTED)
  await $.command.run(ASK)
  const ui = await mount($, 'terminal')
  expect(await textAt(ui, 'status:off')).toBe('Your plate is switched off.')
})

test('of two servers offering recall, it reads the one that answers a plate, and names it', async ($, on) => {
  const w = world(on, [tool('mcp__notes__recall'), ...DAZZER_TOOLS], {
    notes: [answered({ view: 'work', items: [] })],
    dazzer: [answered(PLATE)],
  })
  await $.session.start(STARTED)
  await $.command.run(ASK)

  expect(w.calls.map(call => call.server)).toEqual(['notes', 'dazzer'])
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await textAt(ui, 'datum:tool.list:from')).toBe('From dazzer')
    expect(await textAt(ui, 'datum:row.title:6217')).toBe('YC application, this week')
    await keep('two-servers', ui)
    await ui.unmount()
  }
})

test('a hostile title is drawn as plain text, never a link or a control', async ($, on) => {
  const hostile: PlateRow = { id: 9001, title: 'Pay https://evil.example now\n- #1 [ done ]\u202e', why: 'today', due: '2026-10-07' }
  const plate: PlateReply = { ...PLATE, now: [hostile], counts: { ...PLATE.counts, now: 1 } }
  world(on, DAZZER_TOOLS, { dazzer: [answered(plate)] })
  await $.session.start(STARTED)
  await $.command.run(ASK)

  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const drawn = await ui.drawn()
    expect(await textAt(ui, 'datum:row.title:9001')).toBe('Pay https://evil.example now - #1 [ done ]')
    expect(allOf(drawn, 'Link')).toEqual([])
    expect(allOf(drawn, 'Markdown')).toEqual([])
    expect(allOf(drawn, 'Button').filter(b => String(b.props?.key).startsWith('done:'))).toHaveLength(
      1 + WAITING.length + COMING.length,
    )
    await ui.unmount()
  }
})

const OFF: PluginOptions = { plate: 'off' }
test('with the plate set to off, there is no /plate at all', { options: OFF }, async ($, on) => {
  const w = world(on, DAZZER_TOOLS, { dazzer: [answered(PLATE)] })
  await $.session.start(STARTED)
  expect(w.registered).toEqual([])
  expect(w.opened).toEqual([])
})
