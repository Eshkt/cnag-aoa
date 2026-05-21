import { useState, useEffect } from 'react';
// @ts-ignore
import outputs from '../amplify_outputs.json';

const API_URL = outputs.custom.apiEndpoint.replace(/\/$/, '');

interface Turnout {
  totalVoted: number;
  totalEligible: number;
  isOpen: boolean;
}

interface ResultCandidate {
  name: string;
  votes: number;
}

type Results = Record<string, ResultCandidate[]>;

export default function AdminPage({ token }: { token: string | null }) {
  const [turnout, setTurnout] = useState<Turnout | null>(null);
  const [results, setResults] = useState<Results>({});
  const [loading, setLoading] = useState(true);
  const [updatingWindow, setUpdatingWindow] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Auto refresh 30s
    return () => clearInterval(interval);
  }, []);

  async function fetchData() {
    if (!token) return;
    try {
      const headers = { 'Authorization': `Bearer ${token}` };

      const [turnoutRes, resultsRes] = await Promise.all([
        fetch(`${API_URL}/admin/turnout`, { headers }),
        fetch(`${API_URL}/admin/results`, { headers })
      ]);

      setTurnout(await turnoutRes.json());
      setResults(await resultsRes.json());
    } catch (err) {
      console.error('Admin fetch error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function toggleWindow() {
    if (!turnout || !token) return;
    setUpdatingWindow(true);
    try {
      const res = await fetch(`${API_URL}/admin/voting-window`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ open: !turnout.isOpen })
      });

      if (res.ok) {
        setTurnout(prev => prev ? { ...prev, isOpen: !prev.isOpen } : null);
      }
    } catch (err) {
      alert('Failed to toggle window');
    } finally {
      setUpdatingWindow(false);
    }
  }

  async function exportCSV() {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/admin/voters`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const voters = await res.json();

      const headers = ['Student Number', 'Name', 'Email', 'Timestamp', 'Vote Hash'];
      const rows = voters.map((v: any) => [v.voterId, v.name, v.email, v.timestamp, v.voteHash]);
      
      const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `COMELEC_AUDIT_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      alert('Export failed');
    }
  }

  if (loading) return <div style={{ color: 'white', padding: '2rem' }}>Loading Admin Dashboard...</div>;

  const turnoutPercent = turnout ? (turnout.totalVoted / turnout.totalEligible) * 100 : 0;

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto', color: 'white' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.8rem' }}>COMELEC Dashboard</h1>
          <p style={{ color: '#666', margin: '0.2rem 0' }}>Live Monitoring & Controls</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={fetchData} style={{ padding: '0.6rem 1.2rem', background: '#222', border: '1px solid #333', color: 'white', borderRadius: '6px', cursor: 'pointer' }}>
            Refresh ↻
          </button>
          <button onClick={exportCSV} style={{ padding: '0.6rem 1.2rem', background: '#f5c400', color: 'black', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
            Export Audit CSV
          </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '2rem', marginBottom: '4rem' }}>
        {/* Turnout Card */}
        <div style={{ background: '#111118', padding: '2rem', borderRadius: '16px', border: '1px solid #222' }}>
          <h2 style={{ fontSize: '1rem', color: '#aaa', textTransform: 'uppercase', marginBottom: '1.5rem' }}>Voter Turnout</h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '2rem', fontWeight: 'bold' }}>{turnout?.totalVoted} <span style={{ fontSize: '1rem', color: '#444' }}>/ {turnout?.totalEligible}</span></span>
            <span style={{ fontSize: '1.5rem', color: '#f5c400' }}>{turnoutPercent.toFixed(1)}%</span>
          </div>
          <div style={{ width: '100%', height: '12px', background: '#0a0a0a', borderRadius: '6px', overflow: 'hidden' }}>
            <div style={{ width: `${turnoutPercent}%`, height: '100%', background: 'linear-gradient(90deg, #f5c400, #e8001c)', transition: 'width 1s ease-out' }} />
          </div>
        </div>

        {/* Controls Card */}
        <div style={{ background: '#111118', padding: '2rem', borderRadius: '16px', border: '1px solid #222', textAlign: 'center' }}>
          <h2 style={{ fontSize: '1rem', color: '#aaa', textTransform: 'uppercase', marginBottom: '1.5rem' }}>Voting Window</h2>
          <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: turnout?.isOpen ? '#00e868' : '#e8001c', marginBottom: '1rem' }}>
            {turnout?.isOpen ? '● OPEN' : '● CLOSED'}
          </div>
          <button 
            onClick={toggleWindow}
            disabled={updatingWindow}
            style={{ 
              width: '100%', 
              padding: '0.8rem', 
              background: turnout?.isOpen ? '#e8001c' : '#00e868', 
              color: 'white', 
              border: 'none', 
              borderRadius: '8px', 
              fontWeight: 'bold', 
              cursor: 'pointer' 
            }}
          >
            {updatingWindow ? 'Wait...' : turnout?.isOpen ? 'CLOSE VOTING' : 'OPEN VOTING'}
          </button>
        </div>
      </div>

      <section>
        <h2 style={{ marginBottom: '2rem', borderBottom: '1px solid #222', paddingBottom: '1rem' }}>Election Results</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(450px, 1fr))', gap: '2rem' }}>
          {Object.entries(results).map(([position, candidates]) => {
            const total = candidates.reduce((sum, c) => sum + c.votes, 0);
            
            return (
              <div key={position} style={{ background: '#111118', padding: '1.5rem', borderRadius: '12px', border: '1px solid #222' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '1.5rem', color: '#aaa' }}>{position}</h3>
                {candidates.map(c => {
                  const percent = total > 0 ? (c.votes / total) * 100 : 0;
                  return (
                    <div key={c.name} style={{ marginBottom: '1.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                        <span>{c.name === 'yes' ? 'YES' : c.name === 'no' ? 'NO' : c.name}</span>
                        <span>{c.votes} votes ({percent.toFixed(1)}%)</span>
                      </div>
                      <div style={{ width: '100%', height: '8px', background: '#0a0a0a', borderRadius: '4px' }}>
                        <div style={{ width: `${percent}%`, height: '100%', background: c.name === 'yes' ? '#00e868' : '#e8001c', borderRadius: '4px' }} />
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#444', textAlign: 'right' }}>
                  Total votes for position: {total}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
