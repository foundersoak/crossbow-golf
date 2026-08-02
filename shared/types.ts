// API payload types shared by the Worker and the client.

export interface PlayerInfo {
  id: string
  name: string
  isAdmin: boolean
}

export interface HoleData {
  id: string
  holeNumber: number
  name: string | null
  par: number
  tee: { lat: number; lng: number } | null
  pin: { lat: number; lng: number } | null
  distanceYards: number | null
  notes: string | null
  photoKey: string | null
  sortOrder: number
}

export interface LayoutData {
  id: string
  status: 'draft' | 'published'
  versionNumber: number | null
  name: string | null
  notes: string | null
  publishedAt: number | null
  publishedByName?: string | null
  holes: HoleData[]
}

export interface LayoutSummary {
  id: string
  versionNumber: number
  name: string | null
  publishedAt: number
  publishedByName: string | null
  holeCount: number
  totalPar: number
  totalYards: number
}

export interface MeResponse {
  player: PlayerInfo | null
  hasSession: boolean
}

export interface RosterEntry {
  id: string
  name: string
  isAdmin: boolean
}

export interface OverlayCorners {
  nw: { lat: number; lng: number }
  ne: { lat: number; lng: number }
  se: { lat: number; lng: number }
  sw: { lat: number; lng: number }
}

export interface OverlayData {
  id: string
  name: string | null
  imageKey: string
  corners: OverlayCorners
  opacity: number
  isActive: boolean
}

// Draft hole as sent by the editor. Distances are recomputed server-side.
export interface DraftHoleInput {
  id?: string
  holeNumber: number
  name?: string | null
  par: number
  tee?: { lat: number; lng: number } | null
  pin?: { lat: number; lng: number } | null
  notes?: string | null
  photoKey?: string | null
}
