import type { Env } from '../env'
import { HttpError } from './http'
import type { PlayerInfo } from '../../shared/types'

const COOKIE_NAME = 'cg_session'
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000

export interface SessionInfo {
  tokenHash: string
  player: PlayerInfo | null
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 20)
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return null
}

export function sessionCookie(token: string, url: URL): string {
  const secure = url.protocol === 'https:' ? ' Secure;' : ''
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}`
}

export async function createSession(env: Env, playerId: string | null): Promise<string> {
  const token = randomToken()
  const hash = await sha256Hex(token)
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, player_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)'
  )
    .bind(hash, playerId, now, now)
    .run()
  return token
}

export async function getSession(request: Request, env: Env): Promise<SessionInfo | null> {
  const token = readCookie(request, COOKIE_NAME)
  if (!token) return null
  const hash = await sha256Hex(token)
  const row = await env.DB.prepare(
    `SELECT s.token_hash, s.revoked_at, s.created_at, p.id AS player_id, p.name, p.is_admin
     FROM sessions s LEFT JOIN players p ON p.id = s.player_id
     WHERE s.token_hash = ?`
  )
    .bind(hash)
    .first<{
      token_hash: string
      revoked_at: number | null
      created_at: number
      player_id: string | null
      name: string | null
      is_admin: number | null
    }>()
  if (!row || row.revoked_at !== null) return null
  if (Date.now() - row.created_at > SESSION_TTL_MS) return null

  const player: PlayerInfo | null = row.player_id
    ? { id: row.player_id, name: row.name!, isAdmin: row.is_admin === 1 }
    : null
  return { tokenHash: row.token_hash, player }
}

export async function touchSession(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
    .bind(Date.now(), tokenHash)
    .run()
}

export function requireSession(session: SessionInfo | null): SessionInfo {
  if (!session) throw new HttpError(401, 'Enter the family invite code to use the app.')
  return session
}

export function requirePlayer(session: SessionInfo | null): SessionInfo & { player: PlayerInfo } {
  const s = requireSession(session)
  if (!s.player) throw new HttpError(403, 'Pick your name from the roster first.')
  return s as SessionInfo & { player: PlayerInfo }
}

export function requireAdmin(session: SessionInfo | null): SessionInfo & { player: PlayerInfo } {
  const s = requirePlayer(session)
  if (!s.player.isAdmin) throw new HttpError(403, 'Only admins can do that.')
  return s
}
