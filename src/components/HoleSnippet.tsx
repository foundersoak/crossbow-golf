// A static satellite snippet of one hole, framed tee to pin, shown above
// the score entry. Non-interactive so it never fights page scrolling.
// Tiles come from the same source as the big map (and get the same
// service-worker cache, so recently seen holes still render offline).

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { teeIcon, pinIcon } from '../lib/mapIcons'
import { DistortedImageOverlay } from '../lib/distortedOverlay'
import type { HoleData, OverlayData } from '../../shared/types'

export default function HoleSnippet({
  hole,
  overlay
}: {
  hole: HoleData
  overlay?: OverlayData | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const featureLayerRef = useRef<L.LayerGroup | null>(null)
  const overlayRef = useRef<DistortedImageOverlay | null>(null)

  // One map for the whole round; holes swap via fitBounds.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      attributionControl: true
    })
    map.attributionControl.setPrefix(false)
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 21,
        maxNativeZoom: 19,
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics'
      }
    ).addTo(map)
    featureLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      featureLayerRef.current = null
      overlayRef.current = null
    }
  }, [])

  // Drone overlay, when one is live.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (overlayRef.current) {
      overlayRef.current.remove()
      overlayRef.current = null
    }
    if (overlay) {
      const layer = new DistortedImageOverlay(
        `/api/media/${overlay.imageKey}`,
        overlay.corners,
        overlay.opacity
      )
      layer.addTo(map)
      overlayRef.current = layer
    }
  }, [overlay])

  // Frame the current hole.
  useEffect(() => {
    const map = mapRef.current
    const features = featureLayerRef.current
    if (!map || !features || !hole.tee || !hole.pin) return
    features.clearLayers()
    features.addLayer(
      L.polyline(
        [
          [hole.tee.lat, hole.tee.lng],
          [hole.pin.lat, hole.pin.lng]
        ],
        { color: '#ffffff', weight: 3, opacity: 0.95, dashArray: '7 7', interactive: false }
      )
    )
    features.addLayer(
      L.marker([hole.tee.lat, hole.tee.lng], {
        icon: teeIcon(hole.holeNumber, false),
        interactive: false,
        keyboard: false
      })
    )
    features.addLayer(
      L.marker([hole.pin.lat, hole.pin.lng], {
        icon: pinIcon(false),
        interactive: false,
        keyboard: false
      })
    )
    const bounds = L.latLngBounds(
      [hole.tee.lat, hole.tee.lng],
      [hole.pin.lat, hole.pin.lng]
    ).pad(0.35)
    map.fitBounds(bounds, { padding: [18, 18], maxZoom: 19, animate: false })
    // The container can mount before layout settles; nudge Leaflet.
    setTimeout(() => map.invalidateSize(), 50)
  }, [hole])

  if (!hole.tee || !hole.pin) return null
  return <div ref={containerRef} className="hole-snippet" aria-hidden="true" />
}
