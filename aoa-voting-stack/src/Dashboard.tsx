import { useState, useEffect } from 'react';
import { Amplify, Auth } from 'aws-amplify';
import { outputs } from '../amplify_outputs.json';

Amplify.configure(outputs);

const API_URL = outputs.apiEndpoint;
const TOTAL_ELIGIBLE_VOTERS = Number(process.env.TOTAL_ELIGIBLE_VOTERS || '200');

interface CognitoSession {
  idToken: {
    jwtToken: string;
    payload: {
      sub: string;
      email: string;
      'cognito:groups'?: string[];
    };
  };
}

interface StatusResponse {
  open: boolean;
  totalVotes: number;
}

interface ResultsResponse {
  yesCount: number;
  noCount: number;
  totalVotes: number;
}

export default function Dashboard() {
  const [email, setEmail] = useState<string>('');
  const [isComelec, setIsComelec] = useState(false);
  const [status, setStatus] = useState<StatusResponse>({ open: false, totalVotes: 0 });
  const [results, setResults] = useState<ResultsResponse>({ yesCount: 0, noCount: 0, totalVotes: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const session: CognitoSession = await Auth.currentSession();
        setEmail(session.idToken.payload.email);

        const groups = session.idToken.payload['cognito:groups'] || [];
        if (!groups.includes('comelec-admin')) {
          window.location.href = '/'; // Redirect if not in comelec-admin group
          return;
        }
        setIsComelec(true);

        // Initial fetch
        await fetchStatus();
        await fetchResults();

        // Poll status every 10 seconds
        const interval = setInterval(async () => {
          await fetchStatus();
        }, 10000);

        return () => clearInterval(interval);
      } catch (err) {
        console.error('Auth check failed:', err);
        window.location.href = '/';
      }
    })();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  const fetchResults = async () => {
    try {
      const session: CognitoSession = await Auth.currentSession();
      const token = session.idToken.jwtToken;

      const res = await fetch(`${API_URL}/results`, {
        headers: {
          'Authorization': token,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setResults(data);
      }
    } catch (err) {
      console.error('Failed to fetch results:', err);
    }
  };

  const toggleVotingWindow = async () => {
    try {
      const session: CognitoSession = await Auth.currentSession();
      const token = session.idToken.jwtToken;

      const newValue = !status.open;
      const response = await fetch(`${API_URL}/admin/toggle-window`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token,
        },
        body: JSON.stringify({ open: newValue }),
      });

      if (response.ok) {
        setStatus(prev => ({ ...prev, open: newValue }));
      } else {
        setError('Failed to update voting window');
      }
    } catch (err) {
      setError('Failed to update voting window');
    }
  };

  if (!isComelec) return <div>Checking access...</div>;

  const quorumPercent = Math.round((status.totalVotes / TOTAL_ELIGIBLE_VOTERS) * 100);
  const quorumReached = quorumPercent >= 67;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <div style={{ textAlign: 'right', marginBottom: '20px', color: '#666' }}>
        {email}
      </div>

      <h1>COMELEC Dashboard</h1>

      {/* Quorum Banner */}
      {quorumReached && (
        <div style={{
          backgroundColor: '#22c55e',
          color: 'white',
          textAlign: 'center',
          padding: '20px',
          borderRadius: '8px',
          marginBottom: '20px',
          fontSize: '2rem',
          fontWeight: 'bold',
        }}>
          Quorum Reached! ({quorumPercent}%)
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', marginBottom: '20px' }}>
        <div style={{ padding: '20px', backgroundColor: '#f3f4f6', borderRadius: '8px' }}>
          <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#1f2937' }}>
            {status.totalVotes}
          </div>
          <div style={{ color: '#6b7280' }}>Votes Cast</div>
        </div>
        <div style={{ padding: '20px', backgroundColor: '#f3f4f6', borderRadius: '8px' }}>
          <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#1f2937' }}>
            {quorumPercent}%
          </div>
          <div style={{ color: '#6b7280' }}>Quorum</div>
        </div>
      </div>

      {/* Vote Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        <div style={{ padding: '20px', backgroundColor: '#dcfce7', borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#22c55e' }}>{results.yesCount}</div>
          <div style={{ color: '#15803d' }}>YES Votes</div>
        </div>
        <div style={{ padding: '20px', backgroundColor: '#fee2e2', borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#ef4444' }}>{results.noCount}</div>
          <div style={{ color: '#991b1b' }}>NO Votes</div>
        </div>
      </div>

      {/* Total Eligible */}
      <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
        <div>Total Eligible Voters: <strong>{TOTAL_ELIGIBLE_VOTERS}</strong></div>
      </div>

      {/* Voting Window Toggle */}
      <div style={{ padding: '20px', backgroundColor: '#f3f4f6', borderRadius: '8px' }}>
        <div style={{ marginBottom: '15px' }}>
          <strong>Voting Window: </strong>
          <span style={{
            color: status.open ? '#22c55e' : '#ef4444',
            fontWeight: 'bold',
            fontSize: '1.2rem'
          }}>
            {status.open ? 'OPEN' : 'CLOSED'}
          </span>
        </div>
        <button
          onClick={toggleVotingWindow}
          style={{
            padding: '12px 24px',
            fontSize: '1rem',
            cursor: 'pointer',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
          }}
        >
          {status.open ? 'Close Voting' : 'Open Voting'}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: '20px',
          padding: '10px',
          backgroundColor: '#fee2e2',
          color: '#991b1b',
          borderRadius: '4px'
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
