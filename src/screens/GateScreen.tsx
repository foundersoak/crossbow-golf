import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { apiGet } from '../lib/api'
import type { RosterEntry } from '../../shared/types'
import CountyMedallion from '../components/CountyMedallion'

export default function GateScreen() {
  const { hasSession } = useAuth()
  return (
    <div className="screen-center gate">
      <div className="gate-stack">
        <h1 className="visually-hidden">Crossbow Ranch Pitch 'n Putt</h1>
        <CountyMedallion className="medallion" />
        <p className="medal-sub">Bosque County, Texas</p>
        <div className="gate-card">{hasSession ? <ClaimStep /> : <CodeStep />}</div>
      </div>
    </div>
  )
}

function CodeStep() {
  const { enterCode } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!code.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await enterCode(code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <label className="field-label" htmlFor="invite">
        Family invite code
      </label>
      <input
        id="invite"
        className="text-input"
        type="password"
        autoComplete="off"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Ask the family"
      />
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-primary btn-block" disabled={busy || !code.trim()}>
        {busy ? 'Checking…' : 'Enter'}
      </button>
    </form>
  )
}

function ClaimStep() {
  const { claim } = useAuth()
  const [roster, setRoster] = useState<RosterEntry[] | null>(null)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiGet<RosterEntry[]>('/api/roster')
      .then(setRoster)
      .catch(() => setRoster([]))
  }, [])

  async function pick(pickArgs: { playerId?: string; name?: string }) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await claim(pickArgs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  if (roster === null) return <p className="muted">Loading the roster…</p>

  return (
    <div>
      <p className="field-label">Who are you?</p>
      {roster.length > 0 && (
        <div className="roster-grid">
          {roster.map((p) => (
            <button
              key={p.id}
              className="btn roster-btn"
              disabled={busy}
              onClick={() => void pick({ playerId: p.id })}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (newName.trim()) void pick({ name: newName })
        }}
      >
        <label className="field-label" htmlFor="newname">
          {roster.length > 0 ? 'Or add yourself' : 'Add yourself to get started'}
        </label>
        <input
          id="newname"
          className="text-input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Your name"
          maxLength={40}
        />
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || !newName.trim()}>
          {busy ? 'Joining…' : "I'm new here"}
        </button>
      </form>
      {roster.length === 0 && (
        <p className="muted small">The first person to join becomes the admin.</p>
      )}
    </div>
  )
}
