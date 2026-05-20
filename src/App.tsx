import { Authenticator } from '@aws-amplify/ui-react'
import { Amplify } from 'aws-amplify'
import '@aws-amplify/ui-react/styles.css'
import { useState } from 'react'
import VotingPage from './VotingPage'
import Dashboard from './Dashboard'
// @ts-ignore
import outputs from '../amplify_outputs.json'

Amplify.configure(outputs)

export default function App() {
  const [view, setView] = useState<'vote' | 'dashboard'>('vote')

  return (
    <Authenticator>
      {({ signOut, user }) => (
        <main>
          <nav style={{ padding: '1rem', background: '#1a1a2e', color: 'white', display: 'flex', justifyContent: 'space-between' }}>
            <span>CNAG-CICS AOA Voting System</span>
            <div>
              <button onClick={() => setView('vote')} style={{ marginRight: 8 }}>Vote</button>
              <button onClick={() => setView('dashboard')} style={{ marginRight: 8 }}>Dashboard</button>
              <button onClick={signOut}>Sign Out</button>
            </div>
          </nav>
          {view === 'vote' ? <VotingPage user={user} /> : <Dashboard user={user} />}
        </main>
      )}
    </Authenticator>
  )
}
