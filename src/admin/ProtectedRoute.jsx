import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

export default function ProtectedRoute({ children }) {
  const [checking, setChecking] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        navigate('/')
      } else {
        setAuthenticated(true)
      }
      setChecking(false)
    }
    checkAuth()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        navigate('/')
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  if (checking) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-3">🍽️</div>
          <p className="text-gray-400 text-sm">Checking access...</p>
        </div>
      </div>
    )
  }

  if (!authenticated) return null

  return children
}