import { useEffect, useState } from 'react'
import { apiGet, ApiError } from './api'
import type { MapConfig } from '../components/CourseMapView'

export type MapConfigState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; missing?: string[] }
  | { kind: 'ready'; config: MapConfig }

export function useMapConfig(): MapConfigState {
  const [state, setState] = useState<MapConfigState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    apiGet<MapConfig>('/api/config')
      .then((config) => {
        if (!cancelled) setState({ kind: 'ready', config })
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError) {
          const body = err.body as { missing?: string[] } | null
          setState({ kind: 'error', message: err.message, missing: body?.missing })
        } else {
          setState({ kind: 'error', message: 'Could not reach the server.' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
