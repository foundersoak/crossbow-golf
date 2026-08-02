import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../env'
import {
  candidateWins,
  validStrokes,
  type CellState,
  type ClientMessage,
  type EventsRequest,
  type EventsResponse,
  type RoundDetail,
  type ScoreEventInput,
  type ServerMessage
} from '../../shared/protocol'

interface StoredEvent {
  client_write_id: string
  player_id: string
  hole_number: number
  action: string
  strokes: number | null
  author_player_id: string
  device_id: string
  entered_at: number
  server_received_at: number
  applied: number
  replicated: number
}

/**
 * One RoundRoom per round. The room is the authority for a live round:
 * it applies the LWW rules in a single-threaded context, stores the
 * append-only event log in its own SQLite, broadcasts cell updates over
 * hibernating WebSockets, and replicates events to D1 with alarm-based
 * retry. The Worker authenticates every request before it reaches here.
 */
export class RoundRoom extends DurableObject<Env> {
  private initialized = false

  private ensureTables(): void {
    if (this.initialized) return
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        client_write_id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        hole_number INTEGER NOT NULL,
        action TEXT NOT NULL,
        strokes INTEGER,
        author_player_id TEXT NOT NULL,
        device_id TEXT,
        entered_at INTEGER NOT NULL,
        server_received_at INTEGER NOT NULL,
        applied INTEGER NOT NULL,
        replicated INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS cells (
        player_id TEXT NOT NULL,
        hole_number INTEGER NOT NULL,
        strokes INTEGER,
        entered_at INTEGER NOT NULL,
        author_player_id TEXT NOT NULL,
        client_write_id TEXT NOT NULL,
        PRIMARY KEY (player_id, hole_number)
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    this.initialized = true
  }

  private getMeta(key: string): string | null {
    const rows = this.ctx.storage.sql
      .exec('SELECT value FROM meta WHERE key = ?', key)
      .toArray() as { value: string }[]
    return rows.length > 0 ? rows[0].value : null
  }

  private setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      key,
      value
    )
  }

  private roundDetail(): RoundDetail | null {
    const raw = this.getMeta('round')
    return raw ? (JSON.parse(raw) as RoundDetail) : null
  }

  private allCells(): CellState[] {
    const rows = this.ctx.storage.sql.exec('SELECT * FROM cells').toArray() as {
      player_id: string
      hole_number: number
      strokes: number | null
      entered_at: number
      author_player_id: string
      client_write_id: string
    }[]
    return rows.map((r) => ({
      playerId: r.player_id,
      holeNumber: r.hole_number,
      strokes: r.strokes,
      enteredAt: r.entered_at,
      authorPlayerId: r.author_player_id,
      clientWriteId: r.client_write_id
    }))
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureTables()
    const url = new URL(request.url)

    switch (url.pathname) {
      case '/init': {
        const round = (await request.json()) as RoundDetail
        this.setMeta('round', JSON.stringify(round))
        this.broadcast({ type: 'round', round })
        return Response.json({ ok: true })
      }
      case '/ws': {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
          return new Response('Expected a WebSocket upgrade.', { status: 426 })
        }
        const pair = new WebSocketPair()
        this.ctx.acceptWebSocket(pair[1])
        const round = this.roundDetail()
        if (round) {
          const snapshot: ServerMessage = {
            type: 'snapshot',
            cells: this.allCells(),
            round,
            serverTime: Date.now()
          }
          pair[1].send(JSON.stringify(snapshot))
        }
        return new Response(null, { status: 101, webSocket: pair[0] })
      }
      case '/events': {
        const body = (await request.json()) as EventsRequest & {
          authorPlayerId: string
          allowFinal?: boolean
        }
        return Response.json(
          this.applyEvents(body.events, body.authorPlayerId, body.deviceId, body.allowFinal === true)
        )
      }
      case '/snapshot': {
        return Response.json({
          cells: this.allCells(),
          round: this.roundDetail(),
          serverTime: Date.now()
        })
      }
      case '/status': {
        const body = (await request.json()) as { round: RoundDetail }
        this.setMeta('round', JSON.stringify(body.round))
        this.broadcast({ type: 'round', round: body.round })
        return Response.json({ ok: true })
      }
      default:
        return new Response('Not found', { status: 404 })
    }
  }

  private applyEvents(
    events: ScoreEventInput[],
    authorPlayerId: string,
    deviceId: string,
    allowFinal = false
  ): EventsResponse {
    const now = Date.now()
    const round = this.roundDetail()
    const ackedWriteIds: string[] = []
    const rejected: { clientWriteId: string; reason: string }[] = []
    const changed = new Map<string, CellState>()

    for (const event of events.slice(0, 500)) {
      const id = String(event.clientWriteId ?? '')
      if (!id || id.length > 64) {
        rejected.push({ clientWriteId: id, reason: 'bad clientWriteId' })
        continue
      }

      // Idempotent replay: already processed means already acknowledged.
      const dupe = this.ctx.storage.sql
        .exec('SELECT client_write_id FROM events WHERE client_write_id = ?', id)
        .toArray()
      if (dupe.length > 0) {
        ackedWriteIds.push(id)
        continue
      }

      // Guardrail: a null value can never overwrite a score. Only an
      // explicit clear may blank a cell.
      if (event.action === 'set' && !validStrokes(event.strokes)) {
        rejected.push({ clientWriteId: id, reason: 'set requires strokes between 1 and 30' })
        continue
      }
      if (event.action !== 'set' && event.action !== 'clear') {
        rejected.push({ clientWriteId: id, reason: 'unknown action' })
        continue
      }
      if (!round?.players.some((p) => p.id === event.playerId)) {
        rejected.push({ clientWriteId: id, reason: 'player not in this round' })
        continue
      }
      if (
        !Number.isInteger(event.holeNumber) ||
        event.holeNumber < 1 ||
        event.holeNumber > 36
      ) {
        rejected.push({ clientWriteId: id, reason: 'bad hole number' })
        continue
      }
      if (round.status === 'final' && !allowFinal) {
        rejected.push({ clientWriteId: id, reason: 'round is final' })
        continue
      }

      // Never trust a timestamp from the future; clamp to arrival time.
      const enteredAt = Math.min(Number(event.enteredAt) || now, now)
      const strokes = event.action === 'clear' ? null : (event.strokes as number)

      const currentRows = this.ctx.storage.sql
        .exec(
          'SELECT entered_at, client_write_id FROM cells WHERE player_id = ? AND hole_number = ?',
          event.playerId,
          event.holeNumber
        )
        .toArray() as { entered_at: number; client_write_id: string }[]
      const current = currentRows.length
        ? { enteredAt: currentRows[0].entered_at, clientWriteId: currentRows[0].client_write_id }
        : null
      const wins = candidateWins(current, { enteredAt, clientWriteId: id })

      this.ctx.storage.sql.exec(
        `INSERT INTO events
         (client_write_id, player_id, hole_number, action, strokes, author_player_id,
          device_id, entered_at, server_received_at, applied, replicated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        id,
        event.playerId,
        event.holeNumber,
        event.action,
        strokes,
        authorPlayerId,
        deviceId,
        enteredAt,
        now,
        wins ? 1 : 0
      )

      if (wins) {
        this.ctx.storage.sql.exec(
          `INSERT INTO cells (player_id, hole_number, strokes, entered_at, author_player_id, client_write_id)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (player_id, hole_number) DO UPDATE SET
             strokes = excluded.strokes,
             entered_at = excluded.entered_at,
             author_player_id = excluded.author_player_id,
             client_write_id = excluded.client_write_id`,
          event.playerId,
          event.holeNumber,
          strokes,
          enteredAt,
          authorPlayerId,
          id
        )
        changed.set(`${event.playerId}:${event.holeNumber}`, {
          playerId: event.playerId,
          holeNumber: event.holeNumber,
          strokes,
          enteredAt,
          authorPlayerId,
          clientWriteId: id
        })
      }
      ackedWriteIds.push(id)
    }

    if (changed.size > 0) {
      this.broadcast({ type: 'cells', cells: [...changed.values()] })
    }
    this.ctx.waitUntil(this.replicate())

    return {
      ackedWriteIds,
      rejected,
      cells: [...changed.values()],
      serverTime: now
    }
  }

  /** Write-through: copy unreplicated events into D1, retrying via alarm. */
  private async replicate(): Promise<void> {
    const round = this.roundDetail()
    if (!round) return
    const pending = this.ctx.storage.sql
      .exec('SELECT * FROM events WHERE replicated = 0 ORDER BY server_received_at LIMIT 100')
      .toArray() as unknown as StoredEvent[]
    if (pending.length === 0) return

    try {
      const stmts = pending.flatMap((e) => {
        const list = [
          this.env.DB.prepare(
            `INSERT OR IGNORE INTO score_events
             (id, round_id, player_id, hole_number, action, strokes, author_player_id,
              device_id, client_write_id, entered_at, server_received_at, applied)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            e.client_write_id,
            round.id,
            e.player_id,
            e.hole_number,
            e.action,
            e.strokes,
            e.author_player_id,
            e.device_id,
            e.client_write_id,
            e.entered_at,
            e.server_received_at,
            e.applied
          )
        ]
        if (e.applied === 1) {
          list.push(
            this.env.DB.prepare(
              `INSERT INTO scores (round_id, player_id, hole_number, strokes, entered_at, author_player_id, client_write_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (round_id, player_id, hole_number) DO UPDATE SET
                 strokes = excluded.strokes,
                 entered_at = excluded.entered_at,
                 author_player_id = excluded.author_player_id,
                 client_write_id = excluded.client_write_id
               WHERE excluded.entered_at > scores.entered_at
                  OR (excluded.entered_at = scores.entered_at
                      AND excluded.client_write_id > scores.client_write_id)`
            ).bind(
              round.id,
              e.player_id,
              e.hole_number,
              e.strokes,
              e.entered_at,
              e.author_player_id,
              e.client_write_id
            )
          )
        }
        return list
      })
      await this.env.DB.batch(stmts)
      for (const e of pending) {
        this.ctx.storage.sql.exec(
          'UPDATE events SET replicated = 1 WHERE client_write_id = ?',
          e.client_write_id
        )
      }
      // More waiting? Immediately continue.
      const more = this.ctx.storage.sql
        .exec('SELECT COUNT(*) AS n FROM events WHERE replicated = 0')
        .one() as { n: number }
      if (more.n > 0) await this.ctx.storage.setAlarm(Date.now() + 1000)
    } catch (err) {
      console.error('replication to D1 failed, will retry', err)
      await this.ctx.storage.setAlarm(Date.now() + 30_000)
    }
  }

  async alarm(): Promise<void> {
    this.ensureTables()
    await this.replicate()
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    this.ensureTables()
    let msg: ClientMessage | null = null
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
    } catch {
      return
    }
    if (msg?.type === 'ping') {
      const pong: ServerMessage = {
        type: 'pong',
        clientTime: msg.clientTime,
        serverTime: Date.now()
      }
      ws.send(JSON.stringify(pong))
    }
  }

  async webSocketClose(): Promise<void> {
    // Nothing to clean up; hibernation manages socket lifecycle.
  }

  private broadcast(message: ServerMessage): void {
    const raw = JSON.stringify(message)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(raw)
      } catch {
        // Socket already gone; hibernation API will reap it.
      }
    }
  }
}
