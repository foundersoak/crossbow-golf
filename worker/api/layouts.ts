import type { Env } from '../env'
import { json, HttpError } from '../lib/http'
import { randomId, requireAdmin, requireSession, type SessionInfo } from '../lib/session'
import { holeYards, isValidLatLng } from '../../shared/geo'
import type { DraftHoleInput, HoleData, LayoutData, LayoutSummary } from '../../shared/types'

async function getOrCreateCourseId(env: Env): Promise<string> {
  const row = await env.DB.prepare('SELECT id FROM courses LIMIT 1').first<{ id: string }>()
  if (row) return row.id
  const id = randomId()
  await env.DB.prepare('INSERT INTO courses (id, name, created_at) VALUES (?, ?, ?)')
    .bind(id, 'Crossbow Ranch', Date.now())
    .run()
  return id
}

function rowToHole(r: Record<string, unknown>): HoleData {
  const tee =
    typeof r.tee_lat === 'number' && typeof r.tee_lng === 'number'
      ? { lat: r.tee_lat, lng: r.tee_lng }
      : null
  const pin =
    typeof r.pin_lat === 'number' && typeof r.pin_lng === 'number'
      ? { lat: r.pin_lat, lng: r.pin_lng }
      : null
  return {
    id: String(r.id),
    holeNumber: Number(r.hole_number),
    name: (r.name as string | null) ?? null,
    par: Number(r.par),
    tee,
    pin,
    distanceYards: r.distance_yards === null ? null : Number(r.distance_yards),
    notes: (r.notes as string | null) ?? null,
    photoKey: (r.photo_key as string | null) ?? null,
    sortOrder: Number(r.sort_order)
  }
}

async function loadLayout(env: Env, layoutId: string): Promise<LayoutData | null> {
  const layout = await env.DB.prepare(
    `SELECT l.*, p.name AS published_by_name FROM layouts l
     LEFT JOIN players p ON p.id = l.published_by WHERE l.id = ?`
  )
    .bind(layoutId)
    .first<Record<string, unknown>>()
  if (!layout) return null
  const holes = await env.DB.prepare(
    'SELECT * FROM layout_holes WHERE layout_id = ? ORDER BY sort_order'
  )
    .bind(layoutId)
    .all<Record<string, unknown>>()
  return {
    id: String(layout.id),
    status: layout.status as 'draft' | 'published',
    versionNumber: layout.version_number === null ? null : Number(layout.version_number),
    name: (layout.name as string | null) ?? null,
    notes: (layout.notes as string | null) ?? null,
    publishedAt: layout.published_at === null ? null : Number(layout.published_at),
    publishedByName: (layout.published_by_name as string | null) ?? null,
    holes: holes.results.map(rowToHole)
  }
}

export async function handleLayoutList(env: Env, session: SessionInfo | null): Promise<Response> {
  requireSession(session)
  const rows = await env.DB.prepare(
    `SELECT l.id, l.version_number, l.name, l.published_at, p.name AS publisher,
            COUNT(h.id) AS hole_count,
            COALESCE(SUM(h.par), 0) AS total_par,
            COALESCE(SUM(h.distance_yards), 0) AS total_yards
     FROM layouts l
     LEFT JOIN players p ON p.id = l.published_by
     LEFT JOIN layout_holes h ON h.layout_id = l.id
     WHERE l.status = 'published'
     GROUP BY l.id
     ORDER BY l.version_number DESC`
  ).all<Record<string, unknown>>()
  const list: LayoutSummary[] = rows.results.map((r) => ({
    id: String(r.id),
    versionNumber: Number(r.version_number),
    name: (r.name as string | null) ?? null,
    publishedAt: Number(r.published_at),
    publishedByName: (r.publisher as string | null) ?? null,
    holeCount: Number(r.hole_count),
    totalPar: Number(r.total_par),
    totalYards: Number(r.total_yards)
  }))
  return json(list)
}

export async function handleCurrentLayout(env: Env, session: SessionInfo | null): Promise<Response> {
  requireSession(session)
  const row = await env.DB.prepare(
    "SELECT id FROM layouts WHERE status = 'published' ORDER BY version_number DESC LIMIT 1"
  ).first<{ id: string }>()
  if (!row) return json(null)
  return json(await loadLayout(env, row.id))
}

export async function handleLayoutById(
  env: Env,
  session: SessionInfo | null,
  layoutId: string
): Promise<Response> {
  requireSession(session)
  const layout = await loadLayout(env, layoutId)
  if (!layout) throw new HttpError(404, 'Layout not found.')
  if (layout.status === 'draft') requireAdmin(session)
  return json(layout)
}

/** Admin: fetch the draft, creating it from the latest published layout if needed. */
export async function handleGetDraft(env: Env, session: SessionInfo | null): Promise<Response> {
  requireAdmin(session)
  const courseId = await getOrCreateCourseId(env)
  const existing = await env.DB.prepare(
    "SELECT id FROM layouts WHERE course_id = ? AND status = 'draft' LIMIT 1"
  )
    .bind(courseId)
    .first<{ id: string }>()
  if (existing) return json(await loadLayout(env, existing.id))

  const draftId = randomId()
  await env.DB.prepare(
    'INSERT INTO layouts (id, course_id, status, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(draftId, courseId, 'draft', Date.now())
    .run()

  // Start the draft from the current published layout when there is one.
  const latest = await env.DB.prepare(
    "SELECT id FROM layouts WHERE course_id = ? AND status = 'published' ORDER BY version_number DESC LIMIT 1"
  )
    .bind(courseId)
    .first<{ id: string }>()
  if (latest) {
    const holes = await env.DB.prepare(
      'SELECT * FROM layout_holes WHERE layout_id = ? ORDER BY sort_order'
    )
      .bind(latest.id)
      .all<Record<string, unknown>>()
    const stmts = holes.results.map((h) =>
      env.DB.prepare(
        `INSERT INTO layout_holes
         (id, layout_id, hole_number, name, par, tee_lat, tee_lng, pin_lat, pin_lng,
          distance_yards, notes, photo_key, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        randomId(),
        draftId,
        h.hole_number,
        h.name,
        h.par,
        h.tee_lat,
        h.tee_lng,
        h.pin_lat,
        h.pin_lng,
        h.distance_yards,
        h.notes,
        h.photo_key,
        h.sort_order
      )
    )
    if (stmts.length > 0) await env.DB.batch(stmts)
  }
  return json(await loadLayout(env, draftId))
}

function validateDraftHoles(input: unknown): DraftHoleInput[] {
  if (!Array.isArray(input)) throw new HttpError(400, 'Expected a list of holes.')
  if (input.length > 36) throw new HttpError(400, 'Too many holes.')
  return input.map((h, i) => {
    const hole = h as DraftHoleInput
    const par = Number(hole.par ?? 3)
    if (!Number.isInteger(par) || par < 1 || par > 10) {
      throw new HttpError(400, `Hole ${i + 1}: par must be between 1 and 10.`)
    }
    if (hole.tee != null && !isValidLatLng(hole.tee)) {
      throw new HttpError(400, `Hole ${i + 1}: tee position is not valid.`)
    }
    if (hole.pin != null && !isValidLatLng(hole.pin)) {
      throw new HttpError(400, `Hole ${i + 1}: pin position is not valid.`)
    }
    return hole
  })
}

/** Admin: replace the draft's holes wholesale (the editor autosaves this way). */
export async function handleSaveDraft(
  request: Request,
  env: Env,
  session: SessionInfo | null
): Promise<Response> {
  requireAdmin(session)
  const courseId = await getOrCreateCourseId(env)
  const draft = await env.DB.prepare(
    "SELECT id FROM layouts WHERE course_id = ? AND status = 'draft' LIMIT 1"
  )
    .bind(courseId)
    .first<{ id: string }>()
  if (!draft) throw new HttpError(404, 'No draft to save. Open the editor first.')

  const body = (await request.json().catch(() => null)) as { holes?: unknown } | null
  const holes = validateDraftHoles(body?.holes)

  const stmts = [
    env.DB.prepare('DELETE FROM layout_holes WHERE layout_id = ?').bind(draft.id),
    ...holes.map((h, i) => {
      const distance =
        h.tee && h.pin ? holeYards(h.tee, h.pin) : null
      return env.DB.prepare(
        `INSERT INTO layout_holes
         (id, layout_id, hole_number, name, par, tee_lat, tee_lng, pin_lat, pin_lng,
          distance_yards, notes, photo_key, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        h.id ?? randomId(),
        draft.id,
        h.holeNumber ?? i + 1,
        h.name?.trim() || null,
        h.par,
        h.tee?.lat ?? null,
        h.tee?.lng ?? null,
        h.pin?.lat ?? null,
        h.pin?.lng ?? null,
        distance,
        h.notes?.trim() || null,
        h.photoKey ?? null,
        i
      )
    })
  ]
  await env.DB.batch(stmts)
  return json(await loadLayout(env, draft.id))
}

/** Admin: snapshot the draft into a new immutable published version. */
export async function handlePublishDraft(
  request: Request,
  env: Env,
  session: SessionInfo | null
): Promise<Response> {
  const s = requireAdmin(session)
  const courseId = await getOrCreateCourseId(env)
  const draft = await env.DB.prepare(
    "SELECT id FROM layouts WHERE course_id = ? AND status = 'draft' LIMIT 1"
  )
    .bind(courseId)
    .first<{ id: string }>()
  if (!draft) throw new HttpError(404, 'There is no draft to publish.')

  const holes = await env.DB.prepare(
    'SELECT * FROM layout_holes WHERE layout_id = ? ORDER BY sort_order'
  )
    .bind(draft.id)
    .all<Record<string, unknown>>()
  if (holes.results.length === 0) {
    throw new HttpError(400, 'Add at least one hole before publishing.')
  }
  for (const h of holes.results) {
    if (h.tee_lat === null || h.pin_lat === null) {
      throw new HttpError(
        400,
        `Hole ${h.hole_number} needs both a tee and a pin before publishing.`
      )
    }
  }

  const body = (await request.json().catch(() => null)) as { name?: string } | null
  const name = body?.name?.trim() || null

  const versionRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(version_number), 0) AS v FROM layouts WHERE course_id = ? AND status = 'published'"
  )
    .bind(courseId)
    .first<{ v: number }>()
  const nextVersion = (versionRow?.v ?? 0) + 1

  const publishedId = randomId()
  const now = Date.now()
  const stmts = [
    env.DB.prepare(
      `INSERT INTO layouts (id, course_id, status, version_number, name, published_at, published_by, created_at)
       VALUES (?, ?, 'published', ?, ?, ?, ?, ?)`
    ).bind(publishedId, courseId, nextVersion, name, now, s.player.id, now),
    ...holes.results.map((h) => {
      const tee = { lat: Number(h.tee_lat), lng: Number(h.tee_lng) }
      const pin = { lat: Number(h.pin_lat), lng: Number(h.pin_lng) }
      return env.DB.prepare(
        `INSERT INTO layout_holes
         (id, layout_id, hole_number, name, par, tee_lat, tee_lng, pin_lat, pin_lng,
          distance_yards, notes, photo_key, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        randomId(),
        publishedId,
        h.hole_number,
        h.name,
        h.par,
        tee.lat,
        tee.lng,
        pin.lat,
        pin.lng,
        holeYards(tee, pin),
        h.notes,
        h.photo_key,
        h.sort_order
      )
    })
  ]
  await env.DB.batch(stmts)
  return json(await loadLayout(env, publishedId))
}
