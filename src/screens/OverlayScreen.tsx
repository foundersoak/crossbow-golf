import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import CourseMapView from '../components/CourseMapView'
import { useMapConfig } from '../lib/useMapConfig'
import { useAuth } from '../lib/auth'
import { apiGet, apiSend } from '../lib/api'
import type { HoleData, LayoutData, OverlayCorners, OverlayData } from '../../shared/types'

export default function OverlayScreen() {
  const { player } = useAuth()
  const configState = useMapConfig()
  const [overlays, setOverlays] = useState<OverlayData[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [holes, setHoles] = useState<HoleData[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const opacityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function reload(keepSelection = true) {
    const list = await apiGet<OverlayData[]>('/api/overlays')
    setOverlays(list)
    setSelectedId((prev) => {
      if (keepSelection && prev && list.some((o) => o.id === prev)) return prev
      return list.find((o) => o.isActive)?.id ?? list[0]?.id ?? null
    })
  }

  useEffect(() => {
    void reload().catch(() => {})
    apiGet<LayoutData | null>('/api/layouts/current')
      .then((l) => setHoles(l?.holes ?? []))
      .catch(() => {})
  }, [])

  const selected = overlays.find((o) => o.id === selectedId) ?? null

  function patchSelected(patch: Partial<OverlayData>) {
    setOverlays((prev) => prev.map((o) => (o.id === selectedId ? { ...o, ...patch } : o)))
  }

  async function persist(patch: {
    corners?: OverlayCorners
    opacity?: number
    isActive?: boolean
  }) {
    if (!selected) return
    setBusy('save')
    try {
      await apiSend(`/api/overlays/${selected.id}`, 'PUT', patch)
      if (patch.corners) setDirty(false)
      if (patch.isActive !== undefined) await reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setBusy(null)
    }
  }

  async function upload(file: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/overlays', { method: 'POST', body: form })
      const body = (await res.json()) as OverlayData & { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Upload failed.')
      await reload(false)
      setSelectedId(body.id)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  if (!player?.isAdmin) {
    return (
      <div className="screen-center">
        <div className="notice-card">
          <h1>Admins only</h1>
          <Link className="btn btn-primary" to="/">
            Back to the map
          </Link>
        </div>
      </div>
    )
  }

  if (configState.kind !== 'ready') {
    return (
      <div className="screen-center">
        <p className="muted">
          {configState.kind === 'error' ? configState.message : 'Loading…'}
        </p>
      </div>
    )
  }

  return (
    <div className="edit-screen">
      <div className="edit-map">
        <CourseMapView
          config={configState.config}
          holes={holes}
          overlay={selected}
          overlayVisible={selected !== null}
          cornerEditable={selected !== null}
          onCornersChange={(corners) => {
            patchSelected({ corners })
            setDirty(true)
          }}
        />
        <div className="edit-banner">
          <span>Drone overlay</span>
          {dirty && <span className="save-state save-saving">Unsaved alignment</span>}
        </div>
      </div>

      <div className="edit-panel">
        {overlays.length > 0 && (
          <div className="field-row">
            <label className="field-label" htmlFor="overlay-pick">
              Overlay
            </label>
            <select
              id="overlay-pick"
              className="text-input"
              value={selectedId ?? ''}
              onChange={(e) => {
                setSelectedId(e.target.value)
                setDirty(false)
              }}
            >
              {overlays.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name || o.id}
                  {o.isActive ? ' (live on the map)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {selected && (
          <>
            <p className="muted small">
              Drag the four corner handles until the photo lines up with the basemap. Corners
              are saved with the overlay so the alignment is reproducible.
            </p>
            <div className="field-row field-row-inline">
              <label className="field-label" htmlFor="overlay-opacity">
                Opacity
              </label>
              <input
                id="overlay-opacity"
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={selected.opacity}
                onChange={(e) => {
                  const opacity = Number(e.target.value)
                  patchSelected({ opacity })
                  if (opacityTimer.current) clearTimeout(opacityTimer.current)
                  opacityTimer.current = setTimeout(() => void persist({ opacity }), 500)
                }}
              />
            </div>
            <div className="edit-actions">
              <button
                className="btn btn-primary"
                disabled={!dirty || busy !== null}
                onClick={() => void persist({ corners: selected.corners })}
              >
                Save alignment
              </button>
              <button
                className="btn"
                disabled={busy !== null}
                onClick={() => void persist({ isActive: !selected.isActive })}
              >
                {selected.isActive ? 'Hide from map' : 'Show on map'}
              </button>
              <button
                className="btn btn-danger"
                disabled={busy !== null}
                onClick={() => {
                  if (!window.confirm('Delete this overlay image?')) return
                  void apiSend(`/api/overlays/${selected.id}`, 'DELETE').then(() => reload(false))
                }}
              >
                Delete
              </button>
            </div>
          </>
        )}

        <div className="field-row">
          <label className="btn btn-block">
            {uploading ? 'Uploading…' : 'Upload a drone photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void upload(f)
                e.target.value = ''
              }}
            />
          </label>
          <p className="muted small">
            JPEG, PNG, or WebP up to 25 MB. The photo is stored privately, never in the code
            repository, and never on a public tile service.
          </p>
        </div>
      </div>
    </div>
  )
}
