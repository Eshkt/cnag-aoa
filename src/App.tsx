import { useState, useEffect } from 'react'
// @ts-ignore
import outputs from '../amplify_outputs.json'
import VotingPage from './VotingPage'
import AdminPage from './AdminPage'

const API_URL = outputs.custom.apiEndpoint.replace(/\/$/, '');

type Screen = 'voter-login' | 'admin-login' | 'vote' | 'admin-dashboard'

export default function App() {
  const [screen, setScreen] = useState<'voter-login' | 'admin-login' | 'vote' | 'admin-dashboard'>('voter-login')
  const [fullName, setFullName] = useState('')
  const [studentNumber, setStudentNumber] = useState('')
  const [email, setEmail] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith('/admin')) {
      setScreen('admin-login');
    } else {
      setScreen('voter-login');
    }
  }, [])

  async function handleVoterEnter() {
    setError('')
    if (!email.toLowerCase().endsWith('@ust.edu.ph')) {
      setError('Only @ust.edu.ph emails are allowed.')
      return
    }
    if (!fullName.trim() || !studentNumber.trim()) {
      setError('Please fill in all fields.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/begin-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            name: fullName.trim(), 
            studentNumber: studentNumber.trim(), 
            email: email.trim().toLowerCase() 
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to enter system')
      }

      setToken(data.token)
      const payload = JSON.parse(atob(data.token.split('.')[0]))
      setUser(payload)
      setScreen('vote')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // FIX 3: Admin Login with trim/lowercase
  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail.trim().toLowerCase() })
      });
      const data = await res.json();
      if (!res.ok) {
          if (res.status === 403) throw new Error('This email is not authorized for admin access.');
          throw new Error(data.error || 'Access Denied');
      }
      
      setToken(data.token);
      setScreen('admin-dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSignout() {
    setToken(null)
    setUser(null)
    setScreen(screen.includes('admin') ? 'admin-login' : 'voter-login')
  }

  if (screen === 'voter-login') return (
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
        
        <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: '0.35rem' }}>Full Name</label>
            <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Juan dela Cruz" style={{ width: '100%', padding: '0.7rem 0.9rem', background: '#0d0d18', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: '0.35rem' }}>Student Number</label>
            <input value={studentNumber} onChange={e => setStudentNumber(e.target.value)} placeholder="2021-00001" style={{ width: '100%', padding: '0.7rem 0.9rem', background: '#0d0d18', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: '0.35rem' }}>UST Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="juan.delacruz@ust.edu.ph" style={{ width: '100%', padding: '0.7rem 0.9rem', background: '#0d0d18', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem', boxSizing: 'border-box' }} />
        </div>

        {error && <p style={{ color: '#ff6b6b', fontSize: '0.82rem', marginBottom: '0.75rem', textAlign: 'center' }}>{error}</p>}
        <button onClick={handleVoterEnter} disabled={loading || !email || !fullName || !studentNumber} style={{ width: '100%', padding: '0.8rem', background: loading ? '#444' : '#e8001c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Please wait...' : 'Enter Voting System →'}
        </button>
        
        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
            <button onClick={() => setScreen('admin-login')} style={{ background: 'none', border: 'none', color: '#444', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}>Admin Access</button>
        </div>
      </div>
    </div>
  )

  if (screen === 'admin-login') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', padding: '1rem' }}>
        <form onSubmit={handleAdminLogin} style={{ background: '#111118', padding: '2.5rem', borderRadius: '16px', width: '100%', maxWidth: '380px', border: '1px solid #222' }}>
            <h2 style={{ color: 'white', textAlign: 'center', marginBottom: '2rem' }}>COMELEC ADMIN</h2>
            <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', color: '#666', fontSize: '0.8rem', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Admin Email</label>
                <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="admin@ust.edu.ph" required style={{ width: '100%', padding: '0.8rem', background: '#0a0a0a', border: '1px solid #333', borderRadius: '8px', color: 'white', boxSizing: 'border-box' }} />
            </div>
            {error && <p style={{ color: '#e8001c', fontSize: '0.85rem', textAlign: 'center', marginBottom: '1rem' }}>{error}</p>}
            <button type="submit" disabled={loading} style={{ width: '100%', padding: '0.9rem', background: '#e8001c', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                {loading ? 'Verifying...' : 'Access Admin Panel'}
            </button>
            <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                <button onClick={() => setScreen('voter-login')} style={{ background: 'none', border: 'none', color: '#444', fontSize: '0.75rem', cursor: 'pointer' }}>← Back to Voter Login</button>
            </div>
        </form>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a' }}>
      <nav style={{ padding: '1rem 1.5rem', background: '#111118', borderBottom: '1px solid #222', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
           <img src="/ust-white.png" style={{ height: '30px' }} alt="UST" />
           <span style={{ fontWeight: 'bold', fontSize: '0.9rem', letterSpacing: '1px' }}>CNAG-CICS <span style={{ color: '#f5c400' }}>AOA</span></span>
        </div>
        <button onClick={handleSignout} style={{ background: 'none', border: '1px solid #444', color: '#aaa', padding: '0.4rem 1rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
            Sign Out
        </button>
      </nav>
      {screen === 'vote' ? <VotingPage token={token} /> : <AdminPage initialToken={token} /> }
    </div>
  )
}
