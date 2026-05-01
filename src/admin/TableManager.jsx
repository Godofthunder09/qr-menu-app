import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'
import { QRCodeCanvas } from 'qrcode.react'

export default function TableManager() {
  const [tables, setTables] = useState([])
  const [tableName, setTableName] = useState('')
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [message, setMessage] = useState('')
  const navigate = useNavigate()

  const fetchTables = async () => {
    const { data } = await supabase.from('tables').select('*').order('created_at')
    setTables(data || [])
  }

  useEffect(() => {
    fetchTables()
  }, [])

  const addTable = async () => {
    if (!tableName.trim()) { alert('Enter table name!'); return }
    if (tables.length >= 10) { alert('Beta limit: max 10 tables!'); return }
    setLoading(true)

    const { error } = await supabase.from('tables').insert({
      table_name: tableName.trim(),
      is_active: true,
      session_version: 1
    })

    if (error) { alert('Error: ' + error.message); setLoading(false); return }

    setTableName('')
    setLoading(false)
    setMessage('Table added! ✅')
    setTimeout(() => setMessage(''), 2000)
    fetchTables()
  }

  const deleteTable = async (table) => {
    if (!window.confirm(
      `Delete "${table.table_name}" permanently?\n\nThis will delete:\n• All orders for this table\n• All order items\n• The session\n• The QR code will stop working`
    )) return

    setDeleting(table.id)

    try {
      // With cascade constraints, just deleting the table
      // will automatically delete orders, order_items, sessions
      const { error } = await supabase
        .from('tables')
        .delete()
        .eq('id', table.id)

      if (error) {
        // If cascade didn't work, manually delete
        const { data: ords } = await supabase
          .from('orders').select('id').eq('table_id', table.id)

        if (ords && ords.length > 0) {
          await supabase.from('order_items')
            .delete().in('order_id', ords.map(o => o.id))
          await supabase.from('orders')
            .delete().eq('table_id', table.id)
        }

        await supabase.from('table_sessions')
          .delete().eq('table_id', table.id)

        await supabase.from('tables')
          .delete().eq('id', table.id)
      }

      setMessage(`"${table.table_name}" deleted successfully! ✅`)
      setTimeout(() => setMessage(''), 3000)
      fetchTables()
    } catch (err) {
      alert('Error deleting table: ' + err.message)
    }

    setDeleting(null)
  }

  const downloadQR = (tableName, tableId) => {
    const canvas = document.getElementById(`qr-${tableId}`)
    if (!canvas) { alert('QR not ready!'); return }
    const url = canvas.toDataURL('image/png')
    const link = document.createElement('a')
    link.download = `QR-${tableName}.png`
    link.href = url
    link.click()
  }

  const getMenuUrl = (tableId) => {
    return `${window.location.origin}/menu?table=${tableId}`
  }

  return (
    <div className="min-h-screen bg-orange-50">

      {/* Navbar */}
      <div className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🍽️</span>
          <h1 className="text-xl font-bold text-orange-500">Table Manager</h1>
        </div>
        <button onClick={() => navigate('/admin/dashboard')}
          className="bg-orange-100 text-orange-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-200">
          ← Dashboard
        </button>
      </div>

      <div className="p-6 max-w-4xl mx-auto">

        {/* Success Message */}
        {message && (
          <div className="bg-green-100 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm font-medium">
            {message}
          </div>
        )}

        {/* Add Table */}
        <div className="bg-white rounded-2xl shadow p-6 mb-6">
          <h2 className="font-bold text-gray-700 mb-4">
            Add Table ({tables.length}/10 used)
          </h2>
          <div className="flex gap-3">
            <input
              type="text"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTable()}
              placeholder="e.g. Table 1, Table A, VIP Table"
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <button
              onClick={addTable}
              disabled={loading || tables.length >= 10}
              className="bg-orange-500 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50">
              {loading ? 'Adding...' : 'Add Table'}
            </button>
          </div>
          {tables.length >= 10 && (
            <p className="text-red-400 text-xs mt-2">Beta limit reached. Max 10 tables.</p>
          )}
        </div>

        {/* Tables Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tables.length === 0 && (
            <div className="col-span-2 text-center py-16 text-gray-400">
              <div className="text-5xl mb-3">🪑</div>
              <p>No tables yet. Add your first table above!</p>
            </div>
          )}

          {tables.map((table) => (
            <div key={table.id} className="bg-white rounded-2xl shadow p-5 flex flex-col items-center">

              {/* Table Name */}
              <h3 className="font-bold text-lg text-orange-500 mb-4">
                {table.table_name}
              </h3>

              {/* QR Code */}
              <div className="bg-white p-3 rounded-xl border-2 border-orange-100 mb-4">
                <QRCodeCanvas
                  id={`qr-${table.id}`}
                  value={getMenuUrl(table.id)}
                  size={150}
                  level="H"
                  includeMargin={true}
                />
              </div>

              {/* URL */}
              <p className="text-xs text-gray-400 text-center mb-4 break-all px-2">
                {getMenuUrl(table.id)}
              </p>

              {/* Buttons */}
              <div className="flex gap-2 w-full">
                <button
                  onClick={() => downloadQR(table.table_name, table.id)}
                  className="flex-1 bg-orange-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
                  ⬇️ Download QR
                </button>
                <button
                  onClick={() => deleteTable(table)}
                  disabled={deleting === table.id}
                  className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50">
                  {deleting === table.id ? '⏳' : '🗑️ Delete'}
                </button>
              </div>

              {/* Warning */}
              <p className="text-xs text-red-300 mt-2 text-center">
                Deleting removes ALL orders and data for this table
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}