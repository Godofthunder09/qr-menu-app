import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Login from './admin/Login'
import Dashboard from './admin/Dashboard'
import MenuManager from './admin/MenuManager'
import TableManager from './admin/TableManager'
import Reports from './admin/Reports'
import TodayReport from './admin/TodayReport'
import Settings from './admin/Settings'
import ReportTablewise from './admin/Report/Report-Tablewise'
import MenuPage from './customer/MenuPage'
import OrderConfirmation from './customer/OrderConfirmation'
import ReportToday from './admin/Report/Report-Today'
import ReportDateRange from './admin/Report/Report-DateRange'
import ReportCategory from './admin/Report/Report-Category'
import ReportDiscounts from './admin/Report/Report-Discounts'
import ReportSettlement from './admin/Report/Report-Settlement'

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
        <Route path="/admin/reports/tablewise" element={<ReportTablewise />} />
        <Route path="/admin/settings" element={<Settings />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/order-confirmation" element={<OrderConfirmation />} />
        <Route path="/admin/report/today" element={<ProtectedRoute><ReportToday /></ProtectedRoute>} />
        <Route path="/admin/report/daterange" element={<ProtectedRoute><ReportDateRange /></ProtectedRoute>} />
        <Route path="/admin/report/category" element={<ProtectedRoute><ReportCategory /></ProtectedRoute>} />
        <Route path="/admin/report/discounts" element={<ProtectedRoute><ReportDiscounts /></ProtectedRoute>} />
        <Route path="/admin/report/settlement" element={<ProtectedRoute><ReportSettlement /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App