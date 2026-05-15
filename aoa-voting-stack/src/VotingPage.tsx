import { useState, useEffect } from 'react';
import { Amplify, Auth } from 'aws-amplify';
import { outputs } from '../amplify_outputs.json';

Amplify.configure(outputs);

const API_URL = outputs.apiEndpoint;

interface CognitoSession {
  idToken: {
    jwtToken: string;
    payload: {
      sub: string;
      email: string;
    };
  };
}

export default function VotingPage() {
  const [email, setEmail] = useState<string>('');
  const [status, setStatus] = useState<'loading' | 'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');
  const [errorType, setErrorType] = useState<'none' | 'closed' | 'already' | 'network'>('none');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const session: CognitoSession = await Auth.currentSession();
        setEmail(session.idToken.payload.email);
      } catch {
        window.location.href = '/'; // Redirect to login
      }
    })();
  }, []);

  const handleSubmit = async (choice: 'YES' | 'NO') => {
    if (status === 'submitting') return;

    setStatus('submitting');
    setMessage('');
    setErrorType('none');

    try {
      const session: CognitoSession = await Auth.currentSession();
      const token = session.idToken.jwtToken;

      const response = await fetch(`${API_URL}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token,
        },
        body: JSON.stringify({ proposalId: 'aoa-2024', voteChoice: choice }),
      });

      if (response.ok) {
        setStatus('success');
        setMessage('Vote recorded. Thank you.');
      } else if (response.status === 409) {
        setStatus('error');
        setErrorType('already');
        setMessage('Your vote was already received.');
      } else if (response.status === 403) {
        setStatus('error');
        setErrorType('closed');
        setMessage('Voting is currently closed.');
      } else {
        throw new Error('Unexpected response');
      }
    } catch (err: any) {
      if (retryCount < 1) {
        setRetryCount(retryCount + 1);
        setMessage('Connection problem. Do not click again. Contact COMELEC.');
        setErrorType('network');
      } else {
        setMessage('Connection problem. Contact COMELEC.');
        setErrorType('network');
        setStatus('error');
      }
    }
  };

  const handleRetry = () => {
    setRetryCount(0);
    setStatus('idle');
    setErrorType('none');
    setMessage('');
  };

  if (!email) return <div>Loading...</div>;

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
      <div style={{ textAlign: 'right', marginBottom: '20px', color: '#666' }}>
        {email}
      </div>

      <h1 style={{ textAlign: 'center' }}>
        Do you approve the CNAG-CICS Articles of Association?
      </h1>

      {status === 'submitting' && (
        <div style={{ textAlign: 'center', margin: '40px 0' }}>
          <div style={{ fontSize: '3rem', marginBottom: '10px' }}>⏳</div>
          <p>Submitting your vote...</p>
        </div>
      )}

      {status === 'success' && (
        <div style={{ textAlign: 'center', margin: '40px 0' }}>
          <div style={{ fontSize: '5rem', color: '#22c55e', marginBottom: '20px' }}>✓</div>
          <h2>{message}</h2>
        </div>
      )}

      {(status === 'error' && errorType === 'closed') && (
        <div style={{ textAlign: 'center', margin: '40px 0' }}>
          <h2 style={{ color: '#f97316' }}>{message}</h2>
        </div>
      )}

      {(status === 'error' && errorType === 'already') && (
        <div style={{ textAlign: 'center', margin: '40px 0' }}>
          <h2 style={{ color: '#f97316' }}>{message}</h2>
        </div>
      )}

      {(status === 'error' && errorType === 'network') && (
        <div style={{ textAlign: 'center', margin: '40px 0' }}>
          <h2 style={{ color: '#ef4444' }}>{message}</h2>
          <button
            onClick={handleRetry}
            style={{
              marginTop: '20px',
              padding: '12px 24px',
              fontSize: '1rem',
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      )}

      {(status === 'idle' || status === 'submitting') && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '40px' }}>
          <button
            onClick={() => handleSubmit('YES')}
            disabled={status === 'submitting'}
            style={{
              padding: '20px 40px',
              fontSize: '1.5rem',
              fontWeight: 'bold',
              cursor: status === 'submitting' ? 'not-allowed' : 'pointer',
              backgroundColor: '#22c55e',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
            }}
          >
            YES
          </button>
          <button
            onClick={() => handleSubmit('NO')}
            disabled={status === 'submitting'}
            style={{
              padding: '20px 40px',
              fontSize: '1.5rem',
              fontWeight: 'bold',
              cursor: status === 'submitting' ? 'not-allowed' : 'pointer',
              backgroundColor: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
            }}
          >
            NO
          </button>
        </div>
      )}
    </div>
  );
}
