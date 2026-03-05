import { Navigate, Route, Routes } from 'react-router-dom'
import RootLayout from './layouts/RootLayout'
import MyPage from './pages/MyPage'
import SearchPage from './pages/SearchPage'
import SettingsPage from './pages/SettingsPage'

export default function AppRouter() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route index element={<Navigate to="/search" replace />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/my" element={<MyPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
