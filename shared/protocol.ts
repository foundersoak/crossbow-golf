// Sync protocol shared by the client, the Worker, and the RoundRoom DO.
// The unit of sync is a single cell: (round, player, hole).
// Ordering is last-write-wins on skew-corrected entry time, ties broken by
// clientWriteId so every replica resolves identically.

export interface ScoreEventInput {
  /** Idempotency key, generated on the device at tap time. */
  clientWriteId: string
  playerId: string
  holeNumber: number
  /** 'clear' is the only way to blank a cell. A null-strokes 'set' is rejected. */
  action: 'set' | 'clear'
  strokes: number | null
  /** Skew-corrected entry timestamp (device clock + server offset). */
  enteredAt: number
}

export interface CellState {
  playerId: string
  holeNumber: number
  strokes: number | null
  enteredAt: number
  authorPlayerId: string
  clientWriteId: string
}

export interface RoundPlayer {
  id: string
  name: string
  sortOrder: number
}

export interface RoundDetail {
  id: string
  layoutId: string
  playedOn: string
  joinCode: string
  status: 'active' | 'final'
  completedAt: number | null
  completedByName: string | null
  players: RoundPlayer[]
}

export interface EventsRequest {
  deviceId: string
  events: ScoreEventInput[]
}

export interface EventsResponse {
  ackedWriteIds: string[]
  rejected: { clientWriteId: string; reason: string }[]
  cells: CellState[]
  serverTime: number
}

export type ServerMessage =
  | { type: 'snapshot'; cells: CellState[]; round: RoundDetail; serverTime: number }
  | { type: 'cells'; cells: CellState[] }
  | { type: 'round'; round: RoundDetail }
  | { type: 'pong'; clientTime: number; serverTime: number }

export type ClientMessage = { type: 'ping'; clientTime: number }

/**
 * The single LWW rule used by every replica (DO, D1 write-through, client
 * optimistic state): a candidate beats the current cell if its enteredAt is
 * later, with clientWriteId as the deterministic tie-break.
 */
export function candidateWins(
  current: { enteredAt: number; clientWriteId: string } | null | undefined,
  candidate: { enteredAt: number; clientWriteId: string }
): boolean {
  if (!current) return true
  if (candidate.enteredAt !== current.enteredAt) return candidate.enteredAt > current.enteredAt
  return candidate.clientWriteId > current.clientWriteId
}

export function validStrokes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 30
}
