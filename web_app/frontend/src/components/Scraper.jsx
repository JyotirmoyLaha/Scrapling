import React, { useState, useEffect } from 'react';
import { FingerprintVisualizer } from './PremiumAddons';

export default function Scraper({ defaultUrl, setDefaultUrl }) {
  const [url, setUrl] = useState(defaultUrl || '');
  const [fetcherType, setFetcherType] = useState('stealthy');
  const [extractionType, setExtractionType] = useState('markdown');
  const [selector, setSelector] = useState('');
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [googleSearch, setGoogleSearch] = useState(false);
  const [title, setTitle] = useState('');
  const [targetText, setTargetText] = useState('');
  
  const [result, setResult] = useState(null);
  const [screenshot, setScreenshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [activeResultTab, setActiveResultTab] = useState('content'); // 'content', 'screenshot', 'raw'
  const [error, setError] = useState('');

  useEffect(() => {
    if (defaultUrl) {
      setUrl(defaultUrl);
      if (setDefaultUrl) setDefaultUrl('');
    }
  }, [defaultUrl, setDefaultUrl]);

  const handleScrape = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch('http://localhost:8000/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          fetcher_type: fetcherType,
          extraction_type: extractionType,
          css_selector: selector || null,
          save_to_library: saveToLibrary,
          title: title || null,
          target_text: targetText || null,
          google_search: googleSearch,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to scrape webpage');
      }

      const data = await response.json();
      setResult(data);
      setActiveResultTab('content');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleScreenshot = async () => {
    if (!url) {
      setError('Please provide a URL first.');
      return;
    }
    setScreenshotLoading(true);
    setError('');
    setScreenshot(null);

    try {
      const response = await fetch('http://localhost:8000/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          session_type: fetcherType === 'static' ? 'dynamic' : fetcherType,
          target_text: targetText || null,
          google_search: googleSearch,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to capture screenshot');
      }

      const data = await response.json();
      setScreenshot(data.screenshot);
      setActiveResultTab('screenshot');
    } catch (err) {
      setError(err.message);
    } finally {
      setScreenshotLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Scraper Console</h1>
        <p className="page-subtitle">Fetch web pages using stealthy request and extraction engines</p>
      </div>

      <div className="form-row" style={{ alignItems: 'flex-start', gap: '2rem' }}>
        {/* Input Panel */}
        <div className="glass-card" style={{ flex: '1.2' }}>
          <form onSubmit={handleScrape}>
            <div className="form-group">
              <label>Target URL</label>
              <input
                type="url"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Fetcher Mode</label>
                <select value={fetcherType} onChange={(e) => setFetcherType(e.target.value)}>
                  <option value="stealthy">Stealthy (Bypasses WAF/Cloudflare)</option>
                  <option value="dynamic">Dynamic (Full Browser Load)</option>
                  <option value="static">Static (Fast HTTP Impersonation)</option>
                </select>
              </div>

              <div className="form-group">
                <label>Extraction Format</label>
                <select value={extractionType} onChange={(e) => setExtractionType(e.target.value)}>
                  <option value="markdown">Markdown</option>
                  <option value="text">Plain Text</option>
                  <option value="html">Raw HTML</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>CSS Selector (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. .quote, article, #content"
                  value={selector}
                  onChange={(e) => setSelector(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Scrape Custom Title (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. My Custom Research Subject"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Target Text / Keyword (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Find specific text block and screenshot its container element"
                value={targetText}
                onChange={(e) => setTargetText(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: '2rem', margin: '1rem 0', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.6rem' }}>
                <input
                  type="checkbox"
                  id="saveToLib"
                  checked={saveToLibrary}
                  onChange={(e) => setSaveToLibrary(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="saveToLib" style={{ cursor: 'pointer', textTransform: 'none', userSelect: 'none' }}>
                  Save to Research Library
                </label>
              </div>

              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.6rem' }}>
                <input
                  type="checkbox"
                  id="googleSearch"
                  checked={googleSearch}
                  onChange={(e) => setGoogleSearch(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="googleSearch" style={{ cursor: 'pointer', textTransform: 'none', userSelect: 'none' }}>
                  Spoof Google Referer (CF/WAF bypass)
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
              <button type="submit" className="btn btn-primary btn-red" disabled={loading || screenshotLoading} style={{ flex: '2' }}>
                {loading ? (
                  <>
                    <span className="loading-pulse"></span> Scraping...
                  </>
                ) : 'Scrape Content'}
              </button>
              
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={handleScreenshot} 
                disabled={loading || screenshotLoading}
                style={{ flex: '1' }}
              >
                {screenshotLoading ? (
                  <>
                    <span className="loading-pulse"></span> Loading...
                  </>
                ) : 'Capture Screenshot'}
              </button>
            </div>
          </form>
        </div>

        {/* Info/Guide Panel */}
        <div className="glass-card" style={{ flex: '0.8', alignSelf: 'stretch', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <FingerprintVisualizer mode={fetcherType} />
            <h3 style={{ margin: '1.2rem 0 1rem 0', color: 'var(--primary)' }}>Fetcher Quick Guide</h3>
            <ul style={{ listStyleType: 'none', display: 'flex', flexDirection: 'column', gap: '0.8rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              <li>
                <strong style={{ color: 'var(--text-main)' }}>Stealthy Mode:</strong> Uses a specialized headless Chromium instance spoofing Canvas, WebGL, and WebRTC fingerprints. Solves Cloudflare challenges automatically.
              </li>
              <li>
                <strong style={{ color: 'var(--text-main)' }}>Dynamic Mode:</strong> Excellent for pages requiring standard JavaScript execution or lazy loading images/tables.
              </li>
              <li>
                <strong style={{ color: 'var(--text-main)' }}>Static Mode:</strong> Fast requests using client TLS fingerprints to bypass lightweight blocking. Does not run JavaScript.
              </li>
            </ul>
          </div>
          
          <div style={{ marginTop: '2rem', padding: '1rem', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--card-border)' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              💡 <strong>Pro Tip:</strong> Enter a URL and click <em>Capture Screenshot</em> first to visually confirm if the pages are loading content correctly before setting up selectors.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="glass-card" style={{ borderLeft: '4px solid var(--error)', marginTop: '2rem', padding: '1.2rem' }}>
          <h4 style={{ color: 'var(--error)', marginBottom: '0.4rem' }}>Request Failed</h4>
          <p style={{ fontSize: '0.95rem' }}>{error}</p>
        </div>
      )}

      {/* Results Section */}
      {(result || screenshot) && (
        <div className="glass-card results-container">
          <div className="flex-between">
            <div className="results-tabs">
              {result && (
                <button 
                  className={`tab-btn ${activeResultTab === 'content' ? 'active' : ''}`}
                  onClick={() => setActiveResultTab('content')}
                >
                  Extracted Content
                </button>
              )}
              {result && (
                <button 
                  className={`tab-btn ${activeResultTab === 'summary' ? 'active' : ''}`}
                  onClick={() => setActiveResultTab('summary')}
                >
                  Brief Summary
                </button>
              )}
              {screenshot && (
                <button 
                  className={`tab-btn ${activeResultTab === 'screenshot' ? 'active' : ''}`}
                  onClick={() => setActiveResultTab('screenshot')}
                >
                  Live Screenshot
                </button>
              )}
              {result && (
                <button 
                  className={`tab-btn ${activeResultTab === 'raw' ? 'active' : ''}`}
                  onClick={() => setActiveResultTab('raw')}
                >
                  Raw Response
                </button>
              )}
            </div>

            {activeResultTab === 'content' && result && (
              <button className="copy-btn" onClick={() => copyToClipboard(result.content)}>
                Copy Content
              </button>
            )}
            {activeResultTab === 'summary' && result && (
              <button className="copy-btn" onClick={() => copyToClipboard(result.summary)}>
                Copy Summary
              </button>
            )}
          </div>

          <div style={{ marginTop: '0.5rem' }}>
            {activeResultTab === 'content' && result && (
              <div>
                <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>PAGE TITLE</span>
                    <p style={{ fontWeight: '600' }}>{result.title}</p>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>HTTP STATUS</span>
                    <p style={{ fontWeight: '600', color: result.status < 400 ? 'var(--success)' : 'var(--error)' }}>
                      {result.status}
                    </p>
                  </div>
                  {targetText && (
                    <div>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>PHRASE AVAILABILITY</span>
                      <p style={{ 
                        fontWeight: '700', 
                        color: (result.content && !result.content.includes("not found on the page")) ? 'var(--success)' : 'var(--error)' 
                      }}>
                        {(result.content && !result.content.includes("not found on the page")) ? '● AVAILABLE' : '● NOT AVAILABLE'}
                      </p>
                    </div>
                  )}
                  <div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>EXTRACTED URL</span>
                    <p style={{ fontWeight: '600', wordBreak: 'break-all' }}>{result.url}</p>
                  </div>
                </div>
                <pre>{result.content}</pre>
              </div>
            )}

            {activeResultTab === 'summary' && result && (
              <div>
                <h3 style={{ color: 'var(--primary)', marginBottom: '1rem' }}>Extract Summary Brief</h3>
                <pre style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: '1.05rem', fontFamily: 'inherit', color: 'var(--text-main)', background: 'rgba(9, 10, 14, 0.4)' }}>
                  {result.summary}
                </pre>
              </div>
            )}

            {activeResultTab === 'screenshot' && screenshot && (
              <div className="screenshot-container">
                <img src={screenshot} alt="Page Screenshot" className="screenshot-img" />
              </div>
            )}

            {activeResultTab === 'raw' && result && (
              <pre>{JSON.stringify(result, null, 2)}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
