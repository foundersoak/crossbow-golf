import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import {
  BASE_LAYERS,
  getPreferredLayerKey,
  setPreferredLayerKey,
  type BaseLayerDef
} from '../lib/mapLayers'
import { holeYards } from '../../shared/geo'
import type { HoleData } from '../../shared/types'

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
}

function teeIcon(holeNumber: number, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="tee-marker${selected ? ' marker-selected' : ''}">${holeNumber}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  })
}

function pinIcon(selected: boolean): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="pin-marker${selected ? ' marker-selected' : ''}">
             <div class="pin-flag"></div><div class="pin-stick"></div>
           </div>`,
    iconSize: [26, 34],
    iconAnchor: [4, 32]
  })
}

export default function CourseMapView({
  config,
  holes,
  editable = false,
  selectedHoleId = null,
  onSelectHole,
  onMoveMarker,
  onMapReady
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
    })
    return () => {
      cancelled = true
    }
  }, [layerKey, availableLayers])

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
