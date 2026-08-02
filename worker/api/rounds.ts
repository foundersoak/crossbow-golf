import type { Env } from '../env'
import { json, HttpError } from '../lib/http'
import {
  createSession,
  randomId,
  requireAdmin,
  requirePlayer,
  requireSession,
  sessionCookie,
  type SessionInfo
} from '../lib/session'
import type { CellState, RoundDetail, EventsRequest } from '../../shared/protocol'

const MAX_PLAYERS = 6
const JOIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function makeJoinCode(): string {
  const bytes = new Uint8Array(5)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => JOIN_ALPHABET[b % JOIN_ALPHABET.length]).join('')
}

function roomStub(env: Env, roundId: string): DurableObjectStub {
  return env.ROUND_ROOMS.get(env.ROUND_ROOMS.idFromName(roundId))
}

async function pushRoundToRoom(env: Env, round: RoundDetail, path: '/init' | '/status') {
  await roomStub(env, round.id).fetch(`https://room${path}`, {
    method: 'POST',
    body: JSON.stringify(path === '/init' ? round : { round })
  })
}

export async function loadRoundDetail(env: Env, roundId: string): Promise<RoundDetail | null> {
  const round = await env.DB.prepare(
    `SELECT r.*, p.name AS completed_by_name FROM rounds r
     LEFT JOIN players p ON p.id = r.completed_by WHERE r.id = ?`
  )
    .bind(roundId)
    .first<Record<string, unknown>>()
  if (!round) return null
  const players = await env.DB.prepare(
    `SELECT p.id, p.name, rp.sort_order FROM round_players rp
     JOIN players p ON p.id = rp.player_id WHERE rp.round_id = ? ORDER BY rp.sort_order`
  )
    .bind(roundId)
    .all<{ id: string; name: string; sort_order: number }>()
  return {
    id: String(round.id),
    layoutId: String(round.layout_id),
    playedOn: String(round.played_on),
    joinCode: String(round.join_code),
    status: round.status as 'active' | 'final',
    completedAt: round.completed_at === null ? null : Number(round.completed_at),
    completedByName: (round.completed_by_name as string | null) ?? null,
    players: players.results.map((p) => ({ id: p.id, name: p.name, sortOrder: p.sort_order }))
  }
}

async function requireRoundMemberOrAdmin(
  env: Env,
  session: SessionInfo | null,
  roundId: string
): Promise<ReturnType<typeof requirePlayer>> {
  const s = requirePlayer(session)
  if (s.player.isAdmin) return s
  const member = await env.DB.prepare(
    'SELECT player_id FROM round_players WHERE round_id = ? AND player_id = ?'
  )
    .bind(roundId, s.player.id)
    .first()
  if (!member) throw new HttpError(403, 'Only players in this round can do that.')
  return s
}

export async function handleCreateRound(
  request: Request,
  env: Env,
  session: SessionInfo | null
): Promise<Response> {
  const s = requirePlayer(session)
  const body = (await request.json().catch(() => null)) as {
    playedOn?: string
    playerIds?: string[]
    newPlayers?: string[]
  } | null

  const playedOn = /^\d{4}-\d{2}-\d{2}$/.test(body?.playedOn ?? '')
    ? body!.playedOn!
    : new Date().toISOString().slice(0, 10)

  const layout = await env.DB.prepare(
    "SELECT id FROM layouts WHERE status = 'published' ORDER BY version_number DESC LIMIT 1"
  ).first<{ id: string }>()
  if (!layout) {
    throw new HttpError(400, 'Publish a course layout before starting a round.')
  }

  const playerIds = [...new Set(body?.playerIds ?? [])]
  const newNames = (body?.newPlayers ?? [])
    .map((n) => String(n).trim().slice(0, 40))
    .filter(Boolean)

  if (playerIds.length + newNames.length < 1) {
    throw new HttpError(400, 'Pick at least one player.')
  }
  if (playerIds.length + newNames.length > MAX_PLAYERS) {
    throw new HttpError(400, `A round supports up to ${MAX_PLAYERS} players.`)
  }

  for (const pid of playerIds) {
    const exists = await env.DB.prepare('SELECT id FROM players WHERE id = ?').bind(pid).first()
    if (!exists) throw new HttpError(404, 'A picked player is not on the roster.')
  }

  const createdIds: string[] = []
  for (const name of newNames) {
    const clash = await env.DB.prepare('SELECT id FROM players WHERE name = ? COLLATE NOCASE')
      .bind(name)
      .first<{ id: string }>()
    if (clash) {
      if (!playerIds.includes(clash.id)) createdIds.push(clash.id)
      continue
    }
    const id = randomId()
    await env.DB.prepare('INSERT INTO players (id, name, is_admin, created_at) VALUES (?, ?, 0, ?)')
      .bind(id, name, Date.now())
      .run()
    createdIds.push(id)
  }

  const allIds = [...playerIds, ...createdIds].slice(0, MAX_PLAYERS)
  const roundId = randomId()
  const now = Date.now()

  // Retry a few times in the unlikely case of a join-code collision.
  let joinCode = makeJoinCode()
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = await env.DB.prepare(
      "SELECT id FROM rounds WHERE join_code = ? AND status = 'active'"
    )
      .bind(joinCode)
      .first()
    if (!clash) break
    joinCode = makeJoinCode()
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO rounds (id, layout_id, played_on, created_by, join_code, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`
    ).bind(roundId, layout.id, playedOn, s.player.id, joinCode, now),
    ...allIds.map((pid, i) =>
      env.DB.prepare(
        'INSERT INTO round_players (round_id, player_id, joined_at, sort_order) VALUES (?, ?, ?, ?)'
      ).bind(roundId, pid, now, i)
    )
  ])

  const detail = (await loadRoundDetail(env, roundId))!
  await pushRoundToRoom(env, detail, '/init')
  return json(detail, 201)
}

export async function handleListRounds(env: Env, session: SessionInfo | null): Promise<Response> {
  requireSession(session)
  const rows = await env.DB.prepare(
    `SELECT r.id, r.played_on, r.status, r.join_code, r.created_at, r.completed_at,
            GROUP_CONCAT(p.name, ', ') AS player_names
     FROM rounds r
     LEFT JOIN round_players rp ON rp.round_id = r.id
     LEFT JOIN players p ON p.id = rp.player_id
     GROUP BY r.id
     ORDER BY r.status = 'active' DESC, r.created_at DESC
     LIMIT 30`
  ).all<Record<string, unknown>>()
  return json(
    rows.results.map((r) => ({
      id: String(r.id),
      playedOn: String(r.played_on),
      status: String(r.status),
      joinCode: String(r.join_code),
      createdAt: Number(r.created_at),
      completedAt: r.completed_at === null ? null : Number(r.completed_at),
      playerNames: (r.player_names as string | null) ?? ''
    }))
  )
}

export async function handleGetRound(
  env: Env,
  session: SessionInfo | null,
  roundId: string
): Promise<Response> {
  requirePlayer(session)
  const detail = await loadRoundDetail(env, roundId)
  if (!detail) throw new HttpError(404, 'Round not found.')

  // Cells come from the room (authoritative while live).
  const res = await roomStub(env, roundId).fetch('https://room/snapshot')
  const snap = (await res.json()) as { cells: CellState[]; serverTime: number }
  return json({ round: detail, cells: snap.cells ?? [], serverTime: snap.serverTime })
}

export async function handlePostEvents(
  request: Request,
  env: Env,
  session: SessionInfo | null,
  roundId: string
): Promise<Response> {
  const s = await requireRoundMemberOrAdmin(env, session, roundId)
  const body = (await request.json().catch(() => null)) as EventsRequest | null
  if (!body || !Array.isArray(body.events)) throw new HttpError(400, 'Bad events payload.')

  const round = await loadRoundDetail(env, roundId)
  if (!round) throw new HttpError(404, 'Round not found.')
  if (round.status === 'final' && !s.player.isAdmin) {
    throw new HttpError(409, 'This round is final. Ask an admin to unlock it.')
  }

  // Final rounds accept admin corrections: reopen semantics are implicit
  // for the write, the round stays final.
  const res = await roomStub(env, roundId).fetch('https://room/events', {
    method: 'POST',
    body: JSON.stringify({
      deviceId: String(body.deviceId ?? '').slice(0, 64),
      events: body.events,
      authorPlayerId: s.player.id,
      allowFinal: s.player.isAdmin
    })
  })
  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': 'application/json' }
  })
}

export async function handleRoundSocket(
  request: Request,
  env: Env,
  session: SessionInfo | null,
  roundId: string
): Promise<Response> {
  requirePlayer(session)
  const round = await loadRoundDetail(env, roundId)
  if (!round) throw new HttpError(404, 'Round not found.')
  return roomStub(env, roundId).fetch(new Request('https://room/ws', request))
}

export async function handleCompleteRound(
  env: Env,
  session: SessionInfo | null,
  roundId: string
): Promise<Response> {
  const s = await requireRoundMemberOrAdmin(env, session, roundId)
  const now = Date.now()
  await env.DB.prepare(
    "UPDATE rounds SET status = 'final', completed_at = ?, completed_by = ? WHERE id = ? AND status = 'active'"
  )
    .bind(now, s.player.id, roundId)
    .run()
  const detail = await loadRoundDetail(env, roundId)
  if (!detail) throw new HttpError(404, 'Round not found.')
  await pushRoundToRoom(env, detail, '/status')
  return json(detail)
}

export async function handleReopenRound(
  env: Env,
  session: SessionInfo | null,
  roundId: string
): Promise<Response> {
  requireAdmin(session)
  await env.DB.prepare(
    "UPDATE rounds SET status = 'active', completed_at = NULL, completed_by = NULL WHERE id = ?"
  )
    .bind(roundId)
    .run()
  const detail = await loadRoundDetail(env, roundId)
  if (!detail) throw new HttpError(404, 'Round not found.')
  await pushRoundToRoom(env, detail, '/status')
  return json(detail)
}

/** Join by code: the code itself is the capability, so no session required. */
export async function handleJoinInfo(env: Env, code: string): Promise<Response> {
  const round = await env.DB.prepare(
    "SELECT id FROM rounds WHERE join_code = ? AND status = 'active'"
  )
    .bind(code.toUpperCase())
    .first<{ id: string }>()
  if (!round) throw new HttpError(404, 'No live round with that code. Check with the group.')
  const detail = (await loadRoundDetail(env, round.id))!
  const roster = await env.DB.prepare(
    'SELECT id, name FROM players ORDER BY name COLLATE NOCASE'
  ).all<{ id: string; name: string }>()
  return json({ round: detail, roster: roster.results })
}

export async function handleJoinClaim(
  request: Request,
  env: Env,
  session: SessionInfo | null,
  code: string,
  url: URL
): Promise<Response> {
  const round = await env.DB.prepare(
    "SELECT id FROM rounds WHERE join_code = ? AND status = 'active'"
  )
    .bind(code.toUpperCase())
    .first<{ id: string }>()
  if (!round) throw new HttpError(404, 'No live round with that code. Check with the group.')

  const body = (await request.json().catch(() => null)) as
    | { playerId?: string; name?: string }
    | null

  let playerId: string
  if (body?.playerId) {
    const p = await env.DB.prepare('SELECT id FROM players WHERE id = ?')
      .bind(body.playerId)
      .first<{ id: string }>()
    if (!p) throw new HttpError(404, 'That player is not on the roster.')
    playerId = p.id
  } else if (session?.player && !body?.name) {
    playerId = session.player.id
  } else if (body?.name?.trim()) {
    const name = body.name.trim().slice(0, 40)
    const existing = await env.DB.prepare('SELECT id FROM players WHERE name = ? COLLATE NOCASE')
      .bind(name)
      .first<{ id: string }>()
    if (existing) {
      playerId = existing.id
    } else {
      playerId = randomId()
      await env.DB.prepare(
        'INSERT INTO players (id, name, is_admin, created_at) VALUES (?, ?, 0, ?)'
      )
        .bind(playerId, name, Date.now())
        .run()
    }
  } else {
    throw new HttpError(400, 'Pick who you are.')
  }

  // Add to the round if not already in it.
  const member = await env.DB.prepare(
    'SELECT player_id FROM round_players WHERE round_id = ? AND player_id = ?'
  )
    .bind(round.id, playerId)
    .first()
  if (!member) {
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM round_players WHERE round_id = ?'
    )
      .bind(round.id)
      .first<{ n: number }>()
    if ((count?.n ?? 0) >= MAX_PLAYERS) {
      throw new HttpError(409, `This round already has ${MAX_PLAYERS} players.`)
    }
    await env.DB.prepare(
      'INSERT INTO round_players (round_id, player_id, joined_at, sort_order) VALUES (?, ?, ?, ?)'
    )
      .bind(round.id, playerId, Date.now(), count?.n ?? 0)
      .run()
  }

  const headers: Record<string, string> = {}
  if (!session) {
    const token = await createSession(env, playerId)
    headers['set-cookie'] = sessionCookie(token, url)
  } else if (!session.player || session.player.id !== playerId) {
    await env.DB.prepare('UPDATE sessions SET player_id = ? WHERE token_hash = ?')
      .bind(playerId, session.tokenHash)
      .run()
  }

  const detail = (await loadRoundDetail(env, round.id))!
  await pushRoundToRoom(env, detail, '/status')
  return json({ roundId: round.id, playerId }, 200, headers)
}
