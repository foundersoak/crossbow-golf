export interface Env {
  DB: D1Database
  MEDIA: R2Bucket
  ASSETS: Fetcher
  ROUND_ROOMS: DurableObjectNamespace

  // Property location. Set via .dev.vars locally and secrets in production.
  // Never committed, never baked into the client bundle.
  // PROPERTY_CONFIG may carry all of the values below as one JSON object
  // (single paste on mobile); individual vars take precedence if both exist.
  // Arrives as a string (type Secret/Text) or an object (type JSON).
  PROPERTY_CONFIG?: string | Record<string, unknown>
  PROPERTY_CENTER_LAT?: string
  PROPERTY_CENTER_LNG?: string
  PROPERTY_BOUNDS_NE_LAT?: string
  PROPERTY_BOUNDS_NE_LNG?: string
  PROPERTY_BOUNDS_SW_LAT?: string
  PROPERTY_BOUNDS_SW_LNG?: string
  PROPERTY_DEFAULT_ZOOM?: string

  // Family invite code used to seed the config table on first request.
  INVITE_CODE?: string
}
