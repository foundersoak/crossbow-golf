import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGet, apiSend } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { RosterEntry } from '../../shared/types'
import type { RoundDetail } from '../../shared/protocol'

const MAX_PLAYERS = 6

export default function NewRoundScreen() {
  const { player } = useAuth()
  const navigate = useNavigate()
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set(player ? [player.id] : []))
  const [newPlayers, setNewPlayers] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [playedOn, setPlayedOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<RosterEntry[]>('/api/roster')
      .then(setRoster)
      .catch(() => {})
  }, [])

  const total = picked.size + newPlayers.length

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (total < MAX_PLAYERS) next.add(id)
      return next
    })
  }

  async function start() {
    if (total < 1 || busy) return
    setBusy(true)
    setError(null)
    try {
      const round = await apiSend<RoundDetail>('/api/rounds', 'POST', {
        playedOn,
        playerIds: [...picked],
        newPlayers
      })
      navigate(`/rounds/${round.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the round.')
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>New round</h1>
      </header>

      <label className="field-label" htmlFor="played-on">
        Date
      </label>
      <input
        id="played-on"
        type="date"
        className="text-input"
        value={playedOn}
        onChange={(e) => setPlayedOn(e.target.value)}
      />

      <p className="field-label">
        Players ({total}/{MAX_PLAYERS})
      </p>
      <div className="roster-grid">
        {roster.map((p) => (
          <button
            key={p.id}
            className={picked.has(p.id) ? 'btn roster-btn roster-picked' : 'btn roster-btn'}
            onClick={() => toggle(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {newPlayers.length > 0 && (
        <div className="new-player-chips">
          {newPlayers.map((n) => (
            <button
              key={n}
              className="chip chip-active"
              onClick={() => setNewPlayers((prev) => prev.filter((x) => x !== n))}
            >
              {n} ✕
            </button>
          ))}
        </div>
      )}

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          const name = newName.trim()
          if (!name || total >= MAX_PLAYERS) return
          if (!newPlayers.includes(name)) setNewPlayers((prev) => [...prev, name])
          setNewName('')
        }}
      >
        <input
          className="text-input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Add someone new"
          maxLength={40}
        />
        <button className="btn" disabled={!newName.trim() || total >= MAX_PLAYERS}>
          Add
        </button>
      </form>

      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-primary btn-block" onClick={() => void start()} disabled={busy || total < 1}>
        {busy ? 'Starting…' : 'Start round'}
      </button>
    </div>
  )
}
