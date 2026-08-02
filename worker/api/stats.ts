import type { Env } from '../env'
import { json, HttpError } from '../lib/http'
import { requireSession, type SessionInfo } from '../lib/session'

// A player's round counts for stats only when the card is complete: a
// score on every hole of the layout the round was played on. Rounds are
// permanently tied to their layout version, so historical numbers never
// shift when a new version is published.

interface RoundSummaryRow {
  round_id: string
  layout_id: string
  played_on: string
  player_id: string
  name: string
  total: number
  total_par: number
  version_number: number
  layout_name: string | null
}

async function roundSummaries(
  env: Env,
  opts: { layoutId?: string; playerId?: string }
): Promise<RoundSummaryRow[]> {
  const conditions = ["r.status = 'final'"]
  const binds: string[] = []
  if (opts.layoutId) {
    conditions.push('r.layout_id = ?')
    binds.push(opts.layoutId)
  }
  if (opts.playerId) {
    conditions.push('s.player_id = ?')
    binds.push(opts.playerId)
  }
  const rows = await env.DB.prepare(
    `SELECT r.id AS round_id, r.layout_id, r.played_on, s.player_id, p.name,
            SUM(s.strokes) AS total, COUNT(s.strokes) AS holes_scored,
            lp.total_par, lp.hole_count, l.version_number, l.name AS layout_name
     FROM rounds r
     JOIN (SELECT layout_id, SUM(par) AS total_par, COUNT(*) AS hole_count
           FROM layout_holes GROUP BY layout_id) lp ON lp.layout_id = r.layout_id
     JOIN layouts l ON l.id = r.layout_id
     JOIN scores s ON s.round_id = r.id AND s.strokes IS NOT NULL
     JOIN players p ON p.id = s.player_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY r.id, s.player_id
     HAVING COUNT(s.strokes) = lp.hole_count
     ORDER BY r.played_on, r.created_at`
  )
    .bind(...binds)
    .all<RoundSummaryRow>()
  return rows.results
}

export async function handleLeaderboard(
  env: Env,
  session: SessionInfo | null,
  url: URL
): Promise<Response> {
  requireSession(session)
  const layoutId = url.searchParams.get('layoutId') ?? undefined
  const rows = await roundSummaries(env, { layoutId })

  const byPlayer = new Map<
    string,
    {
      playerId: string
      name: string
      rounds: number
      bestTotal: number
      bestVsPar: number
      sumTotal: number
      sumVsPar: number
    }
  >()
  for (const row of rows) {
    const vsPar = row.total - row.total_par
    const entry = byPlayer.get(row.player_id) ?? {
      playerId: row.player_id,
      name: row.name,
      rounds: 0,
      bestTotal: Infinity,
      bestVsPar: Infinity,
      sumTotal: 0,
      sumVsPar: 0
    }
    entry.rounds++
    entry.sumTotal += row.total
    entry.sumVsPar += vsPar
    if (vsPar < entry.bestVsPar) entry.bestVsPar = vsPar
    if (row.total < entry.bestTotal) entry.bestTotal = row.total
    byPlayer.set(row.player_id, entry)
  }

  const board = [...byPlayer.values()]
    .map((e) => ({
      playerId: e.playerId,
      name: e.name,
      rounds: e.rounds,
      bestTotal: e.bestTotal,
      bestVsPar: e.bestVsPar,
      avgTotal: Math.round((e.sumTotal / e.rounds) * 10) / 10,
      avgVsPar: Math.round((e.sumVsPar / e.rounds) * 10) / 10
    }))
    .sort((a, b) => a.bestVsPar - b.bestVsPar || a.avgVsPar - b.avgVsPar)

  return json({ board, crossLayout: !layoutId })
}

export async function handleHoleStats(
  env: Env,
  session: SessionInfo | null,
  url: URL
): Promise<Response> {
  requireSession(session)
  const layoutId = url.searchParams.get('layoutId')
  if (!layoutId) throw new HttpError(400, 'layoutId is required.')

  const holes = await env.DB.prepare(
    'SELECT hole_number, par, name FROM layout_holes WHERE layout_id = ? ORDER BY sort_order'
  )
    .bind(layoutId)
    .all<{ hole_number: number; par: number; name: string | null }>()

  const rows = await env.DB.prepare(
    `SELECT s.hole_number, s.player_id, p.name, AVG(s.strokes) AS avg_strokes, COUNT(*) AS n
     FROM rounds r
     JOIN scores s ON s.round_id = r.id AND s.strokes IS NOT NULL
     JOIN players p ON p.id = s.player_id
     WHERE r.layout_id = ? AND r.status = 'final'
     GROUP BY s.hole_number, s.player_id`
  )
    .bind(layoutId)
    .all<{ hole_number: number; player_id: string; name: string; avg_strokes: number; n: number }>()

  return json({
    holes: holes.results.map((h) => ({
      holeNumber: h.hole_number,
      par: h.par,
      name: h.name
    })),
    perPlayer: rows.results.map((r) => ({
      holeNumber: r.hole_number,
      playerId: r.player_id,
      name: r.name,
      avg: Math.round(r.avg_strokes * 100) / 100,
      count: r.n
    }))
  })
}

export async function handleRecords(env: Env, session: SessionInfo | null): Promise<Response> {
  requireSession(session)
  const summaries = await roundSummaries(env, {})

  const lowRounds = summaries
    .map((r) => ({
      player: r.name,
      playerId: r.player_id,
      total: r.total,
      vsPar: r.total - r.total_par,
      playedOn: r.played_on,
      layoutVersion: r.version_number,
      layoutName: r.layout_name
    }))
    .sort((a, b) => a.vsPar - b.vsPar || a.total - b.total)
    .slice(0, 5)

  const birdieRows = await env.DB.prepare(
    `SELECT p.id AS player_id, p.name, COUNT(*) AS birdies
     FROM scores s
     JOIN rounds r ON r.id = s.round_id AND r.status = 'final'
     JOIN layout_holes h ON h.layout_id = r.layout_id AND h.hole_number = s.hole_number
     JOIN players p ON p.id = s.player_id
     WHERE s.strokes = h.par - 1
     GROUP BY s.player_id
     ORDER BY birdies DESC
     LIMIT 10`
  ).all<{ player_id: string; name: string; birdies: number }>()

  const aces = await env.DB.prepare(
    `SELECT p.name AS player, s.hole_number, r.played_on, l.version_number, l.name AS layout_name
     FROM scores s
     JOIN rounds r ON r.id = s.round_id AND r.status = 'final'
     JOIN layouts l ON l.id = r.layout_id
     JOIN players p ON p.id = s.player_id
     WHERE s.strokes = 1
     ORDER BY r.played_on DESC`
  ).all<{
    player: string
    hole_number: number
    played_on: string
    version_number: number
    layout_name: string | null
  }>()

  return json({
    lowRounds,
    birdies: birdieRows.results.map((b) => ({
      playerId: b.player_id,
      name: b.name,
      birdies: b.birdies
    })),
    aces: aces.results.map((a) => ({
      player: a.player,
      holeNumber: a.hole_number,
      playedOn: a.played_on,
      layoutVersion: a.version_number,
      layoutName: a.layout_name
    }))
  })
}

export async function handlePlayerProfile(
  env: Env,
  session: SessionInfo | null,
  playerId: string
): Promise<Response> {
  requireSession(session)
  const player = await env.DB.prepare('SELECT id, name FROM players WHERE id = ?')
    .bind(playerId)
    .first<{ id: string; name: string }>()
  if (!player) throw new HttpError(404, 'Player not found.')

  const rounds = await roundSummaries(env, { playerId })
  const history = rounds.map((r) => ({
    roundId: r.round_id,
    playedOn: r.played_on,
    total: r.total,
    vsPar: r.total - r.total_par,
    layoutVersion: r.version_number,
    layoutName: r.layout_name
  }))

  const counts = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN s.strokes = 1 THEN 1 ELSE 0 END) AS aces,
       SUM(CASE WHEN s.strokes = h.par - 1 THEN 1 ELSE 0 END) AS birdies
     FROM scores s
     JOIN rounds r ON r.id = s.round_id AND r.status = 'final'
     JOIN layout_holes h ON h.layout_id = r.layout_id AND h.hole_number = s.hole_number
     WHERE s.player_id = ?`
  )
    .bind(playerId)
    .first<{ aces: number | null; birdies: number | null }>()

  const best = history.length ? Math.min(...history.map((h) => h.vsPar)) : null

  return json({
    player,
    history,
    roundsPlayed: history.length,
    bestVsPar: best,
    aces: counts?.aces ?? 0,
    birdies: counts?.birdies ?? 0
  })
}
