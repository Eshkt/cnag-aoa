import { Amplify } from 'aws-amplify'
import { signUp, signIn, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth'
// @ts-ignore
import outputs from '../amplify_outputs.json'
import { useState, useEffect } from 'react'
import VotingPage from './VotingPage'
import AdminPage from './AdminPage'

Amplify.configure(outputs)

type Screen = 'signup' | 'vote' | 'admin' | 'loading'

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
  const [screen, setScreen] = useState<Screen>('loading')
  const [fullName, setFullName] = useState('')
  const [studentNumber, setStudentNumber] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    checkUser()
  }, [])

  async function checkUser() {
    try {
      const u = await getCurrentUser()
      setUser(u)
      
      const session = await fetchAuthSession()
      const groups = (session.tokens?.idToken?.payload['cognito:groups'] as string[]) || []
      const admin = groups.includes('comelec-admin')
      setIsAdmin(admin)

      // Auto route to admin if admin, else vote
      setScreen(admin ? 'admin' : 'vote')
    } catch {
      setScreen('signup')
    }
  }

  async function handleEnter() {
    setError('')
    if (!email.endsWith('@ust.edu.ph')) {
      setError('Only @ust.edu.ph emails are allowed.')
      return
    }
    if (!fullName.trim() || !studentNumber.trim()) {
      setError('Please fill in all fields.')
      return
    }

    setLoading(true)
    const password = makePassword(email)

    try {
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
      if (e.name !== 'UsernameExistsException') {
        setError(e.message || 'Could not register. Try again.')
        setLoading(false)
        return
      }
    }

    try {
      await signIn({ username: email, password })
      await checkUser()
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

  if (screen === 'loading') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#f5c400' }}>
      Authenticating...
    </div>
  )

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
    <div style={{ minHeight: '100vh', background: '#0a0a0a' }}>
      <nav style={{ padding: '1rem 1.5rem', background: '#111118', borderBottom: '1px solid #222', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', sticky: 'top', zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
           <img src="/ust-white.png" style={{ height: '30px' }} />
           <span style={{ fontWeight: 'bold', fontSize: '0.9rem', letterSpacing: '1px' }}>CNAG-CICS <span style={{ color: '#f5c400' }}>AOA</span></span>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {isAdmin && (
            <button 
              onClick={() => setScreen('admin')} 
              style={{ background: screen === 'admin' ? '#f5c400' : 'none', border: '1px solid #f5c400', color: screen === 'admin' ? 'black' : '#f5c400', padding: '0.4rem 1rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
            >
              ADMIN
            </button>
          )}
          <button 
            onClick={() => setScreen('vote')} 
            style={{ background: screen === 'vote' ? '#f5c400' : 'none', border: '1px solid #f5c400', color: screen === 'vote' ? 'black' : '#f5c400', padding: '0.4rem 1rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
          >
            VOTE
          </button>
          <button 
            onClick={handleSignout} 
            style={{ background: 'none', border: '1px solid #444', color: '#aaa', padding: '0.4rem 1rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
          >
            Sign Out
          </button>
        </div>
      </nav>
      {screen === 'vote' ? <VotingPage user={user} /> : <AdminPage /> }
    </div>
  )
}
