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
  const [navigatorTab, setNavigatorTab] = useState('links');
  const [linkSearch, setLinkSearch] = useState('');
  const [historyStack, setHistoryStack] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

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

  const handleSessionFetch = async (e, urlOverride = null, isHistoryNav = false) => {
    if (e) e.preventDefault();
    if (!selectedSessionId) return;

    const targetUrl = urlOverride || fetchUrl;
    if (!targetUrl) return;

    setFetchLoading(true);
    setFetchError('');
    setFetchResult(null);

    try {
      const response = await fetch(`http://localhost:8000/api/sessions/${selectedSessionId}/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
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
      setLinkSearch('');
      setFetchUrl(data.url);

      if (!isHistoryNav) {
        setHistoryStack((prev) => {
          const nextIndex = historyIndex + 1;
          const newStack = prev.slice(0, nextIndex);
          newStack.push(data.url);
          setHistoryIndex(nextIndex);
          return newStack;
        });
      }
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setFetchLoading(false);
    }
  };

  const handleNavigateToUrl = (url) => {
    setFetchUrl(url);
    handleSessionFetch(null, url, false);
  };

  const handleGoBack = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      handleSessionFetch(null, historyStack[prevIndex], true);
    }
  };

  const handleGoForward = () => {
    if (historyIndex < historyStack.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      handleSessionFetch(null, historyStack[nextIndex], true);
    }
  };

  const handleRefresh = () => {
    if (historyIndex >= 0 && historyStack[historyIndex]) {
      handleSessionFetch(null, historyStack[historyIndex], true);
    } else if (fetchUrl) {
      handleSessionFetch(null, fetchUrl, false);
    }
  };

  const handleGlobalRefresh = async () => {
    await fetchSessions();
    if (selectedSessionId) {
      if (historyIndex >= 0 && historyStack[historyIndex]) {
        handleSessionFetch(null, historyStack[historyIndex], true);
      } else if (fetchUrl) {
        handleSessionFetch(null, fetchUrl, false);
      }
    }
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Persistent Sessions</h1>
          <p className="page-subtitle">Spin up and control persistent browser instances for multi-step scraping</p>
        </div>
        <button 
          onClick={handleGlobalRefresh}
          className="btn btn-secondary"
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem', 
            padding: '0.6rem 1.2rem',
            borderRadius: '8px',
            fontSize: '0.9rem',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--card-border)',
            color: 'var(--text-main)',
            cursor: 'pointer'
          }}
          title="Refresh Active Sessions & Fetched Content"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
          Refresh All
        </button>
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
                        setHistoryStack([]);
                        setHistoryIndex(-1);
                        setFetchUrl('');
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

          <form onSubmit={handleSessionFetch} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="form-group">
              <label>Target URL & Browser Controls</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', width: '100%', marginTop: '0.2rem' }}>
                {/* Navigation Controls Group */}
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.2rem', 
                  background: 'rgba(9, 10, 14, 0.6)', 
                  border: '1px solid var(--card-border)', 
                  borderRadius: '10px', 
                  padding: '0.3rem',
                  height: '48px',
                  boxSizing: 'border-box'
                }}>
                  {/* Back button */}
                  <button 
                    type="button" 
                    onClick={handleGoBack}
                    disabled={historyIndex <= 0 || fetchLoading}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: historyIndex > 0 ? 'var(--text-main)' : 'var(--text-muted)',
                      cursor: historyIndex > 0 ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '34px',
                      height: '34px',
                      borderRadius: '8px',
                      transition: 'all 0.2s',
                    }}
                    className={historyIndex > 0 ? 'nav-control-btn' : ''}
                    title="Back"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="19" y1="12" x2="5" y2="12"></line>
                      <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                  </button>
                  {/* Forward button */}
                  <button 
                    type="button" 
                    onClick={handleGoForward}
                    disabled={historyIndex >= historyStack.length - 1 || fetchLoading}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: historyIndex < historyStack.length - 1 ? 'var(--text-main)' : 'var(--text-muted)',
                      cursor: historyIndex < historyStack.length - 1 ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '34px',
                      height: '34px',
                      borderRadius: '8px',
                      transition: 'all 0.2s',
                    }}
                    className={historyIndex < historyStack.length - 1 ? 'nav-control-btn' : ''}
                    title="Forward"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                      <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                  </button>
                  {/* Refresh button */}
                  <button 
                    type="button" 
                    onClick={handleRefresh}
                    disabled={!fetchUrl || fetchLoading}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: fetchUrl ? 'var(--text-main)' : 'var(--text-muted)',
                      cursor: fetchUrl ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '34px',
                      height: '34px',
                      borderRadius: '8px',
                      transition: 'all 0.2s',
                    }}
                    className={fetchUrl ? 'nav-control-btn' : ''}
                    title="Refresh Page & All Sections"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10"></polyline>
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                    </svg>
                  </button>
                </div>

                {/* Target URL Input */}
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    type="url"
                    placeholder="https://example.com/some-protected-resource"
                    value={fetchUrl}
                    onChange={(e) => setFetchUrl(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      height: '48px',
                      margin: 0,
                      padding: '0 1.2rem',
                    }}
                  />
                </div>

                {/* Submit/Fetch Button */}
                <button 
                  type="submit" 
                  className="btn btn-primary btn-blue" 
                  disabled={fetchLoading || !fetchUrl} 
                  style={{ height: '48px', padding: '0 1.5rem', margin: 0, whiteSpace: 'nowrap' }}
                >
                  {fetchLoading ? (
                    <>
                      <span className="loading-pulse"></span> Fetching...
                    </>
                  ) : 'Fetch URL'}
                </button>
              </div>
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
          </form>

          {fetchError && (
            <div style={{ color: 'var(--error)', marginTop: '1.2rem', padding: '1rem', border: '1px solid var(--error)', borderRadius: '6px' }}>
              <strong>Fetch Failed:</strong> {fetchError}
            </div>
          )}

          {fetchResult && (
            <div className="results-container" style={{ marginTop: '2rem' }}>
              <div className="flex-between" style={{ borderBottom: '1px solid var(--card-border)', paddingBottom: '0.8rem', marginBottom: '1.5rem' }}>
                <div>
                  <h4 style={{ color: 'var(--text-main)', fontSize: '1.2rem', fontWeight: '600' }}>
                    🔗 Session View: {fetchResult.title || 'Scraped Page'}
                  </h4>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem', wordBreak: 'break-all' }}>
                    Current URL: <strong>{fetchResult.url}</strong>
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.8rem' }}>
                  <button className="copy-btn" onClick={() => navigator.clipboard.writeText(fetchResult.content)} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
                    Copy Content
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '2rem', flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {/* Text Content Area */}
                <div style={{ flex: '1.4', minWidth: '350px' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--secondary)', letterSpacing: '0.5px' }}>EXTRACTED CONTENT</span>
                  <pre style={{ maxHeight: '550px', overflowY: 'auto', background: 'rgba(5, 6, 8, 0.4)', padding: '1.2rem', borderRadius: '8px', border: '1px solid var(--card-border)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
                    {fetchResult.content}
                  </pre>
                </div>

                {/* Interactive Site Navigator Panel */}
                <div className="glass-card" style={{ flex: '1', minWidth: '300px', padding: '1.2rem', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--card-border)', borderRadius: '12px' }}>
                  <div style={{ borderBottom: '1px solid var(--card-border)', paddingBottom: '0.8rem', marginBottom: '1rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--primary)', letterSpacing: '0.5px' }}>⚡ SESSION SITE NAVIGATOR</span>
                    <h4 style={{ fontSize: '0.95rem', color: 'var(--text-main)', marginTop: '0.2rem' }}>Browse the session interactively</h4>
                  </div>

                  {/* Tabs for Links and Sections */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <button 
                      type="button"
                      className={`tab-btn ${navigatorTab === 'links' ? 'active' : ''}`}
                      onClick={() => setNavigatorTab('links')}
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', border: 'none', background: navigatorTab === 'links' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      Detected Links ({fetchResult.links?.length || 0})
                    </button>
                    <button 
                      type="button"
                      className={`tab-btn ${navigatorTab === 'sections' ? 'active' : ''}`}
                      onClick={() => setNavigatorTab('sections')}
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', border: 'none', background: navigatorTab === 'sections' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      Document Outline ({fetchResult.sections?.length || 0})
                    </button>
                  </div>

                  {navigatorTab === 'links' && (
                    <div>
                      {/* Search box for filtering links */}
                      <input
                        type="text"
                        placeholder="Search detected links..."
                        value={linkSearch}
                        onChange={(e) => setLinkSearch(e.target.value)}
                        style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--card-border)', borderRadius: '6px', color: '#fff', padding: '0.5rem 0.8rem', fontSize: '0.85rem', marginBottom: '0.8rem', outline: 'none' }}
                      />

                      <div style={{ maxHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.6rem', paddingRight: '4px' }}>
                        {!fetchResult.links || fetchResult.links.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>No links detected on this page.</p>
                        ) : (
                          fetchResult.links
                            .filter(l => l.text.toLowerCase().includes(linkSearch.toLowerCase()) || l.url.toLowerCase().includes(linkSearch.toLowerCase()))
                            .map((link, idx) => (
                              <div key={idx} style={{ 
                                display: 'flex', 
                                flexDirection: 'column', 
                                gap: '0.4rem', 
                                padding: '0.75rem', 
                                background: 'rgba(255, 42, 95, 0.02)', 
                                border: '1px solid rgba(255, 42, 95, 0.1)', 
                                borderRadius: '8px',
                                transition: 'all 0.2s',
                                cursor: 'pointer'
                              }}
                              className="hover-card-highlight"
                              onClick={() => handleNavigateToUrl(link.url)}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                                  <span style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-main)', wordBreak: 'break-word' }}>
                                    {link.text}
                                  </span>
                                  <span style={{ fontSize: '0.7rem', background: 'rgba(0, 180, 252, 0.1)', color: 'var(--secondary)', padding: '0.15rem 0.4rem', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                                    Navigate →
                                  </span>
                                </div>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', wordBreak: 'break-all', opacity: 0.8 }}>
                                  {link.url}
                                </span>
                              </div>
                            ))
                        )}
                      </div>
                    </div>
                  )}

                  {navigatorTab === 'sections' && (
                    <div style={{ maxHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {!fetchResult.sections || fetchResult.sections.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>No sections/headers detected.</p>
                      ) : (
                        fetchResult.sections.map((sect, idx) => (
                          <div key={idx} style={{ 
                            padding: '0.6rem 0.8rem', 
                            background: 'rgba(255,255,255,0.01)', 
                            borderLeft: `3px solid ${sect.tag === 'H1' ? 'var(--primary)' : sect.tag === 'H2' ? 'var(--secondary)' : 'var(--success)'}`,
                            borderRadius: '0 6px 6px 0',
                            marginLeft: sect.tag === 'H1' ? '0' : sect.tag === 'H2' ? '0.8rem' : '1.6rem'
                          }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'var(--text-muted)', marginRight: '0.5rem' }}>{sect.tag}</span>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{sect.text}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
