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
  id: string;
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

  const handleSelect = (positionId: string, candidateId: string) => {
    setSelections(prev => ({
      ...prev,
      [positionId]: prev[positionId] === candidateId ? '' : candidateId
    }));
  };

  const isComplete = groups.every(g => selections[g.id || g.position]);

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
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', color: 'white' }}>
      <header style={{ textAlign: 'center', marginBottom: '4rem' }}>
        <h1 style={{ fontSize: '2rem', color: '#f5c400', marginBottom: '0.5rem' }}>AOA Ratification</h1>
        <p style={{ color: '#aaa' }}>Official Ballot • May 30, 2026</p>
        <div style={{ marginTop: '1.5rem', fontSize: '0.9rem', color: '#666' }}>
          {status.name} ({status.studentNumber})
        </div>
      </header>

      {groups.map(group => (
        <section key={group.id || group.position} style={{ marginBottom: '4rem' }}>
          <div style={{ background: '#111118', borderRadius: '16px', padding: '2rem', border: '1px solid #222' }}>
            <h2 style={{ fontSize: '1.4rem', textAlign: 'center', marginBottom: '2rem', color: '#f5c400' }}>
              {group.position}
            </h2>
            <p style={{ textAlign: 'center', color: '#888', marginBottom: '2.5rem', fontSize: '0.95rem', lineHeight: 1.6 }}>
              Do you ratify the Articles of Association (AOA) as presented in the General Assembly?
            </p>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {group.candidates.map(c => (
                <div 
                  key={c.id}
                  onClick={() => handleSelect(group.id || group.position, c.id)}
                  style={{
                    background: selections[group.id || group.position] === c.id ? (c.id === 'yes' ? 'rgba(0, 232, 104, 0.1)' : 'rgba(232, 0, 28, 0.1)') : '#0a0a0a',
                    borderRadius: '12px',
                    padding: '2rem',
                    cursor: 'pointer',
                    border: selections[group.id || group.position] === c.id 
                        ? `2px solid ${c.id === 'yes' ? '#00e868' : '#e8001c'}` 
                        : '1px solid #222',
                    textAlign: 'center',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>
                    {c.id === 'yes' ? '👍' : '👎'}
                  </div>
                  <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: selections[group.id || group.position] === c.id ? 'white' : '#aaa' }}>
                    {c.name.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}

      <div style={{ textAlign: 'center', marginTop: '2rem' }}>
        <button 
          disabled={!isComplete || submitting}
          onClick={() => setShowConfirm(true)}
          style={{
            background: isComplete ? '#e8001c' : '#333',
            color: 'white',
            border: 'none',
            padding: '1.2rem 4rem',
            borderRadius: '10px',
            fontSize: '1.2rem',
            fontWeight: 'bold',
            cursor: isComplete ? 'pointer' : 'not-allowed',
            transition: 'all 0.3s',
            width: '100%',
            maxWidth: '400px'
          }}
        >
          {isComplete ? 'SUBMIT MY VOTE' : 'Make a Selection'}
        </button>
      </div>

      {showConfirm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }}>
          <div style={{ background: '#1a1a2e', padding: '2.5rem', borderRadius: '20px', maxWidth: '450px', width: '100%', border: '1px solid #333', textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.5rem', color: '#f5c400' }}>Confirm Your Vote</h3>
            <p style={{ color: '#aaa', margin: '1.5rem 0', lineHeight: 1.6 }}>
              You are selecting: <strong style={{ color: 'white' }}>{selections['ratify-aoa']?.toUpperCase()}</strong><br/><br/>
              This action is final and your student number will be recorded as having participated.
            </p>
            <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1rem' }}>
              <button 
                onClick={() => setShowConfirm(false)}
                style={{ flex: 1, padding: '1rem', background: 'transparent', border: '1px solid #444', color: 'white', borderRadius: '8px', cursor: 'pointer' }}
              >
                Go Back
              </button>
              <button 
                onClick={handleSubmit}
                disabled={submitting}
                style={{ flex: 1, padding: '1rem', background: '#e8001c', border: 'none', color: 'white', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {submitting ? 'Submitting...' : 'Confirm Vote'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
