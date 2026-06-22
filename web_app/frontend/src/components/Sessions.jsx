import React, { useState, useEffect } from 'react';
import { SessionCoreVisualizer } from './PremiumAddons';

export default function Sessions() {
  const [sessions, setSessions] = useState([]);
  const [sessionType, setSessionType] = useState('stealthy');
  const [headless, setHeadless] = useState(true);
  const [solveCloudflare, setSolveCloudflare] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [googleSearch, setGoogleSearch] = useState(false);

  // Selected Session Fetch state
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [fetchUrl, setFetchUrl] = useState('');
  const [fetchSelector, setFetchSelector] = useState('');
  const [fetchExtraction, setFetchExtraction] = useState('markdown');
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchResult, setFetchResult] = useState(null);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/sessions');
      if (!response.ok) throw new Error('Failed to load active sessions');
      const data = await response.json();
      setSessions(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenSession = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('http://localhost:8000/api/sessions/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_type: sessionType,
          headless: headless,
          solve_cloudflare: solveCloudflare,
          google_search: googleSearch,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to open browser session');
      }

      await fetchSessions();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCloseSession = async (sessionId) => {
    if (!confirm(`Are you sure you want to close session ${sessionId}?`)) return;

    try {
      const response = await fetch(`http://localhost:8000/api/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to close session');
      
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
        setFetchResult(null);
      }
      
      await fetchSessions();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSessionFetch = async (e) => {
    e.preventDefault();
    if (!selectedSessionId) return;

    setFetchLoading(true);
    setFetchError('');
    setFetchResult(null);

    try {
      const response = await fetch(`http://localhost:8000/api/sessions/${selectedSessionId}/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: fetchUrl,
          css_selector: fetchSelector || null,
          extraction_type: fetchExtraction,
          google_search: googleSearch,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to fetch using session');
      }

      const data = await response.json();
      setFetchResult(data);
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setFetchLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Persistent Sessions</h1>
        <p className="page-subtitle">Spin up and control persistent browser instances for multi-step scraping</p>
      </div>

      <div className="form-row" style={{ alignItems: 'flex-start', gap: '2rem' }}>
        {/* Create Session Control */}
        <div className="glass-card" style={{ flex: '1' }}>
          <h3 style={{ marginBottom: '1.2rem', color: 'var(--primary)' }}>Start Browser Instance</h3>
          
          <form onSubmit={handleOpenSession}>
            <div className="form-group">
              <label>Browser Session Type</label>
              <select value={sessionType} onChange={(e) => setSessionType(e.target.value)}>
                <option value="stealthy">Stealthy Browser (Anti-Fingerprint)</option>
                <option value="dynamic">Standard Dynamic Browser (Chromium)</option>
              </select>
            </div>

            <div className="form-group" style={{ flexDirection: 'row', gap: '1.2rem', margin: '1rem 0', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textTransform: 'none', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={headless}
                  onChange={(e) => setHeadless(e.target.checked)}
                  style={{ }}
                />
                Headless
              </label>

              {sessionType === 'stealthy' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textTransform: 'none', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={solveCloudflare}
                    onChange={(e) => setSolveCloudflare(e.target.checked)}
                    style={{ }}
                  />
                  Solve turnstile / CF
                </label>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textTransform: 'none', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={googleSearch}
                  onChange={(e) => setGoogleSearch(e.target.checked)}
                  style={{ }}
                />
                Spoof Google Referer
              </label>
            </div>

            <button type="submit" className="btn btn-primary btn-blue" style={{ width: '100%', marginTop: '1rem' }} disabled={loading}>
              {loading ? (
                <>
                  <span className="loading-pulse"></span> Starting Session...
                </>
              ) : 'Open Session'}
            </button>
          </form>

          {error && (
            <div style={{ color: 'var(--error)', marginTop: '1rem', fontSize: '0.9rem' }}>
              Error: {error}
            </div>
          )}
        </div>

        {/* Active Sessions List */}
        <div className="glass-card" style={{ flex: '1.5', alignSelf: 'stretch' }}>
          <h3 style={{ marginBottom: '1.2rem' }}>Active Browser Instances</h3>
          {sessions.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>No active browser sessions found. Start a new one on the left.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="session-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Created At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((sess) => (
                    <tr 
                      key={sess.session_id} 
                      style={{ 
                        cursor: 'pointer',
                        backgroundColor: selectedSessionId === sess.session_id ? 'rgba(255, 42, 95, 0.08)' : 'transparent'
                      }}
                      onClick={() => {
                        setSelectedSessionId(sess.session_id);
                        setFetchResult(null);
                        setFetchError('');
                      }}
                    >
                      <td>
                        <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--primary)' }}>
                          {sess.session_id}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <SessionCoreVisualizer active={selectedSessionId === sess.session_id} />
                          <span className={`status-badge active`}>
                            {sess.type}
                          </span>
                        </div>
                      </td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{sess.created_at}</td>
                      <td>
                        <button 
                          className="copy-btn" 
                          style={{ backgroundColor: 'var(--accent)', color: 'white', border: 'none' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCloseSession(sess.session_id);
                          }}
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Fetch Using Selected Session */}
      {selectedSessionId && (
        <div className="glass-card" style={{ marginTop: '2.5rem' }}>
          <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ color: 'var(--primary)' }}>
              Fetch Webpage using Session: <span style={{ fontFamily: 'monospace' }}>{selectedSessionId}</span>
            </h3>
            <button className="copy-btn" onClick={() => setSelectedSessionId(null)}>Deselect</button>
          </div>

          <form onSubmit={handleSessionFetch} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div className="form-group">
              <label>Target URL</label>
              <input
                type="url"
                placeholder="https://example.com/some-protected-resource"
                value={fetchUrl}
                onChange={(e) => setFetchUrl(e.target.value)}
                required
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>CSS Selector (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. .article-body, #data-table"
                  value={fetchSelector}
                  onChange={(e) => setFetchSelector(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Extraction Format</label>
                <select value={fetchExtraction} onChange={(e) => setFetchExtraction(e.target.value)}>
                  <option value="markdown">Markdown</option>
                  <option value="text">Plain Text</option>
                  <option value="html">Raw HTML</option>
                </select>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-blue" disabled={fetchLoading} style={{ alignSelf: 'flex-start' }}>
              {fetchLoading ? (
                <>
                  <span className="loading-pulse"></span> Fetching...
                </>
              ) : 'Fetch via Browser'}
            </button>
          </form>

          {fetchError && (
            <div style={{ color: 'var(--error)', marginTop: '1.2rem', padding: '1rem', border: '1px solid var(--error)', borderRadius: '6px' }}>
              <strong>Fetch Failed:</strong> {fetchError}
            </div>
          )}

          {fetchResult && (
            <div className="results-container" style={{ marginTop: '2rem' }}>
              <div className="flex-between">
                <h4 style={{ color: 'var(--text-main)' }}>Results for {fetchResult.title}</h4>
                <button className="copy-btn" onClick={() => navigator.clipboard.writeText(fetchResult.content)}>
                  Copy Content
                </button>
              </div>
              <pre>{fetchResult.content}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
