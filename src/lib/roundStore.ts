// Live round state: snapshot + WebSocket deltas + optimistic local writes.
// The same LWW rule (candidateWins) runs here, in the room DO, and in the
// D1 write-through, so all replicas converge on identical cells.

import { useCallback, useEffect, useRef, useState } from 'react'
import ReconnectingWebSocket from 'partysocket/ws'
import {
  candidateWins,
  type CellState,
  type RoundDetail,
  type ServerMessage
} from '../../shared/protocol'
import { apiGet } from './api'
import { correctedNow, observeServerTime } from './timeSync'
import { cellKey, enqueue, flushRound, pendingCellKeys, pendingCount } from './outbox'
import type { LayoutData } from '../../shared/types'

export type Connection = 'connecting' | 'live' | 'offline'

export interface RoundState {
  round: RoundDetail | null
  layout: LayoutData | null
  cells: Map<string, CellState> // key playerId:hole
  connection: Connection
  queued: number
  pendingCells: Set<string> // playerId:hole keys not yet acked
  error: string | null
}

function localCellKey(playerId: string, holeNumber: number): string {
  return `${playerId}:${holeNumber}`
}

export function useRound(roundId: string | undefined, authorPlayerId: string | undefined) {
  const [state, setState] = useState<RoundState>({
    round: null,
    layout: null,
    cells: new Map(),
    connection: 'connecting',
    queued: 0,
    pendingCells: new Set(),
    error: null
  })
  const socketRef = useRef<ReconnectingWebSocket | null>(null)

  const applyCells = useCallback((incoming: CellState[]) => {
    if (incoming.length === 0) return
    setState((prev) => {
      const cells = new Map(prev.cells)
      for (const cell of incoming) {
        const key = localCellKey(cell.playerId, cell.holeNumber)
        const current = prev.cells.get(key)
        if (candidateWins(current ?? null, cell)) cells.set(key, cell)
      }
      return { ...prev, cells }
    })
  }, [])

  const refreshQueued = useCallback(async () => {
    if (!roundId) return
    const queued = await pendingCount(roundId).catch(() => 0)
    const pendingCells = await pendingCellKeys(roundId).catch(() => new Set<string>())
    setState((prev) => ({ ...prev, queued, pendingCells }))
  }, [roundId])

  const flush = useCallback(async () => {
    if (!roundId) return
    try {
      const result = await flushRound(roundId)
      if (result.response) applyCells(result.response.cells)
      await refreshQueued()
    } catch {
      // Offline or server unreachable: the outbox keeps everything.
      await refreshQueued()
    }
  }, [roundId, applyCells, refreshQueued])

  // Initial snapshot over HTTP (works even if the socket cannot connect).
  useEffect(() => {
    if (!roundId) return
    let cancelled = false
    ;(async () => {
      try {
        const t0 = Date.now()
        const data = await apiGet<{
          round: RoundDetail
          cells: CellState[]
          serverTime: number
        }>(`/api/rounds/${roundId}`)
        if (cancelled) return
        observeServerTime(t0, data.serverTime, Date.now())
        setState((prev) => ({ ...prev, round: data.round, error: null }))
        applyCells(data.cells)
        const layout = await apiGet<LayoutData>(`/api/layouts/${data.round.layoutId}`)
        if (!cancelled) setState((prev) => ({ ...prev, layout }))
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : 'Could not load the round.'
          }))
        }
      }
      await flush()
    })()
    return () => {
      cancelled = true
    }
  }, [roundId, applyCells, flush])

  // Live socket.
  useEffect(() => {
    if (!roundId) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new ReconnectingWebSocket(`${proto}://${location.host}/api/rounds/${roundId}/ws`, [], {
      maxReconnectionDelay: 8000,
      minReconnectionDelay: 500
    })
    socketRef.current = ws

    ws.addEventListener('open', () => {
      setState((prev) => ({ ...prev, connection: 'live' }))
      ws.send(JSON.stringify({ type: 'ping', clientTime: Date.now() }))
      void flush()
    })
    ws.addEventListener('close', () => {
      setState((prev) => ({ ...prev, connection: 'offline' }))
    })
    ws.addEventListener('error', () => {
      setState((prev) => ({ ...prev, connection: 'offline' }))
    })
    ws.addEventListener('message', (e: MessageEvent) => {
      let msg: ServerMessage | null = null
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage
      } catch {
        return
      }
      if (!msg) return
      if (msg.type === 'snapshot') {
        observeServerTime(Date.now(), msg.serverTime, Date.now())
        setState((prev) => ({ ...prev, round: msg.round }))
        applyCells(msg.cells)
      } else if (msg.type === 'cells') {
        applyCells(msg.cells)
      } else if (msg.type === 'round') {
        setState((prev) => ({ ...prev, round: msg.round }))
      } else if (msg.type === 'pong') {
        observeServerTime(msg.clientTime, msg.serverTime, Date.now())
      }
    })

    const pingTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', clientTime: Date.now() }))
      }
    }, 30_000)

    // Resync triggers. iOS suspends the page on screen lock and kills the
    // socket without firing close, so on every resume we assume the socket
    // is dead: force a reconnect (which replays the snapshot) and flush the
    // outbox. Background Sync is not used; it has no Safari support.
    const resync = () => {
      if (document.visibilityState !== 'visible') return
      ws.reconnect()
      void flush()
    }
    const onVisibility = () => resync()
    const onOnline = () => resync()
    const onPageShow = () => resync()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', onVisibility)

    // Backoff-ish retry: while anything is queued, try a flush every 10s.
    const retryTimer = setInterval(() => {
      void (async () => {
        if (!roundId) return
        const queued = await pendingCount(roundId).catch(() => 0)
        if (queued > 0) void flush()
      })()
    }, 10_000)

    return () => {
      clearInterval(pingTimer)
      clearInterval(retryTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', onVisibility)
      ws.close()
      socketRef.current = null
    }
  }, [roundId, applyCells, flush])

  /** The single entry point for a score tap. Optimistic, queued, flushed. */
  const setScore = useCallback(
    async (playerId: string, holeNumber: number, strokes: number | null) => {
      if (!roundId || !authorPlayerId) return
      const event = {
        clientWriteId: crypto.randomUUID(),
        playerId,
        holeNumber,
        action: strokes === null ? ('clear' as const) : ('set' as const),
        strokes,
        enteredAt: correctedNow()
      }
      // Optimistic local apply with the shared LWW rule.
      applyCells([
        {
          playerId,
          holeNumber,
          strokes,
          enteredAt: event.enteredAt,
          authorPlayerId,
          clientWriteId: event.clientWriteId
        }
      ])
      await enqueue(roundId, event)
      await refreshQueued()
      void flush()
    },
    [roundId, authorPlayerId, applyCells, refreshQueued, flush]
  )

  return { state, setScore, flush, getCell: (p: string, h: number) => state.cells.get(localCellKey(p, h)) }
}

export { cellKey }
