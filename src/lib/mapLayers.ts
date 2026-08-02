import L from 'leaflet'

export interface BaseLayerDef {
  key: string
  label: string
  attribution: string
  make: () => Promise<L.Layer>
  /** Layers that fail at runtime (network, CORS) are dropped from the picker. */
  probe?: () => Promise<boolean>
}

// Default basemap: Esri World Imagery via the classic keyless endpoint.
// Attribution is required by Esri's terms.
const ESRI_WORLD_IMAGERY: BaseLayerDef = {
  key: 'esri',
  label: 'Satellite (Esri)',
  attribution:
    'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  make: async () =>
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 21, maxNativeZoom: 19 }
    )
}

// Public-domain USDA NAIP for Texas, served by TxGIO. Often the most honest
// recent picture of rural land. Loaded through esri-leaflet because it is an
// ImageServer, not a tile service. Dropped from the picker if unreachable.
const TXGIO_NAIP: BaseLayerDef = {
  key: 'naip',
  label: 'Aerial (USDA NAIP 2022)',
  attribution: 'USDA NAIP via TxGIO, public domain',
  make: async () => {
    const esri = await import('esri-leaflet')
    return esri.imageMapLayer({
      url: 'https://imagery.geographic.texas.gov/server/rest/services/NAIP/NAIP22_NCCIR_60cm/ImageServer',
      maxZoom: 19
    }) as unknown as L.Layer
  },
  probe: async () => {
    try {
      const res = await fetch(
        'https://imagery.geographic.texas.gov/server/rest/services/NAIP/NAIP22_NCCIR_60cm/ImageServer?f=json',
        { signal: AbortSignal.timeout(5000) }
      )
      if (!res.ok) return false
      const info = (await res.json()) as { error?: unknown }
      return !info.error
    } catch {
      return false
    }
  }
}

export const BASE_LAYERS: BaseLayerDef[] = [ESRI_WORLD_IMAGERY, TXGIO_NAIP]

const LAYER_PREF_KEY = 'crossbow.baseLayer'

export function getPreferredLayerKey(): string {
  return localStorage.getItem(LAYER_PREF_KEY) ?? BASE_LAYERS[0].key
}

export function setPreferredLayerKey(key: string): void {
  localStorage.setItem(LAYER_PREF_KEY, key)
}
