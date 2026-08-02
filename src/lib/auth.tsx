import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from 'react'
import { apiGet, apiSend } from './api'
import type { MeResponse, PlayerInfo } from '../../shared/types'

interface AuthContextValue {
  loading: boolean
  hasSession: boolean
  player: PlayerInfo | null
  refresh: () => Promise<void>
  enterCode: (code: string) => Promise<void>
  claim: (pick: { playerId?: string; name?: string }) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [player, setPlayer] = useState<PlayerInfo | null>(null)

  const refresh = useCallback(async () => {
    try {
      const me = await apiGet<MeResponse>('/api/me')
      setHasSession(me.hasSession)
      setPlayer(me.player)
    } catch {
      setHasSession(false)
      setPlayer(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const enterCode = useCallback(
    async (code: string) => {
      await apiSend('/api/auth/enter', 'POST', { code })
      await refresh()
    },
    [refresh]
  )

  const claim = useCallback(
    async (pick: { playerId?: string; name?: string }) => {
      await apiSend('/api/auth/claim', 'POST', pick)
      await refresh()
    },
    [refresh]
  )

  const logout = useCallback(async () => {
    await apiSend('/api/auth/logout', 'POST')
    setHasSession(false)
    setPlayer(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{ loading, hasSession, player, refresh, enterCode, claim, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
