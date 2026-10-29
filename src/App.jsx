import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Login from './admin/Login'
import Dashboard from './admin/Dashboard'
import MenuManager from './admin/MenuManager'
import TableManager from './admin/TableManager'
import Reports from './admin/Reports'
import TodayReport from './admin/TodayReport'
import Settings from './admin/Settings'
import MenuPage from './customer/MenuPage'
import OrderConfirmation from './customer/OrderConfirmation'
import ProtectedRoute from './admin/ProtectedRoute'
import AdminCode from './admin/AdminCode'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/admin" element={<Login />} />
        <Route path="/admin/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/admin/menu" element={<ProtectedRoute><MenuManager /></ProtectedRoute>} />
        <Route path="/admin/tables" element={<ProtectedRoute><TableManager /></ProtectedRoute>} />
        <Route path="/admin/today-report" element={<ProtectedRoute><TodayReport /></ProtectedRoute>} />
        <Route path="/admin/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
        <Route path="/admin/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/order-confirmation" element={<OrderConfirmation />} />
        <Route path="/admin/admin-code" element={<ProtectedRoute><AdminCode /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
