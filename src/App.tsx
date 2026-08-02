import { Routes, Route } from 'react-router-dom'
import MapScreen from './screens/MapScreen'

export default function App() {
  return (
    <Routes>
      <Route path="/*" element={<MapScreen />} />
    </Routes>
  )
}
