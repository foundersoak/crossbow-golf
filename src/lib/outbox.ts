// The outbox is the only write path for scores, online or offline.
// Every entry is one cell edit; repeated edits to the same cell coalesce.
// Entries are deleted only after the server acknowledges (or explicitly
// rejects) their clientWriteId, so a crash or dropout never loses a tap.

import { openDB, type IDBPDatabase } from 'idb'
import type { EventsResponse, ScoreEventInput } from '../../shared/protocol'
import { getDeviceId } from './device'
import { observeServerTime } from './timeSync'

interface OutboxRow extends ScoreEventInput {
  cellKey: string // roundId:playerId:hole, the coalescing key
  roundId: string
  queuedAt: number
}

let dbPromise: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB('crossbow-golf', 1, {
    upgrade(database) {
      const store = database.createObjectStore('outbox', { keyPath: 'cellKey' })
      store.createIndex('byRound', 'roundId')
    }
  })
  return dbPromise
}

export function cellKey(roundId: string, playerId: string, holeNumber: number): string {
  return `${roundId}:${playerId}:${holeNumber}`
}

export async function enqueue(roundId: string, event: ScoreEventInput): Promise<void> {
  const row: OutboxRow = {
    ...event,
    cellKey: cellKey(roundId, event.playerId, event.holeNumber),
    roundId,
    queuedAt: Date.now()
  }
  await (await db()).put('outbox', row)
}

export async function pendingForRound(roundId: string): Promise<OutboxRow[]> {
  return (await db()).getAllFromIndex('outbox', 'byRound', roundId) as Promise<OutboxRow[]>
}

export async function pendingCount(roundId: string): Promise<number> {
  return (await db()).countFromIndex('outbox', 'byRound', roundId)
}

/** Cell keys (playerId:hole) still waiting on a server ack, for pending dots. */
export async function pendingCellKeys(roundId: string): Promise<Set<string>> {
  const rows = await pendingForRound(roundId)
  return new Set(rows.map((r) => `${r.playerId}:${r.holeNumber}`))
}

const inFlight = new Set<string>()

export interface FlushResult {
  response: EventsResponse | null
  flushed: number
  remaining: number
}

/**
 * Push everything queued for a round. Entries are removed only when the
 * server acks their write id; entries that changed while the request was
 * in the air keep their newer values and go in the next flush.
 */
export async function flushRound(roundId: string): Promise<FlushResult> {
  if (inFlight.has(roundId)) return { response: null, flushed: 0, remaining: 0 }
  inFlight.add(roundId)
  try {
    const rows = await pendingForRound(roundId)
    if (rows.length === 0) return { response: null, flushed: 0, remaining: 0 }

    const events: ScoreEventInput[] = rows.map((r) => ({
      clientWriteId: r.clientWriteId,
      playerId: r.playerId,
      holeNumber: r.holeNumber,
      action: r.action,
      strokes: r.strokes,
      enteredAt: r.enteredAt
    }))

    const t0 = Date.now()
    const res = await fetch(`/api/rounds/${roundId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), events })
    })
    const t1 = Date.now()
    if (!res.ok) {
      return { response: null, flushed: 0, remaining: rows.length }
    }
    const data = (await res.json()) as EventsResponse
    observeServerTime(t0, data.serverTime, t1)

    const settled = new Set([
      ...data.ackedWriteIds,
      ...data.rejected.map((r) => r.clientWriteId)
    ])
    const database = await db()
    const tx = database.transaction('outbox', 'readwrite')
    for (const row of rows) {
      if (!settled.has(row.clientWriteId)) continue
      // Only delete if the queued entry is still the exact write we sent;
      // a newer coalesced edit must survive for the next flush.
      const current = (await tx.store.get(row.cellKey)) as OutboxRow | undefined
      if (current && current.clientWriteId === row.clientWriteId) {
        await tx.store.delete(row.cellKey)
      }
    }
    await tx.done

    const remaining = await pendingCount(roundId)
    return { response: data, flushed: settled.size, remaining }
  } finally {
    inFlight.delete(roundId)
  }
}
