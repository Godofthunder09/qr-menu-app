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

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/admin" element={<Login />} />
        <Route path="/admin/dashboard" element={<Dashboard />} />
        <Route path="/admin/menu" element={<MenuManager />} />
        <Route path="/admin/tables" element={<TableManager />} />
        <Route path="/admin/today-report" element={<TodayReport />} />
        <Route path="/admin/reports" element={<Reports />} />
        <Route path="/admin/settings" element={<Settings />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/order-confirmation" element={<OrderConfirmation />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App