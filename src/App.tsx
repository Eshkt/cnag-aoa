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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', fontFamily: 'system-ui, sans-serif', padding: '1rem' }}>
      <div style={{ background: '#111118', border: '0.5px solid rgba(245,196,0,0.25)', borderRadius: '16px', width: '100%', maxWidth: '420px', padding: '2rem', color: 'white', }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '18px', marginBottom: '1rem' }}>
            <img src="/ust-white.png" alt="UST" style={{ width: 48, height: 48, objectFit: 'contain' }} />
            <div style={{ width: 1, height: 40, background: 'rgba(245,196,0,0.2)' }} />
            <div style={{ textAlign: 'center', lineHeight: 1.1 }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 600, color: 'white', letterSpacing: 1 }}>CNAG</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#e8001c', letterSpacing: 1 }}>CICS</div>
            </div>
            <div style={{ width: 1, height: 40, background: 'rgba(245,196,0,0.2)' }} />
            <img src="/cics-logo.png" alt="CICS" style={{ width: 48, height: 48, objectFit: 'contain' }} />
          </div>
          <div style={{ display: 'inline-block', background: 'rgba(245,196,0,0.08)', border: '0.5px solid rgba(245,196,0,0.25)', borderRadius: '20px', padding: '3px 14px', fontSize: '11px', color: 'rgba(245,196,0,0.7)', letterSpacing: '0.5px', marginBottom: '0.75rem' }}>
            General Assembly — May 30, 2026
          </div>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 500, color: 'white', margin: '0 0 0.3rem' }}>
            AOA Ratification Vote
          </h1>
          <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
            Enter your details to access the voting system
          </p>
        </div>
        <div style={{ height: '1.5px', background: 'linear-gradient(90deg, transparent, rgba(245,196,0,0.4), transparent)', margin: '0 0 1.25rem' }} />
        {[
          { label: 'Full Name', value: fullName, setter: setFullName, placeholder: 'Juan dela Cruz', type: 'text' },
          { label: 'Student Number', value: studentNumber, setter: setStudentNumber, placeholder: '2021-00001', type: 'text' },
          { label: 'UST Email', value: email, setter: setEmail, placeholder: 'juan.delacruz@ust.edu.ph', type: 'email' },
        ].map(({ label, value, setter, placeholder, type }) => (
          <div key={label} style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: '0.35rem' }}>
              {label}
            </label>
            <input
              type={type}
              placeholder={placeholder}
              value={value}
              onChange={e => setter(e.target.value)}
              style={{ width: '100%', padding: '0.7rem 0.9rem', background: '#0d0d18', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem', boxSizing: 'border-box', outline: 'none', }}
            />
          </div>
        ))}
        {error && (
          <p style={{ color: '#ff6b6b', fontSize: '0.82rem', marginBottom: '0.75rem', textAlign: 'center' }}>
            {error}
          </p>
        )}
        <button
          onClick={handleEnter}
          disabled={loading || !email || !fullName || !studentNumber}
          style={{ width: '100%', padding: '0.8rem', background: loading ? '#444' : '#e8001c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.5px', marginTop: '0.25rem' }}
        >
          {loading ? 'Please wait...' : 'Enter Voting System →'}
        </button>
        <p style={{ textAlign: 'center', fontSize: '0.72rem', color: 'rgba(255,255,255,0.25)', marginTop: '1.25rem', lineHeight: 1.6 }}>
          Only registered CNAG-CICS members with{' '}
          <span style={{ color: 'rgba(245,196,0,0.5)' }}>@ust.edu.ph</span>{' '}
          emails may vote.<br />
          Your participation is recorded for audit purposes.
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
