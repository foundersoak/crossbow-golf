// Geometry helpers shared by the app and the Worker.
// All distances in yards; coordinates in WGS84 degrees.

export interface LatLng {
  lat: number
  lng: number
}

const EARTH_RADIUS_M = 6371008.8 // IUGG mean radius
const YARDS_PER_METER = 1.0936132983377078

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function haversineYards(a: LatLng, b: LatLng): number {
  return haversineMeters(a, b) * YARDS_PER_METER
}

/** Hole distance as displayed everywhere: whole yards, standard rounding. */
export function holeYards(tee: LatLng, pin: LatLng): number {
  return Math.round(haversineYards(tee, pin))
}

export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  )
}
