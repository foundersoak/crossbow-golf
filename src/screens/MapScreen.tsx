import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CourseMapView from '../components/CourseMapView'
import { useMapConfig } from '../lib/useMapConfig'
import { useAuth } from '../lib/auth'
import { apiGet } from '../lib/api'
import type { HoleData, LayoutData } from '../../shared/types'

export default function MapScreen() {
  const configState = useMapConfig()
  const { player } = useAuth()
  const [layout, setLayout] = useState<LayoutData | null | undefined>(undefined)
  const [selectedHoleId, setSelectedHoleId] = useState<string | null>(null)

  useEffect(() => {
    apiGet<LayoutData | null>('/api/layouts/current')
      .then(setLayout)
      .catch(() => setLayout(null))
  }, [])

  if (configState.kind === 'loading') {
    return (
      <div className="screen-center">
        <p className="muted">Loading the course…</p>
      </div>
    )
  }

  if (configState.kind === 'error') {
    return (
      <div className="screen-center">
        <div className="notice-card">
          <h1>Map not configured</h1>
          <p>{configState.message}</p>
          {configState.missing && (
            <ul>
              {configState.missing.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    )
  }

  const holes = layout?.holes ?? []
  const selected = holes.find((h) => h.id === selectedHoleId) ?? null

  return (
    <div className="map-screen">
      <CourseMapView
        config={configState.config}
        holes={holes}
        selectedHoleId={selectedHoleId}
        onSelectHole={setSelectedHoleId}
      />
      {layout === null && (
        <div className="map-empty-banner">
          <p>No course published yet.</p>
          {player?.isAdmin && (
            <Link className="btn btn-primary" to="/edit">
              Design the course
            </Link>
          )}
        </div>
      )}
      {layout && (
        <div className="map-title-bar">
          <span className="map-title">
            {layout.name || `Layout v${layout.versionNumber}`}
          </span>
          {player?.isAdmin && (
            <Link className="chip" to="/edit">
              Edit
            </Link>
          )}
        </div>
      )}
      {selected && <HoleSheet hole={selected} onClose={() => setSelectedHoleId(null)} />}
    </div>
  )
}

function HoleSheet({ hole, onClose }: { hole: HoleData; onClose: () => void }) {
  return (
    <div className="bottom-sheet" role="dialog" aria-label={`Hole ${hole.holeNumber}`}>
      <div className="sheet-grab" onClick={onClose} />
      <div className="sheet-head">
        <span className="hole-number-big">{hole.holeNumber}</span>
        <div>
          <h2 className="sheet-title">{hole.name || `Hole ${hole.holeNumber}`}</h2>
          <p className="sheet-sub">
            Par {hole.par}
            {hole.distanceYards !== null && <> · {hole.distanceYards} yards</>}
          </p>
        </div>
        <button className="btn btn-ghost sheet-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {hole.notes && <p className="sheet-notes">{hole.notes}</p>}
      {hole.photoKey && (
        <img
          className="sheet-photo"
          src={`/api/media/${hole.photoKey}`}
          alt={`Hole ${hole.holeNumber}`}
          loading="lazy"
        />
      )}
    </div>
  )
}
