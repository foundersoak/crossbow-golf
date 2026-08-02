import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiGet } from '../lib/api'

interface Profile {
  player: { id: string; name: string }
  history: {
    roundId: string
    playedOn: string
    total: number
    vsPar: number
    layoutVersion: number
    layoutName: string | null
  }[]
  roundsPlayed: number
  bestVsPar: number | null
  aces: number
  birdies: number
}

function fmtVsPar(v: number): string {
  if (v === 0) return 'E'
  return v > 0 ? `+${v}` : String(v)
}

export default function ProfileScreen() {
  const { id } = useParams<{ id: string }>()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    apiGet<Profile>(`/api/stats/player/${id}`)
      .then(setProfile)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load profile.'))
  }, [id])

  if (error) {
    return (
      <div className="page">
        <p className="form-error">{error}</p>
      </div>
    )
  }
  if (!profile) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>{profile.player.name}</h1>
      </header>

      <div className="stat-callouts">
        <div className="stat-callout">
          <span className="stat-label">Rounds</span>
          <span className="stat-value">{profile.roundsPlayed}</span>
        </div>
        <div className="stat-callout">
          <span className="stat-label">Best</span>
          <span className="stat-value">
            {profile.bestVsPar === null ? '·' : fmtVsPar(profile.bestVsPar)}
          </span>
        </div>
        <div className="stat-callout">
          <span className="stat-label">Birdies</span>
          <span className="stat-value">{profile.birdies}</span>
        </div>
        <div className="stat-callout">
          <span className="stat-label">Aces</span>
          <span className="stat-value">{profile.aces}</span>
        </div>
      </div>

      {profile.history.length >= 2 && <TrendChart history={profile.history} />}

      <h2>Round history</h2>
      {profile.history.length === 0 && <p className="muted">No completed full rounds yet.</p>}
      <ul className="card-list">
        {[...profile.history].reverse().map((h) => (
          <li key={h.roundId + h.playedOn} className="card card-row">
            <div className="card-main">
              <span className="card-title">
                {fmtVsPar(h.vsPar)} ({h.total})
              </span>
              <span className="card-sub">
                {h.playedOn} · layout v{h.layoutVersion}
                {h.layoutName ? ` (${h.layoutName})` : ''}
              </span>
            </div>
            <Link className="btn btn-small" to={`/rounds/${h.roundId}`}>
              Card
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Score trend over time, vs par. Down is good. Plain SVG, no libraries. */
function TrendChart({ history }: { history: Profile['history'] }) {
  const w = 320
  const h = 96
  const pad = 10
  const values = history.map((r) => r.vsPar)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 1)
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1)
  const y = (v: number) => pad + ((max - v) * (h - pad * 2)) / Math.max(1, max - min)
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  return (
    <div className="trend-chart">
      <p className="field-label">Trend, score vs par by round</p>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Score trend over time">
        {min <= 0 && max >= 0 && (
          <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} className="trend-par-line" />
        )}
        <polyline points={points} className="trend-line" fill="none" />
        {values.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="3.5" className="trend-dot" />
        ))}
      </svg>
      <p className="muted small">Par is the flat line. Lower is better.</p>
    </div>
  )
}
