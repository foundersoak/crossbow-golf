export interface Env {
  DB: D1Database
  MEDIA: R2Bucket
  ASSETS: Fetcher

  // Property location. Set via .dev.vars locally and `wrangler secret put`
  // in production. Never committed, never baked into the client bundle.
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
