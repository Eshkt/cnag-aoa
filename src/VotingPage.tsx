import { useState, useEffect } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
// @ts-ignore
import outputs from '../amplify_outputs.json';

const API_URL = outputs.custom.apiEndpoint.replace(/\/$/, '');

interface Candidate {
  id: string;
  name: string;
  party: string;
  photo: string;
}

interface PositionGroup {
  position: string;
  candidates: Candidate[];
}

export default function VotingPage({ user }: { user: any }) {
  const [groups, setGroups] = useState<PositionGroup[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ isOpen: boolean, hasVoted: boolean, name: string, studentNumber: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setLoadingSubmit] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [votedSuccess, setVotedSuccess] = useState(false);

  useEffect(() => {
    fetchInitialData();
  }, []);

  async function fetchInitialData() {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();

      const [statusRes, candidatesRes] = await Promise.all([
        fetch(`${API_URL}/vote-status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_URL}/candidates`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const statusData = await statusRes.json();
      const candidatesData = await candidatesRes.json();

      setStatus(statusData);
      setGroups(candidatesData);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleSelect = (position: string, candidateId: string) => {
    setSelections(prev => ({
      ...prev,
      [position]: prev[position] === candidateId ? '' : candidateId
    }));
  };

  const isComplete = groups.every(g => selections[g.position]);

  async function handleSubmit() {
    setLoadingSubmit(true);
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();

      const res = await fetch(`${API_URL}/submit-vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ selections })
      });

      if (res.ok) {
        setVotedSuccess(true);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to submit vote');
      }
    } catch (err) {
      alert('Error connecting to server');
    } finally {
      setLoadingSubmit(false);
      setShowConfirm(false);
    }
  }

  if (loading) return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f5c400' }}>
      Loading voting system...
    </div>
  );

  if (votedSuccess || status?.hasVoted) return (
    <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'white' }}>
      <div style={{ background: '#111118', padding: '3rem', borderRadius: '16px', maxWidth: '500px', margin: '0 auto', border: '1px solid #222' }}>
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>✅</div>
        <h2 style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>Thank you, {status?.name}!</h2>
        <p style={{ color: '#aaa' }}>Your vote has been securely recorded for the AOA Ratification.</p>
        <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '2rem' }}>Student Number: {status?.studentNumber}</p>
      </div>
    </div>
  );

  if (!status?.isOpen) return (
    <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'white' }}>
       <div style={{ background: '#111118', padding: '3rem', borderRadius: '16px', maxWidth: '500px', margin: '0 auto', border: '1px solid #e8001c' }}>
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🔒</div>
        <h2 style={{ fontSize: '1.5rem', color: '#e8001c' }}>Voting is Currently Closed</h2>
        <p style={{ color: '#aaa', marginTop: '1rem' }}>Please wait for COMELEC to open the voting window during the General Assembly.</p>
      </div>
    </div>
  );

  return (
    <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto', color: 'white' }}>
      <header style={{ marginBottom: '3rem', borderBottom: '1px solid #222', paddingBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.6rem', color: '#f5c400' }}>Official Ballot</h1>
        <p style={{ color: '#666', margin: '0.5rem 0' }}>{status.name} • {status.studentNumber}</p>
      </header>

      {groups.map(group => (
        <section key={group.position} style={{ marginBottom: '4rem' }}>
          <h2 style={{ fontSize: '1.2rem', textTransform: 'uppercase', letterSpacing: '2px', color: '#aaa', marginBottom: '1.5rem' }}>
            {group.position}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1.5rem' }}>
            {group.candidates.map(c => (
              <div 
                key={c.id}
                onClick={() => handleSelect(group.position, c.id)}
                style={{
                  background: '#111118',
                  borderRadius: '12px',
                  padding: '1.5rem',
                  cursor: 'pointer',
                  border: selections[group.position] === c.id ? '2px solid #f5c400' : '1px solid #222',
                  transition: 'all 0.2s',
                  position: 'relative'
                }}
              >
                {selections[group.position] === c.id && (
                  <div style={{ position: 'absolute', top: 10, right: 10, background: '#f5c400', color: 'black', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
                    ✓
                  </div>
                )}
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <img src={c.photo} alt={c.name} style={{ width: 60, height: 60, borderRadius: '50%', background: '#333' }} />
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{c.name}</div>
                    <div style={{ fontSize: '0.85rem', color: '#666' }}>{c.party}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <div style={{ position: 'sticky', bottom: '2rem', background: 'rgba(10,10,10,0.8)', backdropFilter: 'blur(8px)', padding: '1.5rem', borderRadius: '16px', border: '1px solid #333', textAlign: 'center', boxShadow: '0 -10px 40px rgba(0,0,0,0.5)' }}>
        <button 
          disabled={!isComplete}
          onClick={() => setShowConfirm(true)}
          style={{
            background: isComplete ? '#e8001c' : '#333',
            color: 'white',
            border: 'none',
            padding: '1rem 3rem',
            borderRadius: '8px',
            fontSize: '1.1rem',
            fontWeight: 'bold',
            cursor: isComplete ? 'pointer' : 'not-allowed',
            transition: 'all 0.3s'
          }}
        >
          {isComplete ? 'SUBMIT VOTE →' : 'Complete All Selections'}
        </button>
      </div>

      {showConfirm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }}>
          <div style={{ background: '#1a1a2e', padding: '2rem', borderRadius: '16px', maxWidth: '400px', width: '100%', border: '1px solid #333' }}>
            <h3>Final Confirmation</h3>
            <p style={{ color: '#aaa', lineHeight: 1.5 }}>You are about to submit your votes. This action is final and cannot be reversed.</p>
            <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
              <button 
                onClick={() => setShowConfirm(false)}
                style={{ flex: 1, padding: '0.8rem', background: 'transparent', border: '1px solid #444', color: 'white', borderRadius: '8px', cursor: 'pointer' }}
              >
                Back
              </button>
              <button 
                onClick={handleSubmit}
                disabled={submitting}
                style={{ flex: 1, padding: '0.8rem', background: '#e8001c', border: 'none', color: 'white', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {submitting ? 'Submitting...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
