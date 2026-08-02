import type { Env } from '../env'
import { json, HttpError } from '../lib/http'
import { randomId, requireAdmin, requireSession, type SessionInfo } from '../lib/session'
import { readMapConfig } from '../lib/mapConfig'
import { isValidLatLng } from '../../shared/geo'
import type { OverlayCorners, OverlayData } from '../../shared/types'

const MAX_OVERLAY_BYTES = 25 * 1024 * 1024
const TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
}

function rowToOverlay(r: Record<string, unknown>): OverlayData {
  return {
    id: String(r.id),
    name: (r.name as string | null) ?? null,
    imageKey: String(r.image_key),
    corners: {
      nw: { lat: Number(r.nw_lat), lng: Number(r.nw_lng) },
      ne: { lat: Number(r.ne_lat), lng: Number(r.ne_lng) },
      se: { lat: Number(r.se_lat), lng: Number(r.se_lng) },
      sw: { lat: Number(r.sw_lat), lng: Number(r.sw_lng) }
    },
    opacity: Number(r.opacity),
    isActive: Number(r.is_active) === 1
  }
}

async function getCourseId(env: Env): Promise<string> {
  const row = await env.DB.prepare('SELECT id FROM courses LIMIT 1').first<{ id: string }>()
  if (!row) throw new HttpError(400, 'Create the course first (open the editor once).')
  return row.id
}

export async function handleOverlayUpload(
  request: Request,
  env: Env,
  session: SessionInfo | null
): Promise<Response> {
  requireAdmin(session)
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const name = String(form?.get('name') ?? '').trim().slice(0, 60) || null
  if (!(file instanceof File)) throw new HttpError(400, 'Attach the drone image.')
  if (file.size > MAX_OVERLAY_BYTES) throw new HttpError(413, 'Image is too large (25 MB max).')
  const ext = TYPES[file.type]
  if (!ext) throw new HttpError(415, 'Use a JPEG, PNG, or WebP image.')

  // New overlays start aligned to the configured property box; the admin
  // then drags the four corners into place. Corners are stored so the
  // alignment is reproducible.
  const config = readMapConfig(env)
  if ('missing' in config) {
    throw new HttpError(503, 'Set the property location before uploading an overlay.')
  }
  const { ne, sw } = config.bounds

  const id = randomId()
  const key = `uploads/overlays/${id}${ext}`
  await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type } })

  await env.DB.prepare(
    `INSERT INTO overlays
     (id, course_id, name, image_key, nw_lat, nw_lng, ne_lat, ne_lng,
      se_lat, se_lng, sw_lat, sw_lng, opacity, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.9, 0, ?)`
  )
    .bind(
      id,
      await getCourseId(env),
      name,
      key,
      ne.lat, sw.lng,
      ne.lat, ne.lng,
      sw.lat, ne.lng,
      sw.lat, sw.lng,
      Date.now()
    )
    .run()

  const row = await env.DB.prepare('SELECT * FROM overlays WHERE id = ?').bind(id).first()
  return json(rowToOverlay(row as Record<string, unknown>), 201)
}

export async function handleOverlayList(env: Env, session: SessionInfo | null): Promise<Response> {
  requireAdmin(session)
  const rows = await env.DB.prepare('SELECT * FROM overlays ORDER BY created_at DESC').all()
  return json(rows.results.map((r) => rowToOverlay(r as Record<string, unknown>)))
}

export async function handleActiveOverlay(env: Env, session: SessionInfo | null): Promise<Response> {
  requireSession(session)
  const row = await env.DB.prepare('SELECT * FROM overlays WHERE is_active = 1 LIMIT 1').first()
  return json(row ? rowToOverlay(row as Record<string, unknown>) : null)
}

function validCorners(c: unknown): c is OverlayCorners {
  if (!c || typeof c !== 'object') return false
  const corners = c as OverlayCorners
  return (['nw', 'ne', 'se', 'sw'] as const).every((k) => isValidLatLng(corners[k]))
}

export async function handleOverlayUpdate(
  request: Request,
  env: Env,
  session: SessionInfo | null,
  overlayId: string
): Promise<Response> {
  requireAdmin(session)
  const existing = await env.DB.prepare('SELECT * FROM overlays WHERE id = ?')
    .bind(overlayId)
    .first()
  if (!existing) throw new HttpError(404, 'Overlay not found.')

  const body = (await request.json().catch(() => null)) as {
    corners?: unknown
    opacity?: number
    isActive?: boolean
    name?: string
  } | null
  if (!body) throw new HttpError(400, 'Bad payload.')

  if (body.corners !== undefined) {
    if (!validCorners(body.corners)) throw new HttpError(400, 'Corners are not valid coordinates.')
    const c = body.corners
    await env.DB.prepare(
      `UPDATE overlays SET nw_lat=?, nw_lng=?, ne_lat=?, ne_lng=?, se_lat=?, se_lng=?, sw_lat=?, sw_lng=?
       WHERE id = ?`
    )
      .bind(c.nw.lat, c.nw.lng, c.ne.lat, c.ne.lng, c.se.lat, c.se.lng, c.sw.lat, c.sw.lng, overlayId)
      .run()
  }
  if (body.opacity !== undefined) {
    const op = Number(body.opacity)
    if (!Number.isFinite(op) || op < 0.05 || op > 1) throw new HttpError(400, 'Opacity must be between 0.05 and 1.')
    await env.DB.prepare('UPDATE overlays SET opacity = ? WHERE id = ?').bind(op, overlayId).run()
  }
  if (body.name !== undefined) {
    await env.DB.prepare('UPDATE overlays SET name = ? WHERE id = ?')
      .bind(String(body.name).trim().slice(0, 60) || null, overlayId)
      .run()
  }
  if (body.isActive !== undefined) {
    if (body.isActive) {
      await env.DB.batch([
        env.DB.prepare('UPDATE overlays SET is_active = 0'),
        env.DB.prepare('UPDATE overlays SET is_active = 1 WHERE id = ?').bind(overlayId)
      ])
    } else {
      await env.DB.prepare('UPDATE overlays SET is_active = 0 WHERE id = ?').bind(overlayId).run()
    }
  }

  const row = await env.DB.prepare('SELECT * FROM overlays WHERE id = ?').bind(overlayId).first()
  return json(rowToOverlay(row as Record<string, unknown>))
}

export async function handleOverlayDelete(
  env: Env,
  session: SessionInfo | null,
  overlayId: string
): Promise<Response> {
  requireAdmin(session)
  const row = await env.DB.prepare('SELECT image_key FROM overlays WHERE id = ?')
    .bind(overlayId)
    .first<{ image_key: string }>()
  if (!row) throw new HttpError(404, 'Overlay not found.')
  await env.MEDIA.delete(row.image_key)
  await env.DB.prepare('DELETE FROM overlays WHERE id = ?').bind(overlayId).run()
  return json({ ok: true })
}
