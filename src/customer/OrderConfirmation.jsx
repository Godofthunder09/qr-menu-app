import { useSearchParams, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'

export default function OrderConfirmation() {
  const [searchParams] = useSearchParams()
  const tableName = searchParams.get('name')
  const tableId = searchParams.get('table')
  const navigate = useNavigate()
  const [count, setCount] = useState(5)

  useEffect(() => {
    if (!tableId) return            // no table in the address: do not start the redirect
    const timer = setInterval(() => {
      setCount(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          navigate(`/menu?table=${tableId}`)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Opened directly (no ?table=): show a clear message instead of redirecting to /menu?table=null
  if (!tableId) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-sm text-center">
          <div className="text-7xl mb-4">❌</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Invalid QR Code.</h1>
          <p className="text-gray-500 text-sm">
            This page can only be opened after placing an order.
            Please scan the QR code on your table.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-orange-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-sm text-center">
        <div className="text-7xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Order Successful!</h1>
        <p className="text-gray-500 mb-1">Your order for</p>
        <p className="text-orange-500 font-bold text-lg mb-4">{tableName || 'Your Table'}</p>
        <div className="bg-orange-50 rounded-2xl p-4 mb-6">
          <p className="text-gray-600 text-sm leading-relaxed">
            ✅ Your order has reached the kitchen!<br />
            Please wait while we prepare your food! 🍴
          </p>
        </div>
        <p className="text-gray-400 text-sm mb-4">
          Going back in <span className="font-bold text-orange-500">{count}s</span>
        </p>
        <button
          onClick={() => navigate(`/menu?table=${tableId}`)}
          className="w-full bg-orange-500 text-white py-3 rounded-2xl font-semibold hover:bg-orange-600 transition mb-3">
          + Order More Items
        </button>
        <p className="text-xs text-gray-300 mt-4">🍽️ QR Menu System</p>
      </div>
    </div>
  )
}
