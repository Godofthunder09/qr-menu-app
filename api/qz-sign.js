// Vercel serverless function: signs QZ Tray print requests.
// Only a logged-in Supabase admin can get a signature, and the private key
// lives only in the Vercel env var QZ_PRIVATE_KEY (never in the browser/GitHub).
import crypto from 'node:crypto'

const getPrivateKey = () => {
  const raw = (process.env.QZ_PRIVATE_KEY || '').trim()
  if (!raw) return null
  if (raw.includes('BEGIN')) return raw.replace(/\\n/g, '\n')
  return Buffer.from(raw, 'base64').toString('utf8') // base64 of the PEM file
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('POST only')

  const key = getPrivateKey()
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const missing = [!key && 'QZ_PRIVATE_KEY', !url && 'SUPABASE_URL', !anon && 'SUPABASE_ANON_KEY'].filter(Boolean)
  if (missing.length) return res.status(500).send('Missing: ' + missing.join(', '))
  // 1. Caller must be a logged-in admin (valid Supabase session token).
  const auth = req.headers.authorization || ''
  if (!auth.startsWith('Bearer ')) return res.status(401).send('Login required')
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: auth },
    })
    if (!r.ok) return res.status(401).send('Invalid session')
  } catch (e) {
    return res.status(502).send('Could not verify login')
  }

  // 2. Sign the text QZ Tray sent (plain-text body), SHA512 + RSA.
  const toSign = typeof req.body === 'string' ? req.body : ''
  if (!toSign || toSign.length > 10000) return res.status(400).send('Bad request')
  try {
    const sig = crypto.createSign('SHA512').update(toSign).sign(key, 'base64')
    res.setHeader('Content-Type', 'text/plain')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(sig)
  } catch (e) {
    return res.status(500).send('Signing failed')
  }
}
