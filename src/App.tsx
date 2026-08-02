import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Shell from './components/Shell'
import GateScreen from './screens/GateScreen'
import MapScreen from './screens/MapScreen'
import EditScreen from './screens/EditScreen'
import LayoutsScreen from './screens/LayoutsScreen'
import MoreScreen from './screens/MoreScreen'
import RoundsScreen from './screens/RoundsScreen'
import NewRoundScreen from './screens/NewRoundScreen'
import RoundScreen from './screens/RoundScreen'
import JoinScreen from './screens/JoinScreen'
import BoardsScreen from './screens/BoardsScreen'
import ProfileScreen from './screens/ProfileScreen'
import OverlayScreen from './screens/OverlayScreen'

export default function App() {
  return (
    <AuthProvider>
      <Gated />
    </AuthProvider>
  )
}

function Gated() {
  const { loading, player } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="screen-center">
        <p className="muted">Warming up…</p>
      </div>
    )
  }

  // Round links work without a prior session: the join code in the link is
  // the capability, and joining mints the device session.
  if (location.pathname.startsWith('/r/')) {
    return (
      <Routes>
        <Route path="/r/:code" element={<JoinScreen />} />
      </Routes>
    )
  }

  if (!player) return <GateScreen />

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<MapScreen />} />
        <Route path="/edit" element={<EditScreen />} />
        <Route path="/layouts" element={<LayoutsScreen />} />
        <Route path="/rounds" element={<RoundsScreen />} />
        <Route path="/rounds/new" element={<NewRoundScreen />} />
        <Route path="/rounds/:id" element={<RoundScreen />} />
        <Route path="/boards" element={<BoardsScreen />} />
        <Route path="/players/:id" element={<ProfileScreen />} />
        <Route path="/overlay" element={<OverlayScreen />} />
        <Route path="/more" element={<MoreScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
