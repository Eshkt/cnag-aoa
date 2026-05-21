import { Amplify } from 'aws-amplify'
import { signUp, signIn, getCurrentUser } from 'aws-amplify/auth'
// @ts-ignore
import outputs from '../amplify_outputs.json'
import { useState, useEffect } from 'react'
import VotingPage from './VotingPage'
import Dashboard from './Dashboard'

Amplify.configure(outputs)

type Screen = 'signup' | 'vote' | 'dashboard'

// Deterministic password so same user can re-enter without remembering one
function makePassword(email: string): string {
  let hash = 0
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) - hash) + email.charCodeAt(i)
    hash |= 0
  }
  const abs = Math.abs(hash).toString(16).padStart(8, '0')
  return `Aoa2026!${abs}`
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('signup')
  const [fullName, setFullName] = useState('')
  const [studentNumber, setStudentNumber] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser(u);
        setScreen('vote')
      })
      .catch(() => setScreen('signup'))
  }, [])

  async function handleEnter() {
    setError('')
    // Validate UST email
    if (!email.endsWith('@ust.edu.ph')) {
      setError('Only @ust.edu.ph emails are allowed.')
      return
    }
    if (!fullName.trim()) {
      setError('Please enter your full name.')
      return
    }
    if (!studentNumber.trim()) {
      setError('Please enter your student number.')
      return
    }

    setLoading(true)
    const password = makePassword(email)

    try {
      // Try signup first
      await signUp({
        username: email,
        password,
        options: {
          userAttributes: {
            email,
            name: fullName,
            'custom:studentNumber': studentNumber,
          }
        }
      })
    } catch (e: any) {
      // Already registered is fine — just sign them in
      if (e.name !== 'UsernameExistsException') {
        setError(e.message || 'Could not register. Try again.')
        setLoading(false)
        return
      }
    }

    // Sign in after signup (or if already exists)
    try {
      await signIn({ username: email, password })
      const u = await getCurrentUser()
      setUser(u)
      setScreen('vote')
    } catch (e: any) {
      setError(e.message || 'Could not sign in. Contact COMELEC.')
    }
    setLoading(false)
  }

  function handleSignout() {
    import('aws-amplify/auth').then(({ signOut }) => signOut())
    setUser(null)
    setScreen('signup')
  }

  if (screen === 'signup') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f0f1a', fontFamily: 'sans-serif' }}>
      <div style={{ background: '#1a1a2e', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '420px', color: 'white', boxShadow: '0 4px 32px rgba(0,0,0,0.4)' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.4rem', margin: 0, letterSpacing: 1 }}>CNAG-CICS</h1>
          <p style={{ color: '#aaa', margin: '0.4rem 0 0', fontSize: '0.95rem' }}>
            AOA General Assembly — May 30, 2026
          </p>
          <p style={{ color: '#666', fontSize: '0.8rem', marginTop: '0.25rem' }}>
            Register to access the voting system
          </p>
        </div>

        {[
          { label: 'Full Name', value: fullName, setter: setFullName, placeholder: 'Juan dela Cruz', type: 'text' },
          { label: 'Student Number', value: studentNumber, setter: setStudentNumber, placeholder: '2021-00001', type: 'text' },
          { label: 'UST Email', value: email, setter: setEmail, placeholder: 'juan.delacruz@ust.edu.ph', type: 'email' },
        ].map(({ label, value, setter, placeholder, type }) => (
          <div key={label} style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#aaa', marginBottom: '0.3rem' }}>
              {label}
            </label>
            <input
              type={type}
              placeholder={placeholder}
              value={value}
              onChange={e => setter(e.target.value)}
              style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #333', background: '#0f0f1a', color: 'white', boxSizing: 'border-box', fontSize: '0.95rem' }}
            />
          </div>
        ))}

        {error && (
          <p style={{ color: '#ff6b6b', fontSize: '0.85rem', marginBottom: '1rem', textAlign: 'center' }}>
            {error}
          </p>
        )}

        <button
          onClick={handleEnter}
          disabled={loading || !email || !fullName || !studentNumber}
          style={{ width: '100%', padding: '0.8rem', background: loading ? '#333' : '#4a9eff', color: 'white', border: 'none', borderRadius: '8px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '1rem', fontWeight: 'bold', marginTop: '0.5rem' }}
        >
          {loading ? 'Please wait...' : 'Enter Voting System →'}
        </button>

        <p style={{ color: '#444', fontSize: '0.75rem', textAlign: 'center', marginTop: '1rem' }}>
          Only registered CNAG-CICS members with @ust.edu.ph emails may vote. Your participation is recorded for audit purposes.
        </p>
      </div>
    </div>
  )

  return (
    <div>
      <nav style={{ padding: '1rem 1.5rem', background: '#1a1a2e', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>
          CNAG-CICS AOA Voting System
        </span>
        <div>
          <button onClick={() => setScreen('vote')} style={{ marginRight: 8, background: 'none', border: '1px solid #4a9eff', color: '#4a9eff', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer' }}>
            Vote
          </button>
          <button onClick={() => setScreen('dashboard')} style={{ marginRight: 8, background: 'none', border: '1px solid #4a9eff', color: '#4a9eff', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer' }}>
            Dashboard
          </button>
          <button onClick={handleSignout} style={{ background: 'none', border: '1px solid #ff6b6b', color: '#ff6b6b', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer' }}>
            Sign Out
          </button>
        </div>
      </nav>
      {screen === 'vote' ? <VotingPage user={user} /> : <Dashboard user={user} /> }
    </div>
  )
}
