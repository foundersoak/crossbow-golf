import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../lib/api'
import type { LayoutSummary } from '../../shared/types'
import CountyMedallion from '../components/CountyMedallion'

type Tab = 'leaderboard' | 'holes' | 'records'

interface BoardRow {
  playerId: string
  name: string
  rounds: number
  bestTotal: number
  bestVsPar: number
  avgTotal: number
  avgVsPar: number
}

function fmtVsPar(v: number): string {
  if (v === 0) return 'E'
  return v > 0 ? `+${v}` : String(v)
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

function vsParClass(v: number): string {
  return v < 0 ? 'score-under' : v === 0 ? 'score-even' : 'score-over'
}

export default function BoardsScreen() {
  const [tab, setTab] = useState<Tab>('leaderboard')
  const [layouts, setLayouts] = useState<LayoutSummary[]>([])
  const [layoutId, setLayoutId] = useState<string | 'all' | null>(null)

  useEffect(() => {
    apiGet<LayoutSummary[]>('/api/layouts')
      .then((list) => {
        setLayouts(list)
        setLayoutId((prev) => prev ?? (list[0]?.id ?? 'all'))
      })
      .catch(() => setLayouts([]))
  }, [])

  const layoutLabel = (id: string) => {
    const l = layouts.find((x) => x.id === id)
    return l ? `v${l.versionNumber}${l.name ? ` · ${l.name}` : ''}` : ''
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-brand">
          <CountyMedallion className="medallion-stamp" />
          <h1>Boards</h1>
        </div>
      </header>

      <div className="tab-row">
        {(
          [
            ['leaderboard', 'Leaderboard'],
            ['holes', 'Holes'],
            ['records', 'Records']
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'chip chip-active' : 'chip'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab !== 'records' && layouts.length > 0 && layoutId && (
        <div className="layout-picker">
          <label className="field-label" htmlFor="layout-pick">
            Course version
          </label>
          <select
            id="layout-pick"
            className="text-input"
            value={layoutId}
            onChange={(e) => setLayoutId(e.target.value as string | 'all')}
          >
            {layouts.map((l, i) => (
              <option key={l.id} value={l.id}>
                v{l.versionNumber}
                {l.name ? ` · ${l.name}` : ''}
                {i === 0 ? ' (current)' : ''}
              </option>
            ))}
            {tab === 'leaderboard' && <option value="all">All layouts combined</option>}
          </select>
        </div>
      )}

      {tab === 'leaderboard' && layoutId && (
        <Leaderboard layoutId={layoutId} layoutLabel={layoutLabel} />
      )}
      {tab === 'holes' && layoutId && layoutId !== 'all' && <HoleStats layoutId={layoutId} />}
      {tab === 'records' && <Records />}

      {layouts.length === 0 && (
        <p className="muted">Boards light up once a layout is published and rounds are completed.</p>
      )}
    </div>
  )
}

function Leaderboard({
  layoutId,
  layoutLabel
}: {
  layoutId: string | 'all'
  layoutLabel: (id: string) => string
}) {
  const [board, setBoard] = useState<BoardRow[] | null>(null)
  const cross = layoutId === 'all'

  useEffect(() => {
    setBoard(null)
    const qs = cross ? '' : `?layoutId=${layoutId}`
    apiGet<{ board: BoardRow[] }>(`/api/stats/leaderboard${qs}`)
      .then((d) => setBoard(d.board))
      .catch(() => setBoard([]))
  }, [layoutId, cross])

  return (
    <section>
      {cross && (
        <p className="cross-layout-note">
          Spans multiple course layouts. Holes and pars differed between versions, so compare
          gently. Scores shown against each round's own par.
        </p>
      )}
      {!cross && <p className="muted small">Leaderboard for {layoutLabel(layoutId)}.</p>}
      {board === null && <p className="muted">Loading…</p>}
      {board?.length === 0 && <p className="muted">No completed full rounds yet.</p>}
      {board && board.length > 0 && (
        <ol className="lb-list">
          {board.map((row, i) => {
            // Tied ranks read as T2, T2, 4 — the way tour boards do it.
            const firstAt = board.findIndex((r) => r.bestVsPar === row.bestVsPar)
            const tied = board.filter((r) => r.bestVsPar === row.bestVsPar).length > 1
            const rank = `${tied ? 'T' : ''}${firstAt + 1}`
            return (
              <li key={row.playerId} className={i === 0 ? 'lb-row lb-leader' : 'lb-row'}>
                <span className="lb-rank">{rank}</span>
                <span className="avatar-initials" aria-hidden>
                  {initials(row.name)}
                </span>
                <div className="lb-main">
                  {i === 0 && <span className="lb-kicker">Leader</span>}
                  <Link className="lb-name" to={`/players/${row.playerId}`}>
                    {row.name}
                  </Link>
                  <span className="lb-sub">
                    {row.rounds} round{row.rounds === 1 ? '' : 's'} · avg{' '}
                    {fmtVsPar(row.avgVsPar)}
                    {!cross && ` (${row.avgTotal})`}
                  </span>
                </div>
                <div className="lb-score">
                  <span className={`lb-best ${vsParClass(row.bestVsPar)}`}>
                    {fmtVsPar(row.bestVsPar)}
                  </span>
                  <span className="lb-score-label">
                    {cross ? 'best' : `best · ${row.bestTotal}`}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function HoleStats({ layoutId }: { layoutId: string }) {
  const [data, setData] = useState<{
    holes: { holeNumber: number; par: number; name: string | null }[]
    perPlayer: { holeNumber: number; playerId: string; name: string; avg: number; count: number }[]
  } | null>(null)

  useEffect(() => {
    setData(null)
    apiGet<typeof data>(`/api/stats/holes?layoutId=${layoutId}`)
      .then(setData)
      .catch(() => setData({ holes: [], perPlayer: [] }))
  }, [layoutId])

  const overall = useMemo(() => {
    if (!data) return []
    return data.holes.map((h) => {
      const rows = data.perPlayer.filter((p) => p.holeNumber === h.holeNumber)
      const total = rows.reduce((s, r) => s + r.avg * r.count, 0)
      const n = rows.reduce((s, r) => s + r.count, 0)
      return {
        ...h,
        avg: n > 0 ? total / n : null,
        overPar: n > 0 ? total / n - h.par : null
      }
    })
  }, [data])

  const ranked = overall.filter((h) => h.overPar !== null)
  const hardest = ranked.length ? ranked.reduce((a, b) => (a.overPar! > b.overPar! ? a : b)) : null
  const easiest = ranked.length ? ranked.reduce((a, b) => (a.overPar! < b.overPar! ? a : b)) : null

  if (!data) return <p className="muted">Loading…</p>
  if (ranked.length === 0) return <p className="muted">No completed rounds on this layout yet.</p>

  return (
    <section>
      <div className="stat-callouts">
        {hardest && (
          <div className="stat-callout">
            <span className="stat-label">Hardest</span>
            <span className="stat-value">Hole {hardest.holeNumber}</span>
            <span className="muted small">+{hardest.overPar!.toFixed(2)} over par</span>
          </div>
        )}
        {easiest && (
          <div className="stat-callout">
            <span className="stat-label">Easiest</span>
            <span className="stat-value">Hole {easiest.holeNumber}</span>
            <span className="muted small">
              {easiest.overPar! >= 0 ? '+' : ''}
              {easiest.overPar!.toFixed(2)} vs par
            </span>
          </div>
        )}
      </div>
      <div className="board-table-wrap">
        <table className="board-table">
          <thead>
            <tr>
              <th>Hole</th>
              <th>Par</th>
              <th>Group average</th>
            </tr>
          </thead>
          <tbody>
            {overall.map((h) => (
              <tr key={h.holeNumber}>
                <td>
                  {h.holeNumber}
                  {h.name ? ` · ${h.name}` : ''}
                </td>
                <td>{h.par}</td>
                <td>
                  {h.avg === null ? (
                    '·'
                  ) : (
                    <span className={vsParClass(h.overPar!)}>{h.avg.toFixed(2)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Records() {
  const [data, setData] = useState<{
    lowRounds: {
      player: string
      playerId: string
      total: number
      vsPar: number
      playedOn: string
      layoutVersion: number
      layoutName: string | null
    }[]
    birdies: { playerId: string; name: string; birdies: number }[]
    aces: {
      player: string
      holeNumber: number
      playedOn: string
      layoutVersion: number
      layoutName: string | null
    }[]
  } | null>(null)

  useEffect(() => {
    apiGet<typeof data>('/api/stats/records')
      .then(setData)
      .catch(() => setData({ lowRounds: [], birdies: [], aces: [] }))
  }, [])

  if (!data) return <p className="muted">Loading…</p>

  return (
    <section>
      <p className="cross-layout-note">All-time records. Spans every course layout version.</p>

      <h2>Low rounds</h2>
      {data.lowRounds.length === 0 && <p className="muted">None yet.</p>}
      <ol className="lb-list">
        {data.lowRounds.map((r, i) => (
          <li key={i} className={i === 0 ? 'lb-row lb-leader' : 'lb-row'}>
            <span className="lb-rank">{i + 1}</span>
            <span className="avatar-initials" aria-hidden>
              {initials(r.player)}
            </span>
            <div className="lb-main">
              {i === 0 && <span className="lb-kicker">Course record</span>}
              <Link className="lb-name" to={`/players/${r.playerId}`}>
                {r.player}
              </Link>
              <span className="lb-sub">
                {r.playedOn} · layout v{r.layoutVersion}
                {r.layoutName ? ` (${r.layoutName})` : ''}
              </span>
            </div>
            <div className="lb-score">
              <span className={`lb-best ${vsParClass(r.vsPar)}`}>{fmtVsPar(r.vsPar)}</span>
              <span className="lb-score-label">{r.total} strokes</span>
            </div>
          </li>
        ))}
      </ol>

      <h2>Most birdies</h2>
      {data.birdies.length === 0 && <p className="muted">None yet. Aim smaller.</p>}
      <ol className="lb-list">
        {data.birdies.map((b, i) => (
          <li key={b.playerId} className="lb-row">
            <span className="lb-rank">{i + 1}</span>
            <span className="avatar-initials" aria-hidden>
              {initials(b.name)}
            </span>
            <div className="lb-main">
              <Link className="lb-name" to={`/players/${b.playerId}`}>
                {b.name}
              </Link>
            </div>
            <div className="lb-score">
              <span className="lb-best score-under">{b.birdies}</span>
              <span className="lb-score-label">birdie{b.birdies === 1 ? '' : 's'}</span>
            </div>
          </li>
        ))}
      </ol>

      <h2>Ace log</h2>
      {data.aces.length === 0 && <p className="muted">The board is waiting for its first hole-in-one.</p>}
      <ul className="card-list">
        {data.aces.map((a, i) => (
          <li key={i} className="card card-row">
            <div className="card-main">
              <span className="card-title">
                {a.player} · hole {a.holeNumber}
              </span>
              <span className="card-sub">
                {a.playedOn} · layout v{a.layoutVersion}
                {a.layoutName ? ` (${a.layoutName})` : ''}
              </span>
            </div>
            <span className="ace-mark">1</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
