import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiGet } from '../lib/api'

interface RoundListItem {
  id: string
  playedOn: string
  status: string
  joinCode: string
  createdAt: number
  completedAt: number | null
  playerNames: string
}

export default function RoundsScreen() {
  const [rounds, setRounds] = useState<RoundListItem[] | null>(null)
  const [code, setCode] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    apiGet<RoundListItem[]>('/api/rounds')
      .then(setRounds)
      .catch(() => setRounds([]))
  }, [])

  const active = rounds?.filter((r) => r.status === 'active') ?? []
  const past = rounds?.filter((r) => r.status !== 'active') ?? []

  return (
    <div className="page">
      <header className="page-head">
        <h1>Rounds</h1>
        <Link className="btn btn-primary" to="/rounds/new">
          Start a round
        </Link>
      </header>

      {active.length > 0 && (
        <section>
          <h2>Live now</h2>
          <ul className="card-list">
            {active.map((r) => (
              <li key={r.id} className="card card-row card-live">
                <div className="card-main">
                  <span className="card-title">{r.playedOn}</span>
                  <span className="card-sub">{r.playerNames}</span>
                </div>
                <Link className="btn btn-primary" to={`/rounds/${r.id}`}>
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (code.trim()) navigate(`/r/${code.trim().toUpperCase()}`)
        }}
      >
        <input
          className="text-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Join with a code"
          maxLength={5}
          autoCapitalize="characters"
        />
        <button className="btn" disabled={!code.trim()}>
          Join
        </button>
      </form>

      <h2>History</h2>
      {rounds === null && <p className="muted">Loading…</p>}
      {rounds !== null && past.length === 0 && (
        <p className="muted">No completed rounds yet. Get out there.</p>
      )}
      <ul className="card-list">
        {past.map((r) => (
          <li key={r.id} className="card card-row">
            <div className="card-main">
              <span className="card-title">{r.playedOn}</span>
              <span className="card-sub">{r.playerNames}</span>
            </div>
            <Link className="btn" to={`/rounds/${r.id}`}>
              View
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
