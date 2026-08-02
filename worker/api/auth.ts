import type { Env } from '../env'
import { json, HttpError } from '../lib/http'
import {
  createSession,
  requireSession,
  sessionCookie,
  sha256Hex,
  randomId,
  type SessionInfo
} from '../lib/session'
import type { MeResponse, RosterEntry } from '../../shared/types'

const ATTEMPT_LIMIT_PER_HOUR = 20

async function checkRateLimit(env: Env, request: Request): Promise<void> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const windowStart = Math.floor(Date.now() / 3_600_000) * 3_600_000
  const row = await env.DB.prepare(
    `INSERT INTO login_attempts (ip, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT (ip, window_start) DO UPDATE SET count = count + 1
     RETURNING count`
  )
    .bind(ip, windowStart)
    .first<{ count: number }>()
  if (row && row.count > ATTEMPT_LIMIT_PER_HOUR) {
    throw new HttpError(429, 'Too many attempts. Try again in an hour.')
  }
}

/** The invite code hash lives in config, seeded from the INVITE_CODE secret. */
async function getInviteCodeHash(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'invite_code_hash'")
    .first<{ value: string }>()
  if (row) return row.value
  if (!env.INVITE_CODE) {
    throw new HttpError(
      503,
      'No invite code is configured. Set the INVITE_CODE secret and reload.'
    )
  }
  const hash = await sha256Hex(env.INVITE_CODE.trim())
  await env.DB.prepare(
    "INSERT INTO config (key, value) VALUES ('invite_code_hash', ?) ON CONFLICT (key) DO NOTHING"
  )
    .bind(hash)
    .run()
  return hash
}

export async function handleEnter(request: Request, env: Env, url: URL): Promise<Response> {
  await checkRateLimit(env, request)
  const body = (await request.json().catch(() => null)) as { code?: string } | null
  const code = body?.code?.trim()
  if (!code) throw new HttpError(400, 'Enter the invite code.')
  const expected = await getInviteCodeHash(env)
  const got = await sha256Hex(code)
  if (got !== expected) throw new HttpError(403, 'That code is not right. Check with family.')
  const token = await createSession(env, null)
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, url) })
}

export async function handleMe(session: SessionInfo | null): Promise<Response> {
  const me: MeResponse = { player: session?.player ?? null, hasSession: session !== null }
  return json(me)
}

export async function handleRoster(env: Env, session: SessionInfo | null): Promise<Response> {
  requireSession(session)
  const rows = await env.DB.prepare(
    'SELECT id, name, is_admin FROM players ORDER BY name COLLATE NOCASE'
  ).all<{ id: string; name: string; is_admin: number }>()
  const roster: RosterEntry[] = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    isAdmin: r.is_admin === 1
  }))
  return json(roster)
}

export async function handleClaim(
  request: Request,
  env: Env,
  session: SessionInfo | null
): Promise<Response> {
  const s = requireSession(session)
  const body = (await request.json().catch(() => null)) as
    | { playerId?: string; name?: string }
    | null

  let playerId: string
  if (body?.playerId) {
    const existing = await env.DB.prepare('SELECT id FROM players WHERE id = ?')
      .bind(body.playerId)
      .first<{ id: string }>()
    if (!existing) throw new HttpError(404, 'That player is not on the roster.')
    playerId = existing.id
  } else if (body?.name?.trim()) {
    const name = body.name.trim().slice(0, 40)
    const clash = await env.DB.prepare('SELECT id FROM players WHERE name = ? COLLATE NOCASE')
      .bind(name)
      .first()
    if (clash) throw new HttpError(409, 'That name is already on the roster. Pick it from the list.')
    playerId = randomId()
    // The very first player to join becomes the admin.
    const anyAdmin = await env.DB.prepare('SELECT id FROM players WHERE is_admin = 1 LIMIT 1').first()
    await env.DB.prepare(
      'INSERT INTO players (id, name, is_admin, created_at) VALUES (?, ?, ?, ?)'
    )
      .bind(playerId, name, anyAdmin ? 0 : 1, Date.now())
      .run()
  } else {
    throw new HttpError(400, 'Pick a player or enter a new name.')
  }

  await env.DB.prepare('UPDATE sessions SET player_id = ? WHERE token_hash = ?')
    .bind(playerId, s.tokenHash)
    .run()
  const player = await env.DB.prepare('SELECT id, name, is_admin FROM players WHERE id = ?')
    .bind(playerId)
    .first<{ id: string; name: string; is_admin: number }>()
  return json({ player: { id: player!.id, name: player!.name, isAdmin: player!.is_admin === 1 } })
}

export async function handleLogout(
  env: Env,
  session: SessionInfo | null,
  url: URL
): Promise<Response> {
  if (session) {
    await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?')
      .bind(Date.now(), session.tokenHash)
      .run()
  }
  const expired = sessionCookie('gone', url).replace(/Max-Age=\d+/, 'Max-Age=0')
  return json({ ok: true }, 200, { 'set-cookie': expired })
}
