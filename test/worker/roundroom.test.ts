// Integration tests for the sync engine, exercising the real RoundRoom
// Durable Object. This is the test suite the brief demanded: the reconnect
// path must provably lose nothing.
// @ts-expect-error virtual module provided by vitest-pool-workers
import { env, runInDurableObject } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import type {
  CellState,
  EventsResponse,
  RoundDetail,
  ScoreEventInput
} from '../../shared/protocol'

const A = 'player-a'
const B = 'player-b'
const C = 'player-c'

function makeRound(id: string, playerIds: string[]): RoundDetail {
  return {
    id,
    layoutId: 'layout-1',
    playedOn: '2030-01-01',
    joinCode: 'TEST1',
    status: 'active',
    completedAt: null,
    completedByName: null,
    players: playerIds.map((pid, i) => ({ id: pid, name: pid, sortOrder: i }))
  }
}

function stubFor(roundId: string) {
  return env.ROUND_ROOMS.get(env.ROUND_ROOMS.idFromName(roundId))
}

async function initRoom(roundId: string, playerIds: string[]) {
  const stub = stubFor(roundId)
  const res = await stub.fetch('https://room/init', {
    method: 'POST',
    body: JSON.stringify(makeRound(roundId, playerIds))
  })
  expect(res.status).toBe(200)
  return stub
}

let writeSeq = 0
function ev(
  playerId: string,
  holeNumber: number,
  strokes: number | null,
  enteredAt: number,
  action: 'set' | 'clear' = strokes === null ? 'clear' : 'set'
): ScoreEventInput {
  return {
    clientWriteId: `w-${playerId}-${holeNumber}-${enteredAt}-${writeSeq++}`,
    playerId,
    holeNumber,
    action,
    strokes,
    enteredAt
  }
}

async function post(
  stub: DurableObjectStub,
  events: ScoreEventInput[],
  author: string,
  deviceId: string
): Promise<EventsResponse> {
  const res = await stub.fetch('https://room/events', {
    method: 'POST',
    body: JSON.stringify({ deviceId, events, authorPlayerId: author })
  })
  expect(res.status).toBe(200)
  return res.json()
}

async function cells(stub: DurableObjectStub): Promise<Map<string, CellState>> {
  const res = await stub.fetch('https://room/snapshot')
  const snap = (await res.json()) as { cells: CellState[] }
  return new Map(snap.cells.map((c) => [`${c.playerId}:${c.holeNumber}`, c]))
}

function strokesOf(map: Map<string, CellState>, playerId: string, hole: number) {
  return map.get(`${playerId}:${hole}`)?.strokes ?? null
}

describe('the hole-3 reconnect scenario', () => {
  it('merges an offline device back with zero loss on either side', async () => {
    const stub = await initRoom('round-hole3', [A, B, C])
    // All entry times sit in the recent past; future-dated stamps would be
    // clamped by the server (that behavior has its own test below).
    const base = Date.now() - 3_600_000
    const t = (min: number) => base + min * 60_000

    // Holes 1-2: everyone online, scoring for themselves.
    for (const hole of [1, 2]) {
      await post(stub, [ev(A, hole, 3, t(hole))], A, 'phone-a')
      await post(stub, [ev(B, hole, 4, t(hole))], B, 'phone-b')
      await post(stub, [ev(C, hole, 5, t(hole))], C, 'phone-c')
    }

    // Phone A drops offline at hole 3 and keeps scoring locally, holes 3-9.
    // These events are queued on the device, NOT posted yet.
    const offlineQueue: ScoreEventInput[] = []
    for (let hole = 3; hole <= 9; hole++) {
      offlineQueue.push(ev(A, hole, 3, t(10 + hole))) // A records a 3 on every hole
    }

    // Meanwhile the online players keep going.
    for (let hole = 3; hole <= 9; hole++) {
      await post(stub, [ev(B, hole, 4, t(10 + hole))], B, 'phone-b')
      await post(stub, [ev(C, hole, 5, t(10 + hole))], C, 'phone-c')
    }
    // B also acts as scorekeeper for A twice:
    // For hole 5, B corrects A's score AFTER A's own offline entry (t=25 > t=15).
    // The correction is the latest human intent, so it must survive the merge.
    await post(stub, [ev(A, 5, 6, t(25))], B, 'phone-b')
    // For hole 6, B guesses A's score BEFORE A's own offline entry (t=13 < t=16).
    // A's own later entry must win once the queue replays.
    await post(stub, [ev(A, 6, 7, t(13))], B, 'phone-b')

    // Phone A reconnects and replays its queue, exactly as the outbox does.
    const merge = await post(stub, offlineQueue, A, 'phone-a')
    expect(merge.rejected).toEqual([])
    expect(merge.ackedWriteIds).toHaveLength(offlineQueue.length)

    const after = await cells(stub)

    // A's offline scores landed on every hole A touched...
    for (const hole of [3, 4, 7, 8, 9]) {
      expect(strokesOf(after, A, hole)).toBe(3)
    }
    // ...except hole 5, where B's later correction wins...
    expect(strokesOf(after, A, 5)).toBe(6)
    // ...and hole 6, where A's later own entry beats B's earlier guess.
    expect(strokesOf(after, A, 6)).toBe(3)

    // Nothing from the online side was lost or clobbered.
    for (let hole = 1; hole <= 9; hole++) {
      expect(strokesOf(after, B, hole)).toBe(4)
      expect(strokesOf(after, C, hole)).toBe(5)
    }

    // The reconnecting client never pushed cells it did not touch: the only
    // A-cells with an author other than A are the two B entered, and hole 5
    // still attributes to B (the winner).
    expect(after.get(`${A}:5`)?.authorPlayerId).toBe(B)
    expect(after.get(`${A}:6`)?.authorPlayerId).toBe(A)

    // Losing the ack and replaying the whole queue changes nothing.
    const replay = await post(stub, offlineQueue, A, 'phone-a')
    expect(replay.ackedWriteIds).toHaveLength(offlineQueue.length)
    expect(replay.cells).toEqual([]) // no cell changed on replay
    const afterReplay = await cells(stub)
    expect(afterReplay).toEqual(after)

    // And the D1 write-through mirror converges to the same cells.
    await runInDurableObject(stub, async (instance: { alarm(): Promise<void> }) => {
      await instance.alarm()
    })
    const d1 = await env.DB.prepare(
      'SELECT player_id, hole_number, strokes FROM scores WHERE round_id = ?'
    )
      .bind('round-hole3')
      .all()
    expect(d1.results).toHaveLength(after.size)
    for (const row of d1.results as { player_id: string; hole_number: number; strokes: number }[]) {
      expect(row.strokes).toBe(strokesOf(after, row.player_id, row.hole_number))
    }
  })
})

describe('null can never overwrite a score', () => {
  it('rejects a null set, honors an explicit clear, and orders clears like any write', async () => {
    const stub = await initRoom('round-null', [A, B])
    const t0 = Date.now() - 1_800_000

    await post(stub, [ev(A, 1, 4, t0)], A, 'phone-a')

    // A stale client pushing blank state: action 'set' with null strokes.
    const nullSet = await post(
      stub,
      [{ clientWriteId: 'null-set-1', playerId: A, holeNumber: 1, action: 'set', strokes: null, enteredAt: t0 + 60_000 }],
      A,
      'phone-a'
    )
    expect(nullSet.rejected).toHaveLength(1)
    expect(strokesOf(await cells(stub), A, 1)).toBe(4)

    // An explicit, intentional clear is allowed and wins as the newest write.
    await post(stub, [ev(A, 1, null, t0 + 120_000)], A, 'phone-a')
    expect(strokesOf(await cells(stub), A, 1)).toBeNull()

    // An OLDER set replaying after the clear must not resurrect the score.
    await post(stub, [ev(A, 1, 9, t0 + 30_000)], A, 'phone-a')
    expect(strokesOf(await cells(stub), A, 1)).toBeNull()

    // A NEWER set after the clear takes the cell back.
    await post(stub, [ev(A, 1, 5, t0 + 180_000)], A, 'phone-a')
    expect(strokesOf(await cells(stub), A, 1)).toBe(5)
  })
})

describe('idempotent replay', () => {
  it('acks duplicates without reapplying them', async () => {
    const stub = await initRoom('round-idem', [A])
    const t0 = Date.now() - 1_800_000
    const batch = [ev(A, 1, 3, t0), ev(A, 2, 4, t0 + 1000)]

    const first = await post(stub, batch, A, 'phone-a')
    expect(first.ackedWriteIds).toHaveLength(2)
    expect(first.cells).toHaveLength(2)

    const second = await post(stub, batch, A, 'phone-a')
    expect(second.ackedWriteIds).toHaveLength(2)
    expect(second.cells).toEqual([])

    await runInDurableObject(stub, async (instance: { alarm(): Promise<void> }) => {
      await instance.alarm()
    })
    const d1 = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM score_events WHERE round_id = ?'
    )
      .bind('round-idem')
      .first<{ n: number }>()
    expect(d1?.n).toBe(2) // duplicates never became new events
  })
})

describe('clock skew', () => {
  it('clamps future-dated entries so a fast clock cannot own a cell', async () => {
    const stub = await initRoom('round-skew', [A, B])
    const future = Date.now() + 40 * 60_000

    // Device with a fast clock writes 40 minutes in the future.
    await post(stub, [ev(A, 1, 8, future)], A, 'phone-fast')
    const snap = await cells(stub)
    const stored = snap.get(`${A}:1`)!
    expect(stored.enteredAt).toBeLessThanOrEqual(Date.now() + 1000)

    // A deliberate correction made now (arriving after) still wins, which
    // would be impossible if the future timestamp had been trusted.
    await new Promise((r) => setTimeout(r, 5))
    await post(stub, [ev(A, 1, 4, Date.now())], B, 'phone-b')
    expect(strokesOf(await cells(stub), A, 1)).toBe(4)
  })

  it('a slow clock still orders correctly through corrected timestamps', async () => {
    const stub = await initRoom('round-skew2', [A])
    const t0 = Date.now() - 1_800_000
    // The client corrects timestamps before sending (timeSync), so entries
    // arrive in human order even from a slow device. Server-side, ordering
    // is purely by enteredAt: the later entry wins regardless of arrival.
    await post(stub, [ev(A, 1, 5, t0 + 60_000)], A, 'phone-a') // later entry, arrives first
    await post(stub, [ev(A, 1, 3, t0)], A, 'phone-slow') // earlier entry, arrives second
    expect(strokesOf(await cells(stub), A, 1)).toBe(5)
  })
})

describe('final rounds', () => {
  it('rejects writes unless explicitly allowed for admin corrections', async () => {
    const stub = stubFor('round-final')
    const round = makeRound('round-final', [A])
    await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify(round) })
    await post(stub, [ev(A, 1, 3, Date.now() - 600_000)], A, 'phone-a')

    await stub.fetch('https://room/status', {
      method: 'POST',
      body: JSON.stringify({ round: { ...round, status: 'final' } })
    })

    const blocked = await post(stub, [ev(A, 2, 4, Date.now() - 300_000)], A, 'phone-a')
    expect(blocked.rejected).toHaveLength(1)
    expect(blocked.rejected[0].reason).toContain('final')

    // Admin path: the worker sets allowFinal for admins.
    const res = await stub.fetch('https://room/events', {
      method: 'POST',
      body: JSON.stringify({
        deviceId: 'admin-phone',
        events: [ev(A, 2, 4, Date.now() - 60_000)],
        authorPlayerId: A,
        allowFinal: true
      })
    })
    const adminWrite = (await res.json()) as EventsResponse
    expect(adminWrite.ackedWriteIds).toHaveLength(1)
    expect(strokesOf(await cells(stub), A, 2)).toBe(4)
  })
})
