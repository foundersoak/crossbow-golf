// Outbox behavior: coalescing, ack-only deletion, and survival of edits
// that happen while a flush is in the air.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Browser globals the outbox modules expect.
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k)
})

const { enqueue, flushRound, pendingForRound, pendingCount } = await import('../src/lib/outbox')

function ack(ids: string[], serverTime = Date.now()) {
  return {
    ok: true,
    json: async () => ({
      ackedWriteIds: ids,
      rejected: [],
      cells: [],
      serverTime
    })
  } as Response
}

let seq = 0
function edit(playerId: string, hole: number, strokes: number | null) {
  return {
    clientWriteId: `cw-${seq++}`,
    playerId,
    holeNumber: hole,
    action: strokes === null ? ('clear' as const) : ('set' as const),
    strokes,
    enteredAt: Date.now() - 1000 + seq
  }
}

beforeEach(async () => {
  // Isolate rounds per test by using distinct round ids instead of clearing.
  vi.restoreAllMocks()
})

describe('outbox coalescing', () => {
  it('ten rapid edits to one cell leave one queued event with the final value', async () => {
    const round = `r-coalesce-${Date.now()}`
    for (let s = 1; s <= 10; s++) {
      await enqueue(round, edit('p1', 4, s))
    }
    const rows = await pendingForRound(round)
    expect(rows).toHaveLength(1)
    expect(rows[0].strokes).toBe(10)
  })

  it('different cells queue independently', async () => {
    const round = `r-cells-${Date.now()}`
    await enqueue(round, edit('p1', 1, 3))
    await enqueue(round, edit('p1', 2, 4))
    await enqueue(round, edit('p2', 1, 5))
    expect(await pendingCount(round)).toBe(3)
  })
})

describe('outbox flush', () => {
  it('deletes entries only after the server acks them', async () => {
    const round = `r-ack-${Date.now()}`
    await enqueue(round, edit('p1', 1, 3))
    const sent: string[] = []
    vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { events: { clientWriteId: string }[] }
      sent.push(...body.events.map((e) => e.clientWriteId))
      return ack(body.events.map((e) => e.clientWriteId))
    })
    const result = await flushRound(round)
    expect(sent).toHaveLength(1)
    expect(result.remaining).toBe(0)
    expect(await pendingCount(round)).toBe(0)
  })

  it('keeps everything queued when the server is unreachable', async () => {
    const round = `r-fail-${Date.now()}`
    await enqueue(round, edit('p1', 1, 3))
    await enqueue(round, edit('p1', 2, 4))
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network down')
    })
    await expect(flushRound(round)).rejects.toThrow()
    expect(await pendingCount(round)).toBe(2)
  })

  it('keeps everything queued on a server error response', async () => {
    const round = `r-500-${Date.now()}`
    await enqueue(round, edit('p1', 1, 3))
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response)
    const result = await flushRound(round)
    expect(result.remaining).toBe(1)
    expect(await pendingCount(round)).toBe(1)
  })

  it('an edit made while a flush is in the air survives the ack of the older write', async () => {
    const round = `r-race-${Date.now()}`
    const first = edit('p1', 7, 3)
    await enqueue(round, first)

    let releaseResponse: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })

    vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { events: { clientWriteId: string }[] }
      await gate // hold the request open
      return ack(body.events.map((e) => e.clientWriteId))
    })

    const flushPromise = flushRound(round)
    // While the request is in flight, the user changes the same cell again.
    await new Promise((r) => setTimeout(r, 10))
    const second = edit('p1', 7, 5)
    await enqueue(round, second)
    releaseResponse!()
    await flushPromise

    // The ack of the first write must not delete the newer queued edit.
    const rows = await pendingForRound(round)
    expect(rows).toHaveLength(1)
    expect(rows[0].clientWriteId).toBe(second.clientWriteId)
    expect(rows[0].strokes).toBe(5)
  })
})
