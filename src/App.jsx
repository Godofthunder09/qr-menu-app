import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Login from './admin/Login'
import Dashboard from './admin/Dashboard'
import MenuManager from './admin/MenuManager'
import TableManager from './admin/TableManager'
import MenuPage from './customer/MenuPage'
import OrderConfirmation from './customer/OrderConfirmation'
import ProtectedRoute from './admin/ProtectedRoute'

function App() {
  return (
    <BrowserRouter>
      <Routes>

        {/* Public Routes */}
        <Route path="/" element={<Login />} />
        <Route path="/admin" element={<Login />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/order-confirmation" element={<OrderConfirmation />} />

        {/* Protected Admin Routes */}
        <Route path="/admin/dashboard" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        <Route path="/admin/menu" element={
          <ProtectedRoute>
            <MenuManager />
          </ProtectedRoute>
        } />
        <Route path="/admin/tables" element={
          <ProtectedRoute>
            <TableManager />
          </ProtectedRoute>
        } />

      </Routes>
    </BrowserRouter>
  )
}

export default App