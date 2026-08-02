import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Shell from './components/Shell'
import GateScreen from './screens/GateScreen'
import MapScreen from './screens/MapScreen'
import EditScreen from './screens/EditScreen'
import LayoutsScreen from './screens/LayoutsScreen'
import MoreScreen from './screens/MoreScreen'
import StubScreen from './screens/StubScreen'

export default function App() {
  return (
    <AuthProvider>
      <Gated />
    </AuthProvider>
  )
}

function Gated() {
  const { loading, player } = useAuth()

  if (loading) {
    return (
      <div className="screen-center">
        <p className="muted">Warming up…</p>
      </div>
    )
  }

  if (!player) return <GateScreen />

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<MapScreen />} />
        <Route path="/edit" element={<EditScreen />} />
        <Route path="/layouts" element={<LayoutsScreen />} />
        <Route
          path="/rounds"
          element={<StubScreen title="Rounds" note="Live scoring arrives in the next phase." />}
        />
        <Route
          path="/boards"
          element={
            <StubScreen title="Boards" note="Leaderboards and records arrive in a later phase." />
          }
        />
        <Route path="/more" element={<MoreScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
