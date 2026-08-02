import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { apiGet, ApiError } from '../lib/api'
import {
  BASE_LAYERS,
  getPreferredLayerKey,
  setPreferredLayerKey,
  type BaseLayerDef
} from '../lib/mapLayers'

interface MapConfig {
  center: { lat: number; lng: number }
  bounds: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } }
  defaultZoom: number
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; missing?: string[] }
  | { kind: 'ready'; config: MapConfig }

export default function MapScreen() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    apiGet<MapConfig>('/api/config')
      .then((config) => {
        if (!cancelled) setState({ kind: 'ready', config })
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError) {
          const body = err.body as { missing?: string[] } | null
          setState({ kind: 'error', message: err.message, missing: body?.missing })
        } else {
          setState({ kind: 'error', message: 'Could not reach the server.' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.kind === 'loading') {
    return (
      <div className="screen-center">
        <p className="muted">Loading the course…</p>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="screen-center">
        <div className="notice-card">
          <h1>Map not configured</h1>
          <p>{state.message}</p>
          {state.missing && state.missing.length > 0 && (
            <ul>
              {state.missing.map((name) => (
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

  return <CourseMap config={state.config} />
}

function CourseMap({ config }: { config: MapConfig }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const activeLayerRef = useRef<L.Layer | null>(null)
  const [availableLayers, setAvailableLayers] = useState<BaseLayerDef[]>([BASE_LAYERS[0]])
  const [layerKey, setLayerKey] = useState(getPreferredLayerKey())

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true
    })
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    const bounds = L.latLngBounds(
      [config.bounds.sw.lat, config.bounds.sw.lng],
      [config.bounds.ne.lat, config.bounds.ne.lng]
    )
    // fitBounds adapts to the phone or desktop viewport; the fixed zoom is
    // only a fallback ceiling.
    map.fitBounds(bounds, { padding: [12, 12] })
    map.setMaxBounds(bounds.pad(1.5))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [config])

  // Probe optional layers once; drop the ones that do not respond.
  useEffect(() => {
    let cancelled = false
    Promise.all(
      BASE_LAYERS.map(async (layer) => {
        if (!layer.probe) return layer
        const ok = await layer.probe()
        return ok ? layer : null
      })
    ).then((layers) => {
      if (!cancelled) setAvailableLayers(layers.filter((l): l is BaseLayerDef => l !== null))
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Swap the base layer when the selection changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const def = availableLayers.find((l) => l.key === layerKey) ?? availableLayers[0]
    if (!def) return
    let cancelled = false
    def.make().then((layer) => {
      if (cancelled || !mapRef.current) return
      if (activeLayerRef.current) mapRef.current.removeLayer(activeLayerRef.current)
      layer.addTo(mapRef.current)
      activeLayerRef.current = layer
      mapRef.current.attributionControl.setPrefix(false)
      mapRef.current.attributionControl.addAttribution(def.attribution)
    })
    return () => {
      cancelled = true
    }
  }, [layerKey, availableLayers])

  return (
    <div className="map-screen">
      <div ref={containerRef} className="map-container" />
      {availableLayers.length > 1 && (
        <div className="layer-switcher" role="radiogroup" aria-label="Map imagery">
          {availableLayers.map((layer) => (
            <button
              key={layer.key}
              role="radio"
              aria-checked={layer.key === layerKey}
              className={layer.key === layerKey ? 'chip chip-active' : 'chip'}
              onClick={() => {
                setLayerKey(layer.key)
                setPreferredLayerKey(layer.key)
              }}
            >
              {layer.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
