import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiGet, apiSend } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { RoundDetail } from '../../shared/protocol'
import CountyShape from '../components/CountyShape'

interface JoinInfo {
  round: RoundDetail
  roster: { id: string; name: string }[]
}

export default function JoinScreen() {
  const { code } = useParams<{ code: string }>()
  const { player, refresh, loading } = useAuth()
  const navigate = useNavigate()
  const [info, setInfo] = useState<JoinInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!code) return
    apiGet<JoinInfo>(`/api/join/${code}`)
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not find that round.'))
  }, [code])

  // A device that already knows who it is and is in the round goes straight in.
  useEffect(() => {
    if (loading || !info || !player) return
    if (info.round.players.some((p) => p.id === player.id)) {
      void join({ playerId: player.id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, info, player])

  async function join(pick: { playerId?: string; name?: string }) {
    if (busy || !code) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiSend<{ roundId: string }>(`/api/join/${code}`, 'POST', pick)
      await refresh()
      navigate(`/rounds/${res.roundId}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join.')
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="screen-center gate">
        <div className="gate-card">
          <h1>Join round</h1>
          <p className="form-error">{error}</p>
        </div>
      </div>
    )
  }

  if (!info) {
    return (
      <div className="screen-center gate">
        <p className="gate-loading">Finding the round…</p>
      </div>
    )
  }

  const inRound = new Set(info.round.players.map((p) => p.id))
  const others = info.roster.filter((p) => !inRound.has(p.id))

  return (
    <div className="screen-center gate">
      <CountyShape className="gate-county" />
      <div className="gate-card">
        <p className="gate-kicker">Round on {info.round.playedOn}</p>
        <h1>Who are you?</h1>

        <p className="field-label">Playing today</p>
        <div className="roster-grid">
          {info.round.players.map((p) => (
            <button
              key={p.id}
              className="btn roster-btn"
              disabled={busy}
              onClick={() => void join({ playerId: p.id })}
            >
              {p.name}
            </button>
          ))}
        </div>

        {others.length > 0 && (
          <>
            <p className="field-label">Joining in</p>
            <div className="roster-grid">
              {others.map((p) => (
                <button
                  key={p.id}
                  className="btn roster-btn"
                  disabled={busy}
                  onClick={() => void join({ playerId: p.id })}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (newName.trim()) void join({ name: newName.trim() })
          }}
        >
          <label className="field-label" htmlFor="join-name">
            Someone new
          </label>
          <input
            id="join-name"
            className="text-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Your name"
            maxLength={40}
          />
          <button className="btn btn-primary btn-block" disabled={busy || !newName.trim()}>
            {busy ? 'Joining…' : 'Join the round'}
          </button>
        </form>
      </div>
    </div>
  )
}
