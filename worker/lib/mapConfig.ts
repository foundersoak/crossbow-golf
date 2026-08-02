import type { Env } from '../env'
import { isValidLatLng } from '../../shared/geo'

export interface MapConfig {
  center: { lat: number; lng: number }
  bounds: {
    ne: { lat: number; lng: number }
    sw: { lat: number; lng: number }
  }
  defaultZoom: number
}

/**
 * Reads the property location from Worker env (secrets / .dev.vars).
 * Returns a string describing what is missing instead of a config, so the
 * client can render a readable failure rather than a map of the ocean.
 */
export function readMapConfig(env: Env): MapConfig | { missing: string[] } {
  const names = [
    'PROPERTY_CENTER_LAT',
    'PROPERTY_CENTER_LNG',
    'PROPERTY_BOUNDS_NE_LAT',
    'PROPERTY_BOUNDS_NE_LNG',
    'PROPERTY_BOUNDS_SW_LAT',
    'PROPERTY_BOUNDS_SW_LNG'
  ] as const

  const missing: string[] = []
  const values: Record<string, number> = {}
  for (const name of names) {
    const raw = env[name]
    const parsed = raw === undefined || raw === '' ? NaN : Number(raw)
    if (!Number.isFinite(parsed)) missing.push(name)
    else values[name] = parsed
  }
  if (missing.length > 0) return { missing }

  const center = { lat: values.PROPERTY_CENTER_LAT, lng: values.PROPERTY_CENTER_LNG }
  const ne = { lat: values.PROPERTY_BOUNDS_NE_LAT, lng: values.PROPERTY_BOUNDS_NE_LNG }
  const sw = { lat: values.PROPERTY_BOUNDS_SW_LAT, lng: values.PROPERTY_BOUNDS_SW_LNG }
  if (!isValidLatLng(center) || !isValidLatLng(ne) || !isValidLatLng(sw)) {
    return { missing: ['PROPERTY_* values are not valid coordinates'] }
  }

  const zoomRaw = Number(env.PROPERTY_DEFAULT_ZOOM ?? '18')
  const defaultZoom = Number.isFinite(zoomRaw) ? zoomRaw : 18

  return { center, bounds: { ne, sw }, defaultZoom }
}
