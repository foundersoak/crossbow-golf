import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { LayoutSummary } from '../../shared/types'

export default function LayoutsScreen() {
  const { player } = useAuth()
  const [layouts, setLayouts] = useState<LayoutSummary[] | null>(null)

  useEffect(() => {
    apiGet<LayoutSummary[]>('/api/layouts')
      .then(setLayouts)
      .catch(() => setLayouts([]))
  }, [])

  return (
    <div className="page">
      <header className="page-head">
        <h1>Course versions</h1>
        {player?.isAdmin && (
          <Link className="btn btn-primary" to="/edit">
            Open editor
          </Link>
        )}
      </header>
      {layouts === null && <p className="muted">Loading…</p>}
      {layouts?.length === 0 && (
        <p className="muted">
          Nothing published yet. The course goes live the first time a draft is published.
        </p>
      )}
      <ul className="card-list">
        {layouts?.map((l, i) => (
          <li key={l.id} className="card">
            <div className="card-main">
              <span className="card-title">
                v{l.versionNumber}
                {l.name ? ` · ${l.name}` : ''}
                {i === 0 && <span className="badge badge-live">Current</span>}
              </span>
              <span className="card-sub">
                {l.holeCount} holes · par {l.totalPar} · {l.totalYards} yards
              </span>
              <span className="card-sub">
                Published {new Date(l.publishedAt).toLocaleDateString()}
                {l.publishedByName ? ` by ${l.publishedByName}` : ''}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
