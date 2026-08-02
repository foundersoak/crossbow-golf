import type { Env } from '../env'
import { json, HttpError } from '../lib/http'
import { randomId, requireAdmin, sha256Hex, type SessionInfo } from '../lib/session'

export async function handleAddPlayer(
  request: Request,
  env: Env,
  session: SessionInfo | null
): Promise<Response> {
  requireAdmin(session)
  const body = (await request.json().catch(() => null)) as { name?: string } | null
  const name = body?.name?.trim().slice(0, 40)
  if (!name) throw new HttpError(400, 'Enter a name.')
  const clash = await env.DB.prepare('SELECT id FROM players WHERE name = ? COLLATE NOCASE')
    .bind(name)
    .first()
  if (clash) throw new HttpError(409, 'That name is already on the roster.')
  const id = randomId()
  await env.DB.prepare('INSERT INTO players (id, name, is_admin, created_at) VALUES (?, ?, 0, ?)')
    .bind(id, name, Date.now())
    .run()
  return json({ id, name, isAdmin: false })
}

export async function handleSetAdmin(
  request: Request,
  env: Env,
  session: SessionInfo | null,
  playerId: string
): Promise<Response> {
  const s = requireAdmin(session)
  const body = (await request.json().catch(() => null)) as { isAdmin?: boolean } | null
  if (typeof body?.isAdmin !== 'boolean') throw new HttpError(400, 'Missing isAdmin.')
  if (!body.isAdmin && playerId === s.player.id) {
    throw new HttpError(400, 'You cannot remove your own admin access.')
  }
  const res = await env.DB.prepare('UPDATE players SET is_admin = ? WHERE id = ?')
    .bind(body.isAdmin ? 1 : 0, playerId)
    .run()
  if (res.meta.changes === 0) throw new HttpError(404, 'Player not found.')
  return json({ ok: true })
}

export async function handleRenamePlayer(
  request: Request,
  env: Env,
  session: SessionInfo | null,
  playerId: string
): Promise<Response> {
  requireAdmin(session)
  const body = (await request.json().catch(() => null)) as { name?: string } | null
  const name = body?.name?.trim().slice(0, 40)
  if (!name) throw new HttpError(400, 'Enter a name.')
  const res = await env.DB.prepare('UPDATE players SET name = ? WHERE id = ?')
    .bind(name, playerId)
    .run()
  if (res.meta.changes === 0) throw new HttpError(404, 'Player not found.')
  return json({ ok: true })
}

export async function handleRotateInviteCode(
  request: Request,
  env: Env,
  session: SessionInfo | null
): Promise<Response> {
  requireAdmin(session)
  const body = (await request.json().catch(() => null)) as { code?: string } | null
  const code = body?.code?.trim()
  if (!code || code.length < 12) {
    throw new HttpError(400, 'Use at least 12 characters for the new code.')
  }
  const hash = await sha256Hex(code)
  await env.DB.prepare(
    "INSERT INTO config (key, value) VALUES ('invite_code_hash', ?) " +
      'ON CONFLICT (key) DO UPDATE SET value = excluded.value'
  )
    .bind(hash)
    .run()
  return json({ ok: true })
}
