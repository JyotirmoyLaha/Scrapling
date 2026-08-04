import React, { useMemo, useState } from 'react';
import { DiscoveryNodeMap } from './PremiumAddons';

const RESULTS_PER_PAGE = 10;

// Build the page buttons, collapsing long runs into ellipses so the bar stays one line.
// e.g. for page 7 of 14 -> [1, '...', 6, 7, 8, '...', 14]
function getPageNumbers(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) pages.push('start-ellipsis');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('end-ellipsis');

  pages.push(total);
  return pages;
}

export default function Discovery({ onSelectUrl }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');

  // State for inline previews: key is URL, value is { content: string, loading: boolean, format: string, error: string }
  const [previews, setPreviews] = useState({});
  const [hasSearched, setHasSearched] = useState(false);
  // How many DuckDuckGo pages the backend crawls per search. More depth = more results, more wait.
  const [depth, setDepth] = useState(5);
  const [currentPage, setCurrentPage] = useState(1);

  const handleSearch = async (e) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    setResults([]);
    setPreviews({});
    setHasSearched(false);
    setCurrentPage(1);

    try {
      const response = await fetch(
        `http://localhost:8000/api/search?q=${encodeURIComponent(query)}&pages=${depth}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch search results from web');
      }
      const data = await response.json();
      setResults(data);
      setHasSearched(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const goToPage = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const togglePreview = async (url) => {
    // If preview already exists, close/remove it
    if (previews[url]) {
      const copy = { ...previews };
      delete copy[url];
      setPreviews(copy);
      return;
    }

    // Set loading state for this specific URL
    setPreviews(prev => ({
      ...prev,
      [url]: { content: '', loading: true, format: 'markdown', error: '' }
    }));

    try {
      const response = await fetch('http://localhost:8000/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          fetcher_type: 'stealthy',
          extraction_type: 'markdown',
          save_to_library: false
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to fetch preview content');
      }

      const data = await response.json();
      setPreviews(prev => ({
        ...prev,
        [url]: { content: data.content, loading: false, format: 'markdown', error: '' }
      }));
    } catch (err) {
      setPreviews(prev => ({
        ...prev,
        [url]: { content: '', loading: false, format: 'markdown', error: err.message }
      }));
    }
  };

  const changePreviewFormat = async (url, format) => {
    setPreviews(prev => ({
      ...prev,
      [url]: { ...prev[url], loading: true, format: format, error: '' }
    }));

    try {
      const response = await fetch('http://localhost:8000/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          fetcher_type: 'stealthy',
          extraction_type: format,
          save_to_library: false
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to re-scrape');
      }

      const data = await response.json();
      setPreviews(prev => ({
        ...prev,
        [url]: { content: data.content, loading: false, format: format, error: '' }
      }));
    } catch (err) {
      setPreviews(prev => ({
        ...prev,
        [url]: { ...prev[url], loading: false, error: err.message }
      }));
    }
  };

  const getValidationState = () => {
    const trimmed = query.trim();
    if (!trimmed) {
      return { status: 'invalid', message: 'Query is empty.', color: 'var(--accent)' };
    }
    
    if (trimmed.length < 3) {
      return { status: 'invalid', message: 'Query is too short (needs at least 3 characters).', color: 'var(--accent)' };
    }
    
    // Simple regex to check if it looks like a URL (starts with http/s, or has a domain shape)
    const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i;
    if (urlPattern.test(trimmed)) {
      return { 
        status: 'warning', 
        message: 'This looks like a direct link (URL). For direct link scraping, please use the "Scraper Console" instead!', 
        color: 'var(--warning)' 
      };
    }
    
    return { status: 'valid', message: 'Query is valid. Ready to search!', color: 'var(--success)' };
  };

  const valState = getValidationState();

  // Results are fetched in full once, then paged locally so switching pages is instant.
  const totalPages = Math.max(1, Math.ceil(results.length / RESULTS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const firstIndex = (safePage - 1) * RESULTS_PER_PAGE;
  // Memoised so the slice keeps a stable identity between renders — DiscoveryNodeMap rebuilds its
  // canvas animation whenever the results array changes, and opening a preview must not restart it.
  const pageResults = useMemo(
    () => results.slice(firstIndex, firstIndex + RESULTS_PER_PAGE),
    [results, firstIndex]
  );

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Discovery Engine</h1>
          <p className="page-subtitle">Paste any data, queries, or news fragments to find relevant information and verified URLs across the web</p>
        </div>
        {hasSearched && (
          <button 
            className="btn btn-secondary" 
            onClick={() => handleSearch()} 
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
          >
            <svg 
              width="16" 
              height="16" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
              className={loading ? "spin-animation" : ""}
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            Refresh Results
          </button>
        )}
      </div>

      {/* Search Console */}
      <div className="glass-card" style={{ marginBottom: '2rem' }}>
        <form onSubmit={handleSearch}>
          <div className="form-group">
            <label>Search Query / Context snippet</label>
            <textarea
              rows="3"
              placeholder="Paste details, keywords, or news portions here to search the web... (e.g. Scrapling python library github)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHasSearched(false);
              }}
              style={{ width: '100%', resize: 'vertical', fontSize: '1rem', lineHeight: '1.4', marginBottom: '0.6rem' }}
              required
            />
            {/* Validation Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: '600', color: valState.color }}>
              <span style={{ 
                display: 'inline-block', 
                width: '10px', 
                height: '10px', 
                borderRadius: '50%', 
                backgroundColor: valState.color,
                boxShadow: `0 0 8px ${valState.color}`,
                transition: 'all 0.3s ease'
              }}></span>
              {valState.message}
            </div>
          </div>

          <div className="form-group">
            <label>Search Depth</label>
            <select
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              disabled={loading}
              style={{ width: '100%' }}
            >
              <option value={1}>Quick — 1 page (~10 results)</option>
              <option value={3}>Standard — 3 pages (~40 results)</option>
              <option value={5}>Deep — 5 pages (~70 results)</option>
              <option value={10}>Exhaustive — 10 pages (~145 results)</option>
              <option value={20}>Maximum — 20 pages (every result available)</option>
            </select>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
              Higher depth crawls further through the search index. Results are de-duplicated and
              browsed 10 at a time below.
            </div>
          </div>

          <button
            type="submit" 
            className="btn btn-primary btn-blue" 
            disabled={loading || valState.status === 'invalid'} 
            style={{ width: '100%' }}
          >
            {loading ? (
              <>
                <span className="loading-pulse"></span> Searching Web...
              </>
            ) : 'Find Verified URLs & Links'}
          </button>
        </form>
      </div>

      {error && (
        <div className="glass-card" style={{ borderLeft: '4px solid var(--error)', marginBottom: '2rem', padding: '1.2rem' }}>
          <h4 style={{ color: 'var(--error)', marginBottom: '0.4rem' }}>Search Failed</h4>
          <p style={{ fontSize: '0.95rem' }}>{error}</p>
        </div>
      )}

      {/* Results Section */}
      {loading && results.length === 0 ? (
        <div className="loading-container">
          <span className="loading-pulse"></span>
          <p>Querying search databases and resolving verified links...</p>
        </div>
      ) : results.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Verification Status Card - Green */}
          {hasSearched && (
            <div className="glass-card" style={{ 
              borderLeft: '4px solid var(--success)', 
              padding: '1.2rem 1.8rem', 
              background: 'rgba(16, 185, 129, 0.08)',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem'
            }}>
              <div style={{ 
                width: '12px', 
                height: '12px', 
                borderRadius: '50%', 
                backgroundColor: 'var(--success)',
                boxShadow: '0 0 10px var(--success)'
              }}></div>
              <div>
                <strong style={{ color: 'var(--success)', fontSize: '1.1rem' }}>VERIFIED: Phrase is Available on the Web</strong>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  We successfully found {results.length} active website(s) reference and publish this context
                  {totalPages > 1 && ` — shown across ${totalPages} pages`}.
                </p>
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <DiscoveryNodeMap query={query} results={pageResults} onSelectNode={(url) => togglePreview(url)} />
            </div>
          )}
          <div className="flex-between" style={{ flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <h3 style={{ color: 'var(--secondary)' }}>Verified Web Discoveries</h3>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Showing {firstIndex + 1}–{firstIndex + pageResults.length} of {results.length}
            </span>
          </div>
          {pageResults.map((res) => {
            const preview = previews[res.url];
            return (
              <div
                key={res.url}
                className="glass-card"
                style={{ 
                  padding: '1.5rem', 
                  borderLeft: '4px solid var(--secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.8rem'
                }}
              >
                <div>
                  <h4 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '0.2rem' }}>
                    <a 
                      href={res.url} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      style={{ color: 'var(--text-main)', textDecoration: 'none' }}
                      onMouseEnter={(e) => e.target.style.color = 'var(--primary)'}
                      onMouseLeave={(e) => e.target.style.color = 'var(--text-main)'}
                    >
                      {res.title}
                    </a>
                  </h4>
                  <div style={{ color: 'var(--success)', fontSize: '0.85rem', wordBreak: 'break-all', fontWeight: '500' }}>
                    {res.url}
                  </div>
                </div>

                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>{res.snippet}</p>

                <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                  <button 
                    className="btn btn-primary btn-red" 
                    onClick={() => onSelectUrl(res.url)} 
                    style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                  >
                    Open in Scraper Console
                  </button>
                  
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => togglePreview(res.url)} 
                    style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                  >
                    {preview ? 'Hide Preview' : 'Quick Preview'}
                  </button>
                  
                  <a 
                    href={res.url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="btn btn-secondary" 
                    style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', textDecoration: 'none' }}
                  >
                    Visit Link
                  </a>
                </div>

                {/* Inline Preview Container */}
                {preview && (
                  <div 
                    style={{ 
                      marginTop: '1rem', 
                      padding: '1rem', 
                      borderRadius: '8px', 
                      backgroundColor: 'rgba(5, 6, 8, 0.8)', 
                      border: '1px solid var(--card-border)' 
                    }}
                  >
                    <div className="flex-between" style={{ marginBottom: '0.8rem', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--primary)' }}>
                        INLINE PREVIEW (STEALTH FETCH)
                      </span>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button 
                          className="tab-btn" 
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', opacity: preview.format === 'markdown' ? 1 : 0.6 }} 
                          disabled={preview.loading}
                          onClick={() => changePreviewFormat(res.url, 'markdown')}
                        >
                          Markdown
                        </button>
                        <button 
                          className="tab-btn" 
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', opacity: preview.format === 'text' ? 1 : 0.6 }}
                          disabled={preview.loading}
                          onClick={() => changePreviewFormat(res.url, 'text')}
                        >
                          Plain Text
                        </button>
                        <button 
                          className="tab-btn" 
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', opacity: preview.format === 'html' ? 1 : 0.6 }}
                          disabled={preview.loading}
                          onClick={() => changePreviewFormat(res.url, 'html')}
                        >
                          Raw HTML
                        </button>
                      </div>
                    </div>

                    {preview.loading ? (
                      <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', padding: '1rem' }}>
                        <span className="loading-pulse"></span>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Bypassing WAF / Downloading page content...</span>
                      </div>
                    ) : preview.error ? (
                      <div style={{ color: 'var(--error)', padding: '0.5rem', fontSize: '0.9rem' }}>
                        Error: {preview.error}
                      </div>
                    ) : (
                      <pre style={{ maxHeight: '300px', fontSize: '0.8rem' }}>{preview.content}</pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {totalPages > 1 && (
            <div
              className="glass-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexWrap: 'wrap',
                gap: '0.4rem',
                padding: '1rem'
              }}
            >
              <button
                className="btn btn-secondary"
                style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}
                onClick={() => goToPage(safePage - 1)}
                disabled={safePage === 1}
              >
                ← Prev
              </button>

              {getPageNumbers(safePage, totalPages).map((page) =>
                typeof page === 'string' ? (
                  <span key={page} style={{ padding: '0 0.4rem', color: 'var(--text-muted)' }}>
                    …
                  </span>
                ) : (
                  <button
                    key={page}
                    className={page === safePage ? 'btn btn-primary btn-blue' : 'btn btn-secondary'}
                    style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem', minWidth: '2.4rem' }}
                    onClick={() => goToPage(page)}
                  >
                    {page}
                  </button>
                )
              )}

              <button
                className="btn btn-secondary"
                style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}
                onClick={() => goToPage(safePage + 1)}
                disabled={safePage === totalPages}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      ) : (
        hasSearched && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Verification Status Card - Red */}
            <div className="glass-card" style={{ 
              borderLeft: '4px solid var(--error)', 
              padding: '1.2rem 1.8rem', 
              background: 'rgba(239, 68, 68, 0.08)',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem'
            }}>
              <div style={{ 
                width: '12px', 
                height: '12px', 
                borderRadius: '50%', 
                backgroundColor: 'var(--error)',
                boxShadow: '0 0 10px var(--error)'
              }}></div>
              <div>
                <strong style={{ color: 'var(--error)', fontSize: '1.1rem' }}>UNVERIFIED: Phrase Not Found on the Web</strong>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  No active website references or articles containing this context were found on the public web.
                </p>
              </div>
            </div>
            
            <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
              <p style={{ color: 'var(--text-muted)' }}>No search results were found for your query. Try simplifying your search terms.</p>
            </div>
          </div>
        )
      )}
    </div>
  );
}
