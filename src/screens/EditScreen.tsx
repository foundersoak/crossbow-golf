import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type L from 'leaflet'
import CourseMapView from '../components/CourseMapView'
import { useMapConfig } from '../lib/useMapConfig'
import { useAuth } from '../lib/auth'
import { apiGet, apiSend } from '../lib/api'
import { holeYards } from '../../shared/geo'
import type { DraftHoleInput, HoleData, LayoutData } from '../../shared/types'

function newHoleId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 20)
}

export default function EditScreen() {
  const { player } = useAuth()
  const configState = useMapConfig()
  const navigate = useNavigate()
  const [holes, setHoles] = useState<HoleData[] | null>(null)
  const [selectedHoleId, setSelectedHoleId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [publishing, setPublishing] = useState(false)
  const mapRef = useRef<L.Map | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holesRef = useRef<HoleData[]>([])

  useEffect(() => {
    apiGet<LayoutData>('/api/draft')
      .then((draft) => setHoles(draft.holes))
      .catch(() => setHoles([]))
  }, [])

  useEffect(() => {
    holesRef.current = holes ?? []
  }, [holes])

  const scheduleSave = useCallback(() => {
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const payload: DraftHoleInput[] = holesRef.current.map((h) => ({
        id: h.id,
        holeNumber: h.holeNumber,
        name: h.name,
        par: h.par,
        tee: h.tee,
        pin: h.pin,
        notes: h.notes,
        photoKey: h.photoKey
      }))
      try {
        await apiSend('/api/draft', 'PUT', { holes: payload })
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    }, 800)
  }, [])

  const updateHoles = useCallback(
    (updater: (prev: HoleData[]) => HoleData[]) => {
      setHoles((prev) => {
        const next = updater(prev ?? [])
        // Hole numbers always follow list order.
        const renumbered = next.map((h, i) => ({ ...h, holeNumber: i + 1, sortOrder: i }))
        holesRef.current = renumbered
        return renumbered
      })
      scheduleSave()
    },
    [scheduleSave]
  )

  const moveMarker = useCallback(
    (holeId: string, which: 'tee' | 'pin', pos: { lat: number; lng: number }) => {
      updateHoles((prev) =>
        prev.map((h) => {
          if (h.id !== holeId) return h
          const next = { ...h, [which]: pos }
          next.distanceYards = next.tee && next.pin ? holeYards(next.tee, next.pin) : null
          return next
        })
      )
    },
    [updateHoles]
  )

  const placeAt = useCallback(
    (holeId: string, which: 'tee' | 'pin', mode: 'center' | 'gps') => {
      if (mode === 'center') {
        const c = mapRef.current?.getCenter()
        if (c) moveMarker(holeId, which, { lat: c.lat, lng: c.lng })
        return
      }
      if (!('geolocation' in navigator)) return
      navigator.geolocation.getCurrentPosition(
        (loc) => moveMarker(holeId, which, { lat: loc.coords.latitude, lng: loc.coords.longitude }),
        () => {
          // GPS denied or unavailable: fall back to map center placement.
          const c = mapRef.current?.getCenter()
          if (c) moveMarker(holeId, which, { lat: c.lat, lng: c.lng })
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
      )
    },
    [moveMarker]
  )

  const selected = useMemo(
    () => (holes ?? []).find((h) => h.id === selectedHoleId) ?? null,
    [holes, selectedHoleId]
  )

  if (!player?.isAdmin) {
    return (
      <div className="screen-center">
        <div className="notice-card">
          <h1>Admins only</h1>
          <p>Course editing is limited to admins.</p>
          <Link className="btn btn-primary" to="/">
            Back to the map
          </Link>
        </div>
      </div>
    )
  }

  if (configState.kind !== 'ready' || holes === null) {
    return (
      <div className="screen-center">
        <p className="muted">
          {configState.kind === 'error' ? configState.message : 'Loading the editor…'}
        </p>
      </div>
    )
  }

  async function publish() {
    const name = window.prompt('Name this layout version (for example "Spring pins"):')
    if (name === null) return
    setPublishing(true)
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const payload: DraftHoleInput[] = holesRef.current.map((h) => ({
        id: h.id,
        holeNumber: h.holeNumber,
        name: h.name,
        par: h.par,
        tee: h.tee,
        pin: h.pin,
        notes: h.notes,
        photoKey: h.photoKey
      }))
      await apiSend('/api/draft', 'PUT', { holes: payload })
      await apiSend('/api/draft/publish', 'POST', { name: name.trim() || undefined })
      navigate('/layouts')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Publishing failed.')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="edit-screen">
      <div className="edit-map">
        <CourseMapView
          config={configState.config}
          holes={holes}
          editable
          selectedHoleId={selectedHoleId}
          onSelectHole={setSelectedHoleId}
          onMoveMarker={moveMarker}
          onMapReady={(m) => {
            mapRef.current = m
          }}
        />
        <div className="edit-banner">
          <span>Editing draft</span>
          <span className={`save-state save-${saveState}`}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save failed, retrying on next change'}
          </span>
        </div>
      </div>

      <div className="edit-panel">
        <div className="edit-hole-strip">
          {holes.map((h) => (
            <button
              key={h.id}
              className={h.id === selectedHoleId ? 'hole-pill hole-pill-active' : 'hole-pill'}
              onClick={() => setSelectedHoleId(h.id)}
            >
              {h.holeNumber}
            </button>
          ))}
          <button
            className="hole-pill hole-pill-add"
            onClick={() => {
              const id = newHoleId()
              updateHoles((prev) => [
                ...prev,
                {
                  id,
                  holeNumber: prev.length + 1,
                  name: null,
                  par: 3,
                  tee: null,
                  pin: null,
                  distanceYards: null,
                  notes: null,
                  photoKey: null,
                  sortOrder: prev.length
                }
              ])
              setSelectedHoleId(id)
            }}
          >
            + Hole
          </button>
        </div>

        {selected ? (
          <HoleEditor
            hole={selected}
            holeCount={holes.length}
            onPlace={placeAt}
            onChange={(patch) =>
              updateHoles((prev) =>
                prev.map((h) => (h.id === selected.id ? { ...h, ...patch } : h))
              )
            }
            onMove={(dir) =>
              updateHoles((prev) => {
                const i = prev.findIndex((h) => h.id === selected.id)
                const j = dir === 'up' ? i - 1 : i + 1
                if (j < 0 || j >= prev.length) return prev
                const next = [...prev]
                ;[next[i], next[j]] = [next[j], next[i]]
                return next
              })
            }
            onDelete={() => {
              if (!window.confirm(`Remove hole ${selected.holeNumber}?`)) return
              updateHoles((prev) => prev.filter((h) => h.id !== selected.id))
              setSelectedHoleId(null)
            }}
          />
        ) : (
          <p className="muted edit-hint">
            Tap a hole to edit it, or add one. Drag markers to move tees and pins; yardage
            updates as you drag.
          </p>
        )}

        <div className="edit-actions">
          <Link className="btn" to="/layouts">
            Version history
          </Link>
          <button className="btn btn-primary" onClick={() => void publish()} disabled={publishing}>
            {publishing ? 'Publishing…' : 'Publish version'}
          </button>
        </div>
      </div>
    </div>
  )
}

function HoleEditor({
  hole,
  holeCount,
  onChange,
  onPlace,
  onMove,
  onDelete
}: {
  hole: HoleData
  holeCount: number
  onChange: (patch: Partial<HoleData>) => void
  onPlace: (holeId: string, which: 'tee' | 'pin', mode: 'center' | 'gps') => void
  onMove: (dir: 'up' | 'down') => void
  onDelete: () => void
}) {
  const [uploading, setUploading] = useState(false)

  async function uploadPhoto(file: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/media', { method: 'POST', body: form })
      const body = (await res.json()) as { key?: string; error?: string }
      if (!res.ok || !body.key) throw new Error(body.error ?? 'Upload failed.')
      onChange({ photoKey: body.key })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="hole-editor">
      <div className="hole-editor-head">
        <h2>
          Hole {hole.holeNumber}
          {hole.distanceYards !== null && (
            <span className="live-yards"> · {hole.distanceYards} yards</span>
          )}
        </h2>
        <div className="hole-order-controls">
          <button className="btn btn-small" onClick={() => onMove('up')} disabled={hole.holeNumber === 1} aria-label="Move earlier">
            ↑
          </button>
          <button
            className="btn btn-small"
            onClick={() => onMove('down')}
            disabled={hole.holeNumber === holeCount}
            aria-label="Move later"
          >
            ↓
          </button>
        </div>
      </div>

      <div className="place-row">
        <span className="place-label">Tee{hole.tee ? '' : ' (not placed)'}</span>
        <button className="btn btn-small" onClick={() => onPlace(hole.id, 'tee', 'center')}>
          Place at map center
        </button>
        <button className="btn btn-small" onClick={() => onPlace(hole.id, 'tee', 'gps')}>
          I'm standing on it
        </button>
      </div>
      <div className="place-row">
        <span className="place-label">Pin{hole.pin ? '' : ' (not placed)'}</span>
        <button className="btn btn-small" onClick={() => onPlace(hole.id, 'pin', 'center')}>
          Place at map center
        </button>
        <button className="btn btn-small" onClick={() => onPlace(hole.id, 'pin', 'gps')}>
          I'm standing on it
        </button>
      </div>

      <div className="field-row">
        <label className="field-label" htmlFor="hole-name">
          Name (optional)
        </label>
        <input
          id="hole-name"
          className="text-input"
          value={hole.name ?? ''}
          maxLength={40}
          placeholder={`Hole ${hole.holeNumber}`}
          onChange={(e) => onChange({ name: e.target.value || null })}
        />
      </div>

      <div className="field-row field-row-inline">
        <label className="field-label" htmlFor="hole-par">
          Par
        </label>
        <div className="stepper">
          <button
            className="btn btn-small"
            onClick={() => onChange({ par: Math.max(1, hole.par - 1) })}
            aria-label="Lower par"
          >
            −
          </button>
          <span id="hole-par" className="stepper-value">
            {hole.par}
          </span>
          <button
            className="btn btn-small"
            onClick={() => onChange({ par: Math.min(10, hole.par + 1) })}
            aria-label="Raise par"
          >
            +
          </button>
        </div>
      </div>

      <div className="field-row">
        <label className="field-label" htmlFor="hole-notes">
          Notes
        </label>
        <textarea
          id="hole-notes"
          className="text-input"
          rows={2}
          maxLength={500}
          value={hole.notes ?? ''}
          placeholder="Hazards, local rules, how it plays"
          onChange={(e) => onChange({ notes: e.target.value || null })}
        />
      </div>

      <div className="field-row field-row-inline">
        <label className="field-label">Photo</label>
        {hole.photoKey && (
          <img className="hole-photo-thumb" src={`/api/media/${hole.photoKey}`} alt="" />
        )}
        <label className="btn btn-small">
          {uploading ? 'Uploading…' : hole.photoKey ? 'Replace' : 'Add photo'}
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void uploadPhoto(f)
              e.target.value = ''
            }}
          />
        </label>
        {hole.photoKey && (
          <button className="btn btn-small" onClick={() => onChange({ photoKey: null })}>
            Remove
          </button>
        )}
      </div>

      <button className="btn btn-danger btn-block" onClick={onDelete}>
        Remove this hole
      </button>
    </div>
  )
}
