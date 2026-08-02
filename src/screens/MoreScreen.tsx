import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { apiGet, apiSend } from '../lib/api'
import type { RosterEntry } from '../../shared/types'

export default function MoreScreen() {
  const { player, logout } = useAuth()

  return (
    <div className="page">
      <header className="page-head">
        <h1>More</h1>
      </header>
      <p className="muted">
        Signed in as <strong>{player?.name}</strong>
        {player?.isAdmin ? ' (admin)' : ''}
      </p>
      <ul className="link-list">
        <li>
          <Link to="/layouts">Course version history</Link>
        </li>
        {player?.isAdmin && (
          <li>
            <Link to="/edit">Course editor</Link>
          </li>
        )}
      </ul>
      {player?.isAdmin && <AdminPanel selfId={player.id} />}
      <button className="btn btn-block" onClick={() => void logout()}>
        Sign out on this device
      </button>
    </div>
  )
}

function AdminPanel({ selfId }: { selfId: string }) {
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  async function reload() {
    setRoster(await apiGet<RosterEntry[]>('/api/roster'))
  }

  useEffect(() => {
    void reload().catch(() => {})
  }, [])

  async function run(action: () => Promise<unknown>, done?: string) {
    setMessage(null)
    try {
      await action()
      await reload()
      if (done) setMessage(done)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  return (
    <section className="admin-panel">
      <h2>Roster</h2>
      <ul className="card-list">
        {roster.map((p) => (
          <li key={p.id} className="card card-row">
            <span className="card-title">
              {p.name}
              {p.isAdmin && <span className="badge">admin</span>}
            </span>
            <button
              className="btn btn-small"
              disabled={p.id === selfId && p.isAdmin}
              onClick={() =>
                void run(() =>
                  apiSend(`/api/admin/players/${p.id}/admin`, 'POST', { isAdmin: !p.isAdmin })
                )
              }
            >
              {p.isAdmin ? 'Remove admin' : 'Make admin'}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!newName.trim()) return
          void run(() => apiSend('/api/admin/players', 'POST', { name: newName.trim() }), 'Added.')
          setNewName('')
        }}
      >
        <input
          className="text-input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Add a player"
          maxLength={40}
        />
        <button className="btn" disabled={!newName.trim()}>
          Add
        </button>
      </form>

      <h2>Family invite code</h2>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (newCode.trim().length < 12) {
            setMessage('Use at least 12 characters.')
            return
          }
          void run(
            () => apiSend('/api/admin/invite-code', 'POST', { code: newCode.trim() }),
            'Invite code updated. Devices already signed in stay signed in.'
          )
          setNewCode('')
        }}
      >
        <input
          className="text-input"
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          placeholder="New code (12+ characters)"
        />
        <button className="btn" disabled={newCode.trim().length < 12}>
          Rotate
        </button>
      </form>
      {message && <p className="muted small">{message}</p>}
    </section>
  )
}
