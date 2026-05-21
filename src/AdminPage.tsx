import { useState, useEffect } from 'react';
// @ts-ignore
import outputs from '../amplify_outputs.json';

const API_URL = outputs.custom.apiEndpoint.replace(/\/$/, '');

interface Turnout {
  totalVoted: number;
  totalEligible: number;
  windowOpen: boolean;
}

interface Results {
  yes: { count: number, percentage: number };
  no: { count: number, percentage: number };
  total: number;
}

interface Voter {
  voterId: string;
  name: string;
  email: string;
  timestamp: string;
  voteHash: string;
  selections?: string;
}

type Tab = 'Overview' | 'Results' | 'Voters' | 'Export';

export default function AdminPage() {
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [tab, setTab] = useState<Tab>('Overview');
  const [turnout, setTurnout] = useState<Turnout | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [voters, setVoters] = useState<Voter[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Auto-refresh interval
  useEffect(() => {
    if (!adminToken) return;
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, [adminToken]);

  // ERROR 3: Centralized fetch helper
  async function adminFetch(path: string, options: any = {}) {
    if (!adminToken) return null;
    
    try {
      const res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${adminToken}`, // ERROR 1: Always send Bearer token
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });

      // ERROR 1: Handle 401 (Session expired or Cold Start reset)
      if (res.status === 401) {
        setAdminToken(null);
        setError('Session expired. Please login again.');
        return null;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Request failed: ${res.status}`);
      }

      return await res.json();
    } catch (err: any) {
      console.error(`Admin fetch error [${path}]:`, err);
      return null;
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      setAdminToken(data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDashboard() {
    const [tData, rData, vData] = await Promise.all([
      adminFetch('/admin/turnout'),
      adminFetch('/admin/results'),
      adminFetch('/admin/voters')
    ]);

    if (tData) setTurnout(tData);
    if (rData) setResults(rData);
    if (vData) {
        // ERROR 2: Robust array unwrap
        const voterList = Array.isArray(vData) ? vData : (vData.voters ?? vData.items ?? []);
        setVoters(voterList);
    }
  }

  async function toggleWindow() {
    if (!turnout) return;
    const data = await adminFetch('/admin/voting-window', {
      method: 'PUT',
      body: JSON.stringify({ open: !turnout.windowOpen })
    });
    if (data) fetchDashboard();
  }

  function downloadCSV(type: 'audit' | 'comelec') {
    const headers = type === 'audit' 
        ? ['#', 'Full Name', 'Student Number', 'Email', 'Choice', 'Timestamp']
        : ['#', 'Full Name', 'Student Number', 'Email', 'Timestamp'];

    const rows = voters.map((v, i) => {
        const selections = v.selections ? JSON.parse(v.selections) : {};
        const choice = selections['ratify-aoa']?.toUpperCase() || 'N/A';
        const date = new Date(v.timestamp).toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
        
        return type === 'audit'
            ? [i + 1, v.name, v.voterId, v.email, choice, date]
            : [i + 1, v.name, v.voterId, v.email, date];
    });

    const content = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([content], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AOA-Ratification-${type.toUpperCase()}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  }

  if (!adminToken) return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', padding: '1rem' }}>
      <form onSubmit={handleLogin} style={{ background: '#111118', padding: '2.5rem', borderRadius: '16px', width: '100%', maxWidth: '380px', border: '1px solid #222' }}>
        <h2 style={{ color: 'white', textAlign: 'center', marginBottom: '2rem' }}>COMELEC ADMIN</h2>
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', color: '#666', fontSize: '0.8rem', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Admin Email</label>
          <input 
            type="email" 
            value={email} 
            onChange={e => setEmail(e.target.value)} 
            placeholder="admin@ust.edu.ph"
            required
            style={{ width: '100%', padding: '0.8rem', background: '#0a0a0a', border: '1px solid #333', borderRadius: '8px', color: 'white', boxSizing: 'border-box' }}
          />
        </div>
        {error && <p style={{ color: '#e8001c', fontSize: '0.85rem', textAlign: 'center' }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: '100%', padding: '0.9rem', background: '#e8001c', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
          {loading ? 'Verifying...' : 'Login to Dashboard'}
        </button>
      </form>
    </div>
  );

  // ERROR 2: Guard for filter
  const filteredVoters = Array.isArray(voters) ? voters.filter(v => 
    v.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    v.voterId.includes(searchTerm)
  ) : [];

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto', color: 'white' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.8rem', color: '#f5c400' }}>COMELEC Dashboard</h1>
          <p style={{ color: '#444', margin: '0.2rem 0' }}>Real-time Ratification Monitor</p>
        </div>
        <div style={{ display: 'flex', background: '#111118', borderRadius: '8px', padding: '4px' }}>
          {(['Overview', 'Results', 'Voters', 'Export'] as Tab[]).map(t => (
            <button 
                key={t} 
                onClick={() => setTab(t)}
                style={{ padding: '0.6rem 1.2rem', background: tab === t ? '#222' : 'transparent', border: 'none', color: tab === t ? '#f5c400' : '#666', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
            >
                {t}
            </button>
          ))}
        </div>
      </header>

      {tab === 'Overview' && turnout && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '2rem' }}>
            <div style={{ background: '#111118', padding: '2.5rem', borderRadius: '16px', border: '1px solid #222' }}>
                <h3 style={{ color: '#666', fontSize: '0.9rem', textTransform: 'uppercase', marginBottom: '1.5rem' }}>Voter Turnout</h3>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
                    <span style={{ fontSize: '3.5rem', fontWeight: 'bold' }}>{turnout.totalVoted} <span style={{ fontSize: '1.2rem', color: '#333' }}>/ {turnout.totalEligible}</span></span>
                    <span style={{ fontSize: '2rem', color: '#00e868' }}>{((turnout.totalVoted / turnout.totalEligible) * 100).toFixed(1)}%</span>
                </div>
                <div style={{ height: '14px', background: '#0a0a0a', borderRadius: '7px', overflow: 'hidden' }}>
                    <div style={{ width: `${(turnout.totalVoted / turnout.totalEligible) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #00e868, #f5c400)', transition: 'width 1s' }} />
                </div>
            </div>

            <div style={{ background: '#111118', padding: '2rem', borderRadius: '16px', border: '1px solid #222', textAlign: 'center' }}>
                <h3 style={{ color: '#666', fontSize: '0.9rem', textTransform: 'uppercase', marginBottom: '2rem' }}>System Status</h3>
                <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: turnout.windowOpen ? '#00e868' : '#e8001c', marginBottom: '2rem' }}>
                    {turnout.windowOpen ? '● VOTING OPEN' : '○ VOTING CLOSED'}
                </div>
                <button 
                    onClick={toggleWindow}
                    style={{ width: '100%', padding: '1rem', background: turnout.windowOpen ? '#e8001c' : '#00e868', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                    {turnout.windowOpen ? 'CLOSE WINDOW NOW' : 'OPEN WINDOW NOW'}
                </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'Results' && results && (
          <div style={{ maxWidth: '700px', margin: '0 auto', background: '#111118', padding: '3rem', borderRadius: '20px', border: '1px solid #222' }}>
            <h2 style={{ textAlign: 'center', marginBottom: '3rem' }}>Live Tally</h2>
            
            {['yes', 'no'].map(choice => {
                const data = choice === 'yes' ? results.yes : results.no;
                const other = choice === 'yes' ? results.no : results.yes;
                const isLeading = data.count > other.count;
                return (
                    <div key={choice} style={{ marginBottom: '2.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                            <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: isLeading ? '#00e868' : 'white' }}>
                                {choice.toUpperCase()} {isLeading && '🏆'}
                            </span>
                            <span>{data.count} votes ({data.percentage.toFixed(1)}%)</span>
                        </div>
                        <div style={{ height: '40px', background: '#0a0a0a', borderRadius: '8px', overflow: 'hidden', border: '1px solid #222' }}>
                            <div style={{ width: `${data.percentage}%`, height: '100%', background: choice === 'yes' ? '#00e868' : '#e8001c', transition: 'width 1s' }} />
                        </div>
                    </div>
                )
            })}
            <div style={{ textAlign: 'center', color: '#444', marginTop: '2rem' }}>Total validated ballots: {results.total}</div>
          </div>
      )}

      {tab === 'Voters' && (
          <div style={{ background: '#111118', borderRadius: '16px', border: '1px solid #222', overflow: 'hidden' }}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid #222' }}>
                <input 
                    type="text" 
                    placeholder="Search by name or student number..." 
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{ width: '100%', padding: '0.8rem', background: '#0a0a0a', border: '1px solid #333', borderRadius: '8px', color: 'white' }}
                />
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                    <thead>
                        <tr style={{ textAlign: 'left', background: '#0a0a0a', color: '#666' }}>
                            <th style={{ padding: '1rem' }}>#</th>
                            <th style={{ padding: '1rem' }}>Full Name</th>
                            <th style={{ padding: '1rem' }}>Student Number</th>
                            <th style={{ padding: '1rem' }}>Email</th>
                            <th style={{ padding: '1rem' }}>Choice</th>
                            <th style={{ padding: '1rem' }}>Timestamp (PHT)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredVoters.map((v, i) => {
                            const sel = v.selections ? JSON.parse(v.selections) : {};
                            const choice = sel['ratify-aoa'];
                            return (
                                <tr key={v.voterId} style={{ borderBottom: '1px solid #1a1a1a' }}>
                                    <td style={{ padding: '1rem', color: '#333' }}>{i + 1}</td>
                                    <td style={{ padding: '1rem', fontWeight: 'bold' }}>{v.name}</td>
                                    <td style={{ padding: '1rem' }}>{v.voterId}</td>
                                    <td style={{ padding: '1rem', color: '#666' }}>{v.email}</td>
                                    <td style={{ padding: '1rem' }}>
                                        <span style={{ color: choice === 'yes' ? '#00e868' : '#e8001c', fontWeight: 'bold' }}>{choice?.toUpperCase()}</span>
                                    </td>
                                    <td style={{ padding: '1rem', fontSize: '0.8rem', color: '#444' }}>
                                        {new Date(v.timestamp).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
          </div>
      )}

      {tab === 'Export' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
            <div style={{ background: '#111118', padding: '2rem', borderRadius: '16px', border: '1px solid #222', textAlign: 'center' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📊</div>
                <h3>Full Audit CSV</h3>
                <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '2rem' }}>Contains all data including voter names and their individual choices. FOR INTERNAL USE ONLY.</p>
                <button onClick={() => downloadCSV('audit')} style={{ width: '100%', padding: '0.8rem', background: '#f5c400', color: 'black', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>Export Full Audit</button>
            </div>
            <div style={{ background: '#111118', padding: '2rem', borderRadius: '16px', border: '1px solid #222', textAlign: 'center' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🛡️</div>
                <h3>COMELEC CSV</h3>
                <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '2rem' }}>Contains participant names but REMOVES individual choices to preserve ballot secrecy.</p>
                <button onClick={() => downloadCSV('comelec')} style={{ width: '100%', padding: '0.8rem', background: '#white', color: 'black', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>Export COMELEC List</button>
            </div>
            <div style={{ background: '#111118', padding: '2rem', borderRadius: '16px', border: '1px solid #222', textAlign: 'center' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🗄️</div>
                <h3>Raw JSON</h3>
                <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '2rem' }}>Full raw database dump of the HasVotedTable for historical archive or recovery.</p>
                <button onClick={() => {
                    const blob = new Blob([JSON.stringify(voters, null, 2)], { type: 'application/json' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = `AOA-Raw-Data-${Date.now()}.json`; a.click();
                }} style={{ width: '100%', padding: '0.8rem', background: '#444', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>Export Raw JSON</button>
            </div>
          </div>
      )}
    </div>
  );
}
