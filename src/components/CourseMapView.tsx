import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import {
  BASE_LAYERS,
  getPreferredLayerKey,
  setPreferredLayerKey,
  type BaseLayerDef
} from '../lib/mapLayers'
import { holeYards } from '../../shared/geo'
import type { HoleData, OverlayCorners, OverlayData } from '../../shared/types'
import { DistortedImageOverlay } from '../lib/distortedOverlay'
import { teeIcon, pinIcon } from '../lib/mapIcons'

export interface MapConfig {
  center: { lat: number; lng: number }
  bounds: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } }
  defaultZoom: number
}

interface Props {
  config: MapConfig
  holes: HoleData[]
  editable?: boolean
  selectedHoleId?: string | null
  onSelectHole?: (holeId: string | null) => void
  onMoveMarker?: (holeId: string, which: 'tee' | 'pin', pos: { lat: number; lng: number }) => void
  /** Exposes the map so parents can read the center (crosshair placement). */
  onMapReady?: (map: L.Map) => void
  /** Drone photo overlay, warped to its stored corner coordinates. */
  overlay?: OverlayData | null
  overlayVisible?: boolean
  /** Admin alignment mode: draggable corner handles. */
  cornerEditable?: boolean
  onCornersChange?: (corners: OverlayCorners) => void
}

export default function CourseMapView({
  config,
  holes,
  editable = false,
  selectedHoleId = null,
  onSelectHole,
  onMoveMarker,
  onMapReady,
  overlay = null,
  overlayVisible = true,
  cornerEditable = false,
  onCornersChange
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const holesLayerRef = useRef<L.LayerGroup | null>(null)
  const draggingRef = useRef(false)
  const activeBaseRef = useRef<L.Layer | null>(null)
  const [availableLayers, setAvailableLayers] = useState<BaseLayerDef[]>([BASE_LAYERS[0]])
  const [layerKey, setLayerKey] = useState(getPreferredLayerKey())

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: false })
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    const bounds = L.latLngBounds(
      [config.bounds.sw.lat, config.bounds.sw.lng],
      [config.bounds.ne.lat, config.bounds.ne.lng]
    )
    map.fitBounds(bounds, { padding: [12, 12] })
    map.setMaxBounds(bounds.pad(1.5))
    map.on('click', () => onSelectHole?.(null))
    holesLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    onMapReady?.(map)
    return () => {
      map.remove()
      mapRef.current = null
      holesLayerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  // Probe optional base layers once.
  useEffect(() => {
    let cancelled = false
    Promise.all(
      BASE_LAYERS.map(async (layer) => {
        if (!layer.probe) return layer
        return (await layer.probe()) ? layer : null
      })
    ).then((layers) => {
      if (!cancelled) setAvailableLayers(layers.filter((l): l is BaseLayerDef => l !== null))
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Swap base layer.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const def = availableLayers.find((l) => l.key === layerKey) ?? availableLayers[0]
    if (!def) return
    let cancelled = false
    def.make().then((layer) => {
      if (cancelled || !mapRef.current) return
      if (activeBaseRef.current) mapRef.current.removeLayer(activeBaseRef.current)
      layer.addTo(mapRef.current)
      ;(layer as L.TileLayer).bringToBack?.()
      activeBaseRef.current = layer
      mapRef.current.attributionControl.setPrefix(false)
      mapRef.current.attributionControl.addAttribution(def.attribution)

      // If a non-default source fails to actually draw imagery, drop it
      // from the picker and fall back rather than showing a blank map.
      const evented = layer as unknown as L.Evented & { on?: L.Evented['on'] }
      if (def.key !== BASE_LAYERS[0].key && typeof evented.on === 'function') {
        let failures = 0
        evented.on('requesterror error', () => {
          failures++
          if (failures >= 2) {
            setAvailableLayers((prev) => prev.filter((l) => l.key !== def.key))
            setLayerKey(BASE_LAYERS[0].key)
            setPreferredLayerKey(BASE_LAYERS[0].key)
          }
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [layerKey, availableLayers])

  // Drone overlay layer lifecycle.
  const overlayLayerRef = useRef<DistortedImageOverlay | null>(null)
  const cornerMarkersRef = useRef<L.Marker[]>([])
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!overlay || !overlayVisible) {
      overlayLayerRef.current?.remove()
      overlayLayerRef.current = null
      return
    }
    const layer = new DistortedImageOverlay(
      `/api/media/${overlay.imageKey}`,
      overlay.corners,
      overlay.opacity
    )
    layer.addTo(map)
    overlayLayerRef.current = layer
    return () => {
      layer.remove()
      overlayLayerRef.current = null
    }
    // Recreate only when the image identity or visibility changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay?.id, overlay?.imageKey, overlayVisible])

  // Live corner/opacity updates without recreating the layer.
  useEffect(() => {
    if (overlay && overlayLayerRef.current) {
      overlayLayerRef.current.setCorners(overlay.corners)
      overlayLayerRef.current.setOpacity(overlay.opacity)
    }
  }, [overlay])

  // Corner handles for the admin alignment screen.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !cornerEditable || !overlay) return
    const keys: (keyof OverlayCorners)[] = ['nw', 'ne', 'se', 'sw']
    const markers = keys.map((key) => {
      const pos = overlay.corners[key]
      const marker = L.marker([pos.lat, pos.lng], {
        draggable: true,
        keyboard: false,
        icon: L.divIcon({
          className: '',
          html: `<div class="corner-handle">${key.toUpperCase()}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17]
        })
      })
      marker.on('drag dragend', () => {
        const current: OverlayCorners = { ...overlay.corners }
        markers.forEach((m, i) => {
          const ll = m.getLatLng()
          current[keys[i]] = { lat: ll.lat, lng: ll.lng }
        })
        onCornersChange?.(current)
      })
      marker.addTo(map)
      return marker
    })
    cornerMarkersRef.current = markers
    return () => {
      markers.forEach((m) => m.remove())
      cornerMarkersRef.current = []
    }
    // Recreate handles only when switching overlays or toggling edit mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cornerEditable, overlay?.id])

  // Render holes. Skipped while a marker drag is in flight so the drag
  // survives parent re-renders; positions are updated imperatively instead.
  useEffect(() => {
    const group = holesLayerRef.current
    if (!group || draggingRef.current) return
    group.clearLayers()

    for (const hole of holes) {
      const selected = hole.id === selectedHoleId
      let line: L.Polyline | null = null
      if (hole.tee && hole.pin) {
        line = L.polyline(
          [
            [hole.tee.lat, hole.tee.lng],
            [hole.pin.lat, hole.pin.lng]
          ],
          {
            color: selected ? '#ffd166' : '#ffffff',
            weight: selected ? 4 : 2.5,
            opacity: 0.9,
            dashArray: '6 6'
          }
        )
        line.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          onSelectHole?.(hole.id)
        })
        group.addLayer(line)
      }

      const addDraggable = (
        which: 'tee' | 'pin',
        pos: { lat: number; lng: number },
        icon: L.DivIcon
      ) => {
        const marker = L.marker([pos.lat, pos.lng], {
          icon,
          draggable: editable,
          keyboard: false
        })
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          onSelectHole?.(hole.id)
        })
        if (editable) {
          marker.on('dragstart', () => {
            draggingRef.current = true
            onSelectHole?.(hole.id)
          })
          marker.on('drag', () => {
            const ll = marker.getLatLng()
            if (line) {
              const pts = line.getLatLngs() as L.LatLng[]
              pts[which === 'tee' ? 0 : 1] = ll
              line.setLatLngs(pts)
            }
            onMoveMarker?.(hole.id, which, { lat: ll.lat, lng: ll.lng })
          })
          marker.on('dragend', () => {
            draggingRef.current = false
            const ll = marker.getLatLng()
            onMoveMarker?.(hole.id, which, { lat: ll.lat, lng: ll.lng })
          })
        }
        group.addLayer(marker)
      }

      if (hole.tee) addDraggable('tee', hole.tee, teeIcon(hole.holeNumber, selected))
      if (hole.pin) addDraggable('pin', hole.pin, pinIcon(selected))

      if (hole.tee && hole.pin) {
        const mid = {
          lat: (hole.tee.lat + hole.pin.lat) / 2,
          lng: (hole.tee.lng + hole.pin.lng) / 2
        }
        const yards = hole.distanceYards ?? holeYards(hole.tee, hole.pin)
        const chip = L.marker([mid.lat, mid.lng], {
          icon: L.divIcon({
            className: '',
            html: `<div class="yardage-chip${selected ? ' marker-selected' : ''}">${yards}y</div>`,
            iconSize: [44, 20],
            iconAnchor: [22, 10]
          }),
          interactive: true,
          keyboard: false
        })
        chip.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          onSelectHole?.(hole.id)
        })
        group.addLayer(chip)
      }
    }
  }, [holes, selectedHoleId, editable, onSelectHole, onMoveMarker])

  return (
    <div className="map-wrap">
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
