import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../api';

const DEFAULT_CFG = {
  name: '',
  start_urls: '',
  mode: 'static',
  extraction_type: 'markdown',
  max_depth: 1,
  max_items: 50,
  concurrent_requests: 4,
  download_delay: 0,
  page_timeout: 45,
  block_trackers: true,
  css_selector: '',
  restrict_css: '',
  allow_patterns: '',
  deny_patterns: '',
  allowed_domains: '',
  max_content_chars: 20000,
  follow_links: true,
  robots_txt_obey: true,
  headless: true,
  solve_cloudflare: false,
  // On by default, matching Scrapling's own default: many sites reject requests
  // that arrive with no referer at all.
  google_search: true,
  resumable: false,
};

const TERMINAL = ['completed', 'failed', 'stopped', 'paused'];
const LIVE_FEED_CAP = 200;

const splitList = (value) =>
  value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

const splitLines = (value) =>
  value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

function toPayload(cfg) {
  return {
    name: cfg.name.trim() || 'Untitled Crawl',
    start_urls: splitLines(cfg.start_urls),
    mode: cfg.mode,
    extraction_type: cfg.extraction_type,
    max_depth: Number(cfg.max_depth),
    max_items: Number(cfg.max_items),
    concurrent_requests: Number(cfg.concurrent_requests),
    download_delay: Number(cfg.download_delay),
    page_timeout: Number(cfg.page_timeout),
    block_trackers: cfg.block_trackers,
    css_selector: cfg.css_selector.trim() || null,
    restrict_css: splitList(cfg.restrict_css),
    allow_patterns: splitList(cfg.allow_patterns),
    deny_patterns: splitList(cfg.deny_patterns),
    allowed_domains: splitList(cfg.allowed_domains),
    max_content_chars: Number(cfg.max_content_chars),
    follow_links: cfg.follow_links,
    robots_txt_obey: cfg.robots_txt_obey,
    headless: cfg.headless,
    solve_cloudflare: cfg.solve_cloudflare,
    google_search: cfg.google_search,
    resumable: cfg.resumable,
  };
}

// FastAPI 422 bodies are {detail: [{loc, msg}, ...]}; anything else is a plain string.
function describeError(body, fallback) {
  const detail = body?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => `${(d.loc || []).slice(1).join('.') || 'input'}: ${d.msg}`)
      .join('; ');
  }
  return fallback;
}

const fmtBytes = (n) => {
  if (!n) return '0';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
};

const fmtDuration = (secs) => {
  const s = Math.max(0, Math.round(secs || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
};

function StatTile({ label, value, tone }) {
  return (
    <div className="crawl-stat">
      <div className="v" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="k">{label}</div>
    </div>
  );
}

export default function Crawler({ seedUrls, onOpenInScraper }) {
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [appliedSeeds, setAppliedSeeds] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [stats, setStats] = useState({});
  const [liveItems, setLiveItems] = useState([]);
  const [failures, setFailures] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [expandedContent, setExpandedContent] = useState('');
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const esRef = useRef(null);

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setCfg((c) => ({ ...c, [key]: value }));
  };

  const refreshJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/crawl?limit=50`);
      if (!res.ok) throw new Error('Failed to load crawl jobs');
      setJobs(await res.json());
    } catch (err) {
      console.error(err);
    }
  }, []);

  // Poll the job list so statuses stay fresh even for jobs we aren't streaming.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/crawl?limit=50`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setJobs(data);
      } catch (err) {
        console.error(err);
      }
    };
    tick();
    const timer = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Discovery hands us a batch of URLs to seed a crawl with. Applied during
  // render rather than in an effect (React's "adjusting state when a prop
  // changes" pattern) so it doesn't trigger a second render pass. App creates a
  // fresh array per hand-off, so referential identity is the applied-once guard.
  if (seedUrls && seedUrls.length > 0 && seedUrls !== appliedSeeds) {
    setAppliedSeeds(seedUrls);
    setCfg((c) => ({
      ...c,
      start_urls: seedUrls.join('\n'),
      name: c.name || `Discovery batch (${seedUrls.length})`,
      // Depth 0 on purpose: following links out of 30 search results would be a
      // very bad default.
      max_depth: 0,
    }));
    setNotice(`${seedUrls.length} URL(s) loaded from Discovery. Depth set to 0 (seeds only).`);
  }

  // Live progress stream. Depends on the id, not the object: the snapshot/done
  // handlers call setActiveJob, and depending on the whole object would tear the
  // stream down and rebuild it on every update.
  useEffect(() => {
    if (!activeJob?.id) return undefined;
    if (TERMINAL.includes(activeJob.status)) return undefined;

    const es = new EventSource(`${API_BASE}/api/crawl/${activeJob.id}/stream`);
    esRef.current = es;

    es.addEventListener('snapshot', (e) => {
      const data = JSON.parse(e.data);
      setActiveJob(data.job);
      setStats(data.stats || {});
      setLiveItems(data.recent_items || []);
    });
    es.addEventListener('stats', (e) => setStats(JSON.parse(e.data)));
    es.addEventListener('item', (e) =>
      setLiveItems((prev) => [JSON.parse(e.data), ...prev].slice(0, LIVE_FEED_CAP)),
    );
    es.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      setActiveJob((prev) => (prev ? { ...prev, status: data.status } : prev));
    });
    // Keep a short rolling list rather than replacing a single banner: on a slow
    // site these arrive steadily, and one-at-a-time tells you nothing about scale.
    es.addEventListener('error_event', (e) =>
      setFailures((prev) => [JSON.parse(e.data), ...prev].slice(0, 5)),
    );
    es.addEventListener('done', (e) => {
      const data = JSON.parse(e.data);
      setStats(data.stats || {});
      setActiveJob((prev) => (prev ? { ...prev, status: data.status, error: data.error } : prev));
      // Mandatory: when the server ends the response EventSource treats it as a
      // dropped connection and reconnects every ~3s forever.
      es.close();
      refreshJobs();
    });

    return () => es.close();
  }, [activeJob?.id, activeJob?.status, refreshJobs]);

  const openJob = async (jobId) => {
    setError('');
    setExpanded(null);
    setFailures([]);
    try {
      const res = await fetch(`${API_BASE}/api/crawl/${jobId}`);
      if (!res.ok) throw new Error('Failed to load job');
      const job = await res.json();
      setActiveJob(job);
      setStats(job.stats || {});

      // Finished jobs have no live feed, so backfill from the stored items.
      if (TERMINAL.includes(job.status)) {
        const page = await fetch(`${API_BASE}/api/crawl/${jobId}/items?limit=${LIVE_FEED_CAP}`);
        const data = await page.json();
        setLiveItems([...data.items].reverse());
      } else {
        setLiveItems([]);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLaunch = async (e) => {
    e.preventDefault();
    setLaunching(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${API_BASE}/api/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toPayload(cfg)),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(describeError(body, 'Failed to start crawl'));
      await refreshJobs();
      await openJob(body.job_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLaunching(false);
    }
  };

  const handleStop = async (jobId) => {
    try {
      const res = await fetch(`${API_BASE}/api/crawl/${jobId}/stop`, { method: 'POST' });
      if (!res.ok) throw new Error(describeError(await res.json(), 'Failed to stop crawl'));
      setNotice('Stop requested — finishing in-flight requests...');
      refreshJobs();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (jobId) => {
    if (!confirm(`Delete crawl job ${jobId} and all of its scraped items?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/crawl/${jobId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(describeError(await res.json(), 'Failed to delete crawl'));
      if (activeJob?.id === jobId) setActiveJob(null);
      refreshJobs();
    } catch (err) {
      setError(err.message);
    }
  };

  // Blob rather than a bare <a href>: it surfaces a failed export instead of
  // navigating to a JSON error page, and the download attribute is ignored on
  // cross-origin hrefs (5173 -> 8000).
  const handleExport = async (jobId, fmt, jobName) => {
    try {
      const res = await fetch(`${API_BASE}/api/crawl/${jobId}/export?format=${fmt}`);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = (jobName || 'crawl').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
      a.href = url;
      a.download = `crawl-${slug}-${jobId}.${fmt === 'markdown' ? 'md' : fmt}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToLibrary = async (jobId, count) => {
    if (!confirm(`Save ${Math.min(count, 100)} crawled page(s) to the Research Library?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/crawl/${jobId}/to-library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_items: 100 }),
      });
      if (!res.ok) throw new Error(describeError(await res.json(), 'Failed to save to library'));
      const data = await res.json();
      setNotice(`Saved ${data.saved} page(s) to the Research Library.`);
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleRow = async (item, index) => {
    const key = item.id ?? `${item.url}-${index}`;
    if (expanded === key) {
      setExpanded(null);
      setExpandedContent('');
      return;
    }
    setExpanded(key);
    setExpandedContent('Loading...');
    try {
      const res = await fetch(
        `${API_BASE}/api/crawl/${activeJob.id}/items?limit=500&include_content=true`,
      );
      const data = await res.json();
      const match = data.items.find((i) => i.url === item.url);
      setExpandedContent(match?.content || '(no content stored for this page)');
    } catch {
      setExpandedContent('Failed to load content.');
    }
  };

  const isRunning = activeJob && !TERMINAL.includes(activeJob.status);
  const itemsScraped = stats.items_scraped ?? 0;
  const maxItems = activeJob?.max_items || cfg.max_items || 1;
  const statusCounts = stats.response_status_count || {};

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Crawl Engine</h1>
        <p className="page-subtitle">
          Run multi-page crawls as background jobs with live progress, then export or archive the results.
        </p>
      </div>

      {notice && (
        <div
          style={{
            color: 'var(--secondary)', marginBottom: '1.5rem', padding: '0.9rem 1.2rem',
            border: '1px solid rgba(0,180,252,0.3)', borderRadius: '10px', fontSize: '0.9rem',
          }}
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          style={{
            color: 'var(--error)', marginBottom: '1.5rem', padding: '0.9rem 1.2rem',
            border: '1px solid var(--error)', borderRadius: '10px', fontSize: '0.9rem',
          }}
        >
          Error: {error}
        </div>
      )}

      {/* ------------------------------------------------ configuration ---- */}
      <div className="glass-card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1.5rem', color: 'var(--primary)' }}>New Crawl</h3>
        <form onSubmit={handleLaunch}>
          <div className="form-row">
            <div className="form-group" style={{ flex: '0.8' }}>
              <label>Job Name</label>
              <input value={cfg.name} onChange={set('name')} placeholder="Untitled Crawl" />
            </div>
            <div className="form-group">
              <label>Start URLs <span className="hint">(one per line)</span></label>
              <textarea
                rows={3}
                value={cfg.start_urls}
                onChange={set('start_urls')}
                placeholder={'https://quotes.toscrape.com\nhttps://example.com/docs'}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Fetcher Mode</label>
              <select value={cfg.mode} onChange={set('mode')}>
                <option value="static">Static (fastest, no browser)</option>
                <option value="dynamic">Dynamic Browser (Chromium)</option>
                <option value="stealthy">Stealthy Browser (Anti-Fingerprint)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Output Format</label>
              <select value={cfg.extraction_type} onChange={set('extraction_type')}>
                <option value="markdown">Markdown</option>
                <option value="text">Plain Text</option>
                <option value="html">Raw HTML</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Max Depth</label>
              <input type="number" min="0" max="10" value={cfg.max_depth} onChange={set('max_depth')} />
              <span className="hint">0 = seed URLs only · 1 = seeds + everything they link to</span>
            </div>
            <div className="form-group">
              <label>Max Pages</label>
              <input type="number" min="1" max="5000" value={cfg.max_items} onChange={set('max_items')} />
            </div>
            <div className="form-group">
              <label>Concurrency</label>
              <input
                type="number" min="1" max="16"
                value={cfg.concurrent_requests} onChange={set('concurrent_requests')}
              />
            </div>
            <div className="form-group">
              <label>Delay (s)</label>
              <input
                type="number" min="0" max="60" step="0.1"
                value={cfg.download_delay} onChange={set('download_delay')}
              />
            </div>
            <div className="form-group">
              <label>Page Timeout (s)</label>
              <input
                type="number" min="5" max="300" step="5"
                value={cfg.page_timeout} onChange={set('page_timeout')}
              />
              <span className="hint">Raise for slow sites</span>
            </div>
            <div className="form-group">
              <label>Max Chars / Page</label>
              <input
                type="number" min="0" max="200000" step="1000"
                value={cfg.max_content_chars} onChange={set('max_content_chars')}
              />
              <span className="hint">0 = keep the whole page</span>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Content Selector <span className="hint">(CSS, optional)</span></label>
              <input value={cfg.css_selector} onChange={set('css_selector')} placeholder="article, .post-body" />
            </div>
            <div className="form-group">
              <label>Find Links Only Within <span className="hint">(CSS, optional)</span></label>
              <input value={cfg.restrict_css} onChange={set('restrict_css')} placeholder="nav.sidebar, .pagination" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Allow URL Patterns <span className="hint">(regex, comma separated)</span></label>
              <input value={cfg.allow_patterns} onChange={set('allow_patterns')} placeholder="/docs/, /blog/" />
            </div>
            <div className="form-group">
              <label>Deny URL Patterns <span className="hint">(regex, comma separated)</span></label>
              <input value={cfg.deny_patterns} onChange={set('deny_patterns')} placeholder="/login, \\?print=" />
            </div>
            <div className="form-group">
              <label>Allowed Domains <span className="hint">(blank = from start URLs)</span></label>
              <input value={cfg.allowed_domains} onChange={set('allowed_domains')} placeholder="example.com" />
            </div>
          </div>

          <div
            className="form-group"
            style={{ flexDirection: 'row', gap: '1.4rem', flexWrap: 'wrap', margin: '0.5rem 0 1.5rem' }}
          >
            <label className="checkbox-label">
              <input type="checkbox" checked={cfg.follow_links} onChange={set('follow_links')} />
              Follow links
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={cfg.robots_txt_obey} onChange={set('robots_txt_obey')} />
              Obey robots.txt
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={cfg.headless} onChange={set('headless')} disabled={cfg.mode === 'static'} />
              Headless
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox" checked={cfg.solve_cloudflare}
                onChange={set('solve_cloudflare')} disabled={cfg.mode !== 'stealthy'}
              />
              Solve Cloudflare
            </label>
            <label className="checkbox-label" title="Applies to the seed URLs only; followed links always drop the spoofed referer.">
              <input type="checkbox" checked={cfg.google_search} onChange={set('google_search')} />
              Spoof Google Referer
            </label>
            <label className="checkbox-label" title="Blocks analytics, ads and chat-widget hosts. They carry no page content and often keep a page loading.">
              <input
                type="checkbox" checked={cfg.block_trackers}
                onChange={set('block_trackers')} disabled={cfg.mode === 'static'}
              />
              Block trackers
            </label>
            <label className="checkbox-label" title="Writes periodic checkpoints so a stopped crawl can be resumed.">
              <input type="checkbox" checked={cfg.resumable} onChange={set('resumable')} />
              Resumable
            </label>
          </div>

          <button type="submit" className="btn btn-primary btn-red" disabled={launching}>
            {launching ? (<><span className="loading-pulse"></span> Launching...</>) : 'Launch Crawl'}
          </button>
        </form>
      </div>

      {/* ---------------------------------------------------- job list ---- */}
      <div className="glass-card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Crawl Jobs</h3>
        {jobs.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            No crawl jobs yet. Configure one above to get started.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="session-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Mode</th>
                  <th>Pages</th>
                  <th>Started</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    style={activeJob?.id === job.id ? { background: 'rgba(255,42,95,0.05)' } : undefined}
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>{job.name}</div>
                      <div className="crawl-depth">{job.start_urls?.[0]}</div>
                    </td>
                    <td>
                      <span className={`status-badge ${job.status}`}>{job.status}</span>
                      {job.error && (
                        <div className="crawl-depth" style={{ color: 'var(--warning)', marginTop: '0.3rem' }}>
                          {job.error}
                        </div>
                      )}
                    </td>
                    <td className="crawl-depth">{job.mode}</td>
                    <td className="crawl-depth">{job.items_count} / {job.max_items}</td>
                    <td className="crawl-depth">{job.started_at || '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn-mini" onClick={() => openJob(job.id)} style={{ marginRight: '0.4rem' }}>
                        View
                      </button>
                      <button
                        className="btn-mini"
                        onClick={() => handleStop(job.id)}
                        disabled={TERMINAL.includes(job.status)}
                        style={{ marginRight: '0.4rem' }}
                      >
                        Stop
                      </button>
                      <button
                        className="btn-mini danger"
                        onClick={() => handleDelete(job.id)}
                        disabled={!TERMINAL.includes(job.status)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ----------------------------------------------- live progress ---- */}
      {activeJob && (
        <div className="glass-card">
          <div
            style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', flexWrap: 'wrap', gap: '1rem',
            }}
          >
            <div>
              <h3 style={{ marginBottom: '0.3rem' }}>
                {activeJob.name} <span className={`status-badge ${activeJob.status}`}>{activeJob.status}</span>
              </h3>
              <div className="crawl-depth">
                {activeJob.id} · depth {activeJob.max_depth} · {activeJob.mode}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {isRunning && (
                <button className="btn-mini" onClick={() => handleStop(activeJob.id)}>Stop</button>
              )}
              <button className="btn-mini" onClick={() => handleToLibrary(activeJob.id, itemsScraped)}>
                Send to Library
              </button>
              {['json', 'jsonl', 'csv', 'markdown'].map((fmt) => (
                <button key={fmt} className="btn-mini" onClick={() => handleExport(activeJob.id, fmt, activeJob.name)}>
                  {fmt === 'markdown' ? 'MD' : fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="crawl-stats-grid">
            <StatTile label="Pages" value={itemsScraped} tone="var(--success)" />
            <StatTile label="Requests" value={stats.requests_count ?? 0} />
            <StatTile label="Req / sec" value={(stats.requests_per_second ?? 0).toFixed(2)} />
            <StatTile label="Elapsed" value={fmtDuration(stats.elapsed_seconds)} />
            <StatTile label="Queued" value={stats.queue_size ?? 0} />
            <StatTile label="In Flight" value={stats.active_tasks ?? 0} />
            <StatTile
              label="Failed" value={stats.failed_requests_count ?? 0}
              tone={stats.failed_requests_count ? 'var(--error)' : undefined}
            />
            <StatTile
              label="Blocked" value={stats.blocked_requests_count ?? 0}
              tone={stats.blocked_requests_count ? 'var(--error)' : undefined}
            />
            <StatTile label="Offsite" value={stats.offsite_requests_count ?? 0} />
            <StatTile
              label="Robots Blocked" value={stats.robots_disallowed_count ?? 0}
              tone={stats.robots_disallowed_count ? 'var(--warning)' : undefined}
            />
            <StatTile label="Downloaded" value={fmtBytes(stats.response_bytes)} />
          </div>

          {stats.content_warning && (
            <div
              style={{
                display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
                color: 'var(--warning)', margin: '0 0 1.2rem',
                padding: '0.9rem 1.2rem', fontSize: '0.9rem',
                border: '1px solid rgba(255,180,0,0.35)',
                background: 'rgba(255,180,0,0.06)', borderRadius: '10px',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '1px' }}>
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              <span>{stats.content_warning}</span>
            </div>
          )}

          {failures.length > 0 && (
            <details style={{ marginBottom: '1.2rem' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--error)', fontSize: '0.9rem' }}>
                {stats.failed_requests_count ?? failures.length} request(s) failed — show the most recent
              </summary>
              <div style={{ marginTop: '0.6rem' }}>
                {failures.map((f, i) => (
                  <div
                    key={`${f.url}-${i}`}
                    className="crawl-depth"
                    style={{ padding: '0.35rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>{f.url}</span>
                    <br />
                    <span style={{ color: 'var(--error)' }}>{f.error}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {Object.keys(statusCounts).length > 0 && (
            <div style={{ marginBottom: '1.2rem' }}>
              {Object.entries(statusCounts).map(([key, count]) => {
                const code = key.replace('status_', '');
                return (
                  <span key={key} className={`code-chip c${code[0]}`}>
                    {code} × {count}
                  </span>
                );
              })}
            </div>
          )}

          <div style={{ marginBottom: '1.5rem' }}>
            <div
              className="crawl-depth"
              style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}
            >
              <span>Progress</span>
              <span>{itemsScraped} / {maxItems} pages</span>
            </div>
            <div className="crawl-progress">
              <span style={{ width: `${Math.min(100, (itemsScraped / maxItems) * 100)}%` }} />
            </div>
          </div>

          <div className="crawl-feed">
            <table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th style={{ width: '70px' }}>Depth</th>
                  <th style={{ width: '70px' }}>Status</th>
                  <th style={{ width: '90px' }}>Chars</th>
                  <th style={{ width: '90px' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {liveItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
                      {isRunning ? 'Waiting for the first page...' : 'No pages captured.'}
                    </td>
                  </tr>
                ) : (
                  liveItems.map((item, index) => {
                    const key = item.id ?? `${item.url}-${index}`;
                    return (
                      <React.Fragment key={key}>
                        <tr onClick={() => toggleRow(item, index)}>
                          <td>
                            <span className="crawl-url" title={item.url}>{item.url}</span>
                          </td>
                          <td className="crawl-depth">{item.depth}</td>
                          <td className="crawl-depth">{item.status_code}</td>
                          <td className="crawl-depth">{item.content_chars}</td>
                          <td className="crawl-depth">{(item.timestamp || '').slice(11)}</td>
                        </tr>
                        {expanded === key && (
                          <tr>
                            <td colSpan={5}>
                              <div
                                style={{
                                  display: 'flex', justifyContent: 'space-between',
                                  marginBottom: '0.6rem', gap: '0.5rem',
                                }}
                              >
                                <strong style={{ fontSize: '0.9rem' }}>{item.title}</strong>
                                <span style={{ whiteSpace: 'nowrap' }}>
                                  <button
                                    className="btn-mini"
                                    onClick={(e) => { e.stopPropagation(); onOpenInScraper?.(item.url); }}
                                    style={{ marginRight: '0.4rem' }}
                                  >
                                    Open in Scraper
                                  </button>
                                  <a
                                    className="btn-mini"
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ textDecoration: 'none' }}
                                  >
                                    Visit
                                  </a>
                                </span>
                              </div>
                              <pre className="crawl-content-panel">{expandedContent}</pre>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
