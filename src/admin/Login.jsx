import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError('Invalid email or password!')
      setLoading(false)
    } else {
      navigate('/admin/dashboard')
    }
  }

  return (
    <div className="min-h-screen bg-orange-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">

        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🍽️</div>
          <h1 className="text-3xl font-bold text-orange-500">QR Menu</h1>
          <p className="text-gray-500 mt-1">Admin Login</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-100 text-red-600 px-4 py-3 rounded-lg mb-5 text-sm">
            {error}
          </div>
        )}

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-lg transition duration-200 mt-2"
          >
            {loading ? 'Logging in...' : 'Login →'}
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          QR Menu Admin Panel • Only authorized access
        </p>
      </div>
    </div>
  )
}