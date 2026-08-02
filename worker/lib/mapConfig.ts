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
  // A single PROPERTY_CONFIG JSON secret may carry every value, so mobile
  // setup is one paste. Individually set vars win over the JSON.
  let bundle: Record<string, unknown> = {}
  const rawConfig: unknown = env.PROPERTY_CONFIG
  if (rawConfig && typeof rawConfig === 'object') {
    // A variable saved with type "JSON" in the dashboard arrives as an
    // already-parsed object. Use it directly.
    bundle = rawConfig as Record<string, unknown>
  } else if (typeof rawConfig === 'string' && rawConfig.trim() !== '') {
    // Phone keyboards love to smarten quotes and sneak in invisible
    // characters; normalize before parsing so a mobile paste just works.
    const cleaned = rawConfig
      .replace(/[\u201C\u201D\u201E\u2033]/g, '"') // curly double quotes
      .replace(/[\u2018\u2019\u2032]/g, "'") // curly single quotes
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars and BOM
      .replace(/\u00A0/g, ' ') // non-breaking space
      .trim()
    try {
      let parsed: unknown = JSON.parse(cleaned)
      // A value saved with an extra layer of quoting parses to a string of
      // JSON; unwrap it instead of silently ignoring it.
      if (typeof parsed === 'string') parsed = JSON.parse(parsed)
      if (parsed && typeof parsed === 'object') bundle = parsed as Record<string, unknown>
    } catch {
      return {
        missing: [
          'PROPERTY_CONFIG is set but is not valid JSON. Re-paste it, making sure it starts with { and ends with } and uses straight quotes.'
        ]
      }
    }
  }

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
    const raw = env[name] ?? bundle[name]
    const parsed = raw === undefined || raw === '' ? NaN : Number(raw)
    if (!Number.isFinite(parsed)) missing.push(name)
    else values[name] = parsed
  }
  if (missing.length > 0) {
    // Say exactly what the server can see, so a phone-side fix is obvious.
    // Key names only; never values.
    if (!env.PROPERTY_CONFIG) {
      missing.push(
        'Note: no PROPERTY_CONFIG secret is visible. If you added one, check the name is exactly PROPERTY_CONFIG.'
      )
    } else {
      const keys = Object.keys(bundle)
      missing.push(
        keys.length === 0
          ? 'Note: PROPERTY_CONFIG parsed as JSON but is not an object with the expected keys.'
          : `Note: PROPERTY_CONFIG contains these keys: ${keys.join(', ')}`
      )
    }
    return { missing }
  }

  const center = { lat: values.PROPERTY_CENTER_LAT, lng: values.PROPERTY_CENTER_LNG }
  const ne = { lat: values.PROPERTY_BOUNDS_NE_LAT, lng: values.PROPERTY_BOUNDS_NE_LNG }
  const sw = { lat: values.PROPERTY_BOUNDS_SW_LAT, lng: values.PROPERTY_BOUNDS_SW_LNG }
  if (!isValidLatLng(center) || !isValidLatLng(ne) || !isValidLatLng(sw)) {
    return { missing: ['PROPERTY_* values are not valid coordinates'] }
  }

  const zoomRaw = Number(env.PROPERTY_DEFAULT_ZOOM ?? bundle.PROPERTY_DEFAULT_ZOOM ?? '18')
  const defaultZoom = Number.isFinite(zoomRaw) ? zoomRaw : 18

  return { center, bounds: { ne, sw }, defaultZoom }
}
