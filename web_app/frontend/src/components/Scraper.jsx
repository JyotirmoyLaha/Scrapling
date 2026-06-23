import React, { useState, useEffect } from 'react';
import { FingerprintVisualizer } from './PremiumAddons';

const parseBoldText = (text) => {
  if (!text) return '';
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  return parts.map((part, i) => i % 2 === 1 ? <strong key={i} style={{ color: 'var(--secondary)', fontWeight: '600' }}>{part}</strong> : part);
};

const renderMarkdown = (text) => {
  if (!text) return null;
  
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    
    // Headers
    if (trimmed.startsWith('### ')) {
      return (
        <h4 key={idx} style={{ color: 'var(--primary)', marginTop: '1.5rem', marginBottom: '0.8rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '0.4rem', fontWeight: '600', fontSize: '1.1rem' }}>
          {trimmed.replace('### ', '')}
        </h4>
      );
    }
    if (trimmed.startsWith('## ')) {
      return (
        <h3 key={idx} style={{ color: 'var(--secondary)', marginTop: '1.5rem', marginBottom: '0.8rem', fontWeight: '600' }}>
          {trimmed.replace('## ', '')}
        </h3>
      );
    }
    
    // Numbered Lists
    const numberedMatch = trimmed.match(/^(\d+)\.\s(.*)/);
    if (numberedMatch) {
      const num = numberedMatch[1];
      const content = numberedMatch[2];
      return (
        <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginBottom: '0.6rem', paddingLeft: '0.5rem' }}>
          <span style={{ color: 'var(--primary)', fontWeight: 'bold', minWidth: '1.2rem', fontSize: '0.95rem' }}>{num}.</span>
          <span style={{ color: 'inherit', flex: 1, fontSize: '0.95rem', lineHeight: '1.6' }}>{parseBoldText(content)}</span>
        </div>
      );
    }

    // Bullet points
    if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
      const content = trimmed.substring(1).trim();
      return (
        <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginBottom: '0.6rem', paddingLeft: '0.5rem' }}>
          <span style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '1.1rem', lineHeight: '1.2' }}>•</span>
          <span style={{ color: 'inherit', flex: 1, fontSize: '0.95rem', lineHeight: '1.6' }}>{parseBoldText(content)}</span>
        </div>
      );
    }
    
    // Hashtags / Topics inline styling
    if (trimmed.startsWith('#')) {
      const tags = trimmed.split(/\s+/).filter(t => t.startsWith('#'));
      if (tags.length > 0) {
        return (
          <div key={idx} style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.8rem', marginBottom: '0.8rem' }}>
            {tags.map((tag, tIdx) => (
              <span key={tIdx} style={{ background: 'rgba(0, 180, 252, 0.08)', color: 'var(--secondary)', border: '1px solid rgba(0, 180, 252, 0.2)', padding: '0.25rem 0.65rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '600', letterSpacing: '0.2px' }}>
                {tag}
              </span>
            ))}
          </div>
        );
      }
    }
    
    // Default paragraphs
    return trimmed ? (
      <p key={idx} style={{ marginBottom: '0.8rem', color: 'inherit', lineHeight: '1.6', fontSize: '0.95rem' }}>
        {parseBoldText(trimmed)}
      </p>
    ) : <div key={idx} style={{ height: '0.4rem' }} />;
  });
};

const InteractiveKnowledgeGraph = ({ data }) => {
  const [nodes, setNodes] = React.useState([]);
  const [edges, setEdges] = React.useState([]);
  const [draggedNode, setDraggedNode] = React.useState(null);
  const svgRef = React.useRef(null);

  React.useEffect(() => {
    if (!data || !data.nodes) return;

    const width = 800;
    const height = 450;

    const initialNodes = data.nodes.map((node, i) => {
      const angle = (i / data.nodes.length) * 2 * Math.PI;
      const radius = 150 + Math.random() * 30;
      return {
        ...node,
        x: width / 2 + radius * Math.cos(angle),
        y: height / 2 + radius * Math.sin(angle),
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
      };
    });

    setNodes(initialNodes);
    setEdges(data.edges || []);
  }, [data]);

  React.useEffect(() => {
    if (nodes.length === 0) return;

    const width = 800;
    const height = 450;
    let animationFrameId;

    const tick = () => {
      setNodes((prevNodes) => {
        const updated = prevNodes.map((n) => ({ ...n }));
        const nodeMap = {};
        updated.forEach((n) => {
          nodeMap[n.id] = n;
        });

        const kSpring = 0.02;
        const restLength = 220;
        const kRepulsion = 75000;
        const kGravity = 0.003;
        const damping = 0.84;

        for (let i = 0; i < updated.length; i++) {
          for (let j = i + 1; j < updated.length; j++) {
            const n1 = updated[i];
            const n2 = updated[j];
            const dx = n2.x - n1.x;
            const dy = n2.y - n1.y;
            const distSq = dx * dx + dy * dy + 0.01;
            const dist = Math.sqrt(distSq);

            if (dist < 550) {
              const force = kRepulsion / distSq;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;

              if (n1.fx === null) {
                n1.vx -= fx;
                n1.vy -= fy;
              }
              if (n2.fx === null) {
                n2.vx += fx;
                n2.vy += fy;
              }
            }
          }
        }

        edges.forEach((edge) => {
          const source = nodeMap[edge.from];
          const target = nodeMap[edge.to];

          if (source && target) {
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
            const displacement = dist - restLength;
            const force = kSpring * displacement;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (source.fx === null) {
              source.vx += fx;
              source.vy += fy;
            }
            if (target.fx === null) {
              target.vx -= fx;
              target.vy -= fy;
            }
          }
        });

        updated.forEach((node) => {
          if (node.fx !== null && node.fy !== null) {
            node.x = node.fx;
            node.y = node.fy;
            node.vx = 0;
            node.vy = 0;
          } else {
            const dx = width / 2 - node.x;
            const dy = height / 2 - node.y;
            node.vx += dx * kGravity;
            node.vy += dy * kGravity;

            node.vx *= damping;
            node.vy *= damping;
            node.x += node.vx;
            node.y += node.vy;

            const marginX = 85;
            const marginTop = 45;
            const marginBottom = 55;
            if (node.x < marginX) { node.x = marginX; node.vx = 0; }
            if (node.x > width - marginX) { node.x = width - marginX; node.vx = 0; }
            if (node.y < marginTop) { node.y = marginTop; node.vy = 0; }
            if (node.y > height - marginBottom) { node.y = height - marginBottom; node.vy = 0; }
          }
        });

        return updated;
      });

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [nodes.length, edges]);

  const handleMouseDown = (node, e) => {
    e.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = 800 / rect.width;
    const scaleY = 450 / rect.height;
    const marginX = 85;
    const marginTop = 45;
    const marginBottom = 55;
    const fx = Math.max(marginX, Math.min(800 - marginX, (e.clientX - rect.left) * scaleX));
    const fy = Math.max(marginTop, Math.min(450 - marginBottom, (e.clientY - rect.top) * scaleY));
    setDraggedNode(node.id);
    setNodes((prev) =>
      prev.map((n) => (n.id === node.id ? { ...n, fx, fy } : n))
    );
  };

  const handleMouseMove = (e) => {
    if (!draggedNode) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = 800 / rect.width;
    const scaleY = 450 / rect.height;
    const marginX = 85;
    const marginTop = 45;
    const marginBottom = 55;
    const fx = Math.max(marginX, Math.min(800 - marginX, (e.clientX - rect.left) * scaleX));
    const fy = Math.max(marginTop, Math.min(450 - marginBottom, (e.clientY - rect.top) * scaleY));
    setNodes((prev) =>
      prev.map((n) => (n.id === draggedNode ? { ...n, fx, fy } : n))
    );
  };

  const handleMouseUp = () => {
    if (!draggedNode) return;
    setNodes((prev) =>
      prev.map((n) => (n.id === draggedNode ? { ...n, fx: null, fy: null } : n))
    );
    setDraggedNode(null);
  };

  const getNodeColor = (type) => {
    switch (type?.toLowerCase()) {
      case 'org':
        return '#00b4fc';
      case 'person':
        return '#00f09a';
      case 'tech':
        return '#ffb400';
      case 'metric':
        return '#a855f7';
      default:
        return '#ff2a5f';
    }
  };

  const nodeMap = {};
  nodes.forEach((n) => {
    nodeMap[n.id] = n;
  });

  return (
    <div style={{ position: 'relative', width: '100%', userSelect: 'none' }}>
      <svg
        ref={svgRef}
        viewBox="0 0 800 450"
        style={{
          width: '100%',
          height: '450px',
          background: 'rgba(9, 10, 14, 0.4)',
          borderRadius: '12px',
          border: '1px solid var(--card-border)',
          cursor: draggedNode ? 'grabbing' : 'default',
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {edges.map((edge, idx) => {
          const source = nodeMap[edge.from];
          const target = nodeMap[edge.to];
          if (!source || !target) return null;

          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const midX = (source.x + target.x) / 2;
          const midY = (source.y + target.y) / 2;

          return (
            <g key={idx}>
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="rgba(255, 255, 255, 0.12)"
                strokeWidth="1.5"
              />
              {edge.label && dist > 70 && (
                <g transform={`translate(${midX}, ${midY})`}>
                  <rect
                    x={-((edge.label.length * 5.8 + 12) / 2)}
                    y="-9"
                    width={edge.label.length * 5.8 + 12}
                    height="18"
                    fill="rgba(9, 10, 14, 0.95)"
                    rx="6"
                    stroke="rgba(255, 255, 255, 0.08)"
                    strokeWidth="0.8"
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="var(--text-muted)"
                    fontSize="9"
                    fontWeight="500"
                    style={{ fontFamily: "'Outfit', sans-serif", pointerEvents: 'none' }}
                  >
                    {edge.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {nodes.map((node) => {
          const color = getNodeColor(node.type);
          const isDragged = draggedNode === node.id;
          const labelWidth = Math.max(50, node.label.length * 6.5 + 14);

          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onMouseDown={(e) => handleMouseDown(node, e)}
              style={{ cursor: isDragged ? 'grabbing' : 'grab' }}
            >
              <circle
                r="32"
                fill={color}
                opacity={isDragged ? 0.28 : 0.09}
                style={{ transition: 'opacity 0.2s' }}
              />
              <circle
                r="13"
                fill={color}
                stroke="#ffffff"
                strokeWidth="2.5"
                style={{
                  filter: `drop-shadow(0 0 6px ${color})`,
                  transition: 'transform 0.1s',
                }}
              />
              <circle r="4" fill="#050608" />
              <g transform="translate(0, 26)">
                <rect
                  x={-(labelWidth / 2)}
                  y="-9"
                  width={labelWidth}
                  height="18"
                  fill="rgba(9, 10, 14, 0.96)"
                  rx="9"
                  stroke={color}
                  strokeWidth="1.2"
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#ffffff"
                  fontSize="10"
                  fontWeight="600"
                  style={{ fontFamily: "'Outfit', sans-serif", pointerEvents: 'none' }}
                >
                  {node.label}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
      <div style={{
        position: 'absolute',
        bottom: '15px',
        left: '15px',
        display: 'flex',
        gap: '0.8rem',
        background: 'rgba(5, 6, 8, 0.75)',
        padding: '0.4rem 0.8rem',
        borderRadius: '8px',
        border: '1px solid var(--card-border)',
        fontSize: '0.75rem',
        backdropFilter: 'blur(4px)',
        pointerEvents: 'none'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff2a5f' }}></span> Concept
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00b4fc' }}></span> Org
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00f09a' }}></span> Person
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ffb400' }}></span> Tech
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#a855f7' }}></span> Metric
        </div>
      </div>
    </div>
  );
};

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
  const [activeResultTab, setActiveResultTab] = useState('content');
  const [error, setError] = useState('');

  // RAG Chat States
  const [chatQuery, setChatQuery] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);

  // Schema Extractor States
  const [schemaInput, setSchemaInput] = useState('');
  const [schemaResult, setSchemaResult] = useState(null);
  const [schemaLoading, setSchemaLoading] = useState(false);

  // Knowledge Graph States
  const [graphData, setGraphData] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);

  // Summary States
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    if (defaultUrl) {
      setUrl(defaultUrl);
      if (setDefaultUrl) setDefaultUrl('');
    }
  }, [defaultUrl, setDefaultUrl]);

  const handleTabChange = (tabName) => {
    setActiveResultTab(tabName);
    if (tabName === 'graph' && !graphData && result?.content) {
      handleFetchKnowledgeGraph();
    }
    if (tabName === 'summary' && !summary && result?.content) {
      handleFetchSummary();
    }
  };

  const handleFetchSummary = async () => {
    if (summaryLoading || !result?.content) return;

    setSummaryLoading(true);
    setSummary('');

    try {
      const response = await fetch('http://localhost:8000/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: result.content,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Summary generation failed');
      }

      const data = await response.json();
      setSummary(data.summary);
    } catch (err) {
      setError(err.message);
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleSendChatMessage = async (e) => {
    e.preventDefault();
    if (!chatQuery.trim() || chatLoading || !result?.content) return;

    const userMessage = { role: 'user', content: chatQuery };
    setChatHistory((prev) => [...prev, userMessage]);
    setChatQuery('');
    setChatLoading(true);

    try {
      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: result.content,
          query: chatQuery,
          history: chatHistory,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Chat query failed');
      }

      const data = await response.json();
      setChatHistory((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setChatLoading(false);
    }
  };

  const handleExtractSchema = async (e) => {
    e.preventDefault();
    if (!schemaInput.trim() || schemaLoading || !result?.content) return;

    setSchemaLoading(true);
    setSchemaResult(null);

    try {
      const response = await fetch('http://localhost:8000/api/extract-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: result.content,
          schema_description: schemaInput,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Schema extraction failed');
      }

      const data = await response.json();
      setSchemaResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSchemaLoading(false);
    }
  };

  const handleFetchKnowledgeGraph = async () => {
    if (graphLoading || !result?.content) return;

    setGraphLoading(true);
    setGraphData(null);

    try {
      const response = await fetch('http://localhost:8000/api/knowledge-graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: result.content,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Knowledge graph extraction failed');
      }

      const data = await response.json();
      setGraphData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setGraphLoading(false);
    }
  };

  const handleScrape = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    
    // Reset our AI states
    setChatHistory([]);
    setSchemaResult(null);
    setGraphData(null);
    setSummary('');
    setSummaryLoading(false);

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
          <div className="flex-between" style={{ flexWrap: 'wrap', gap: '1rem' }}>
            <div className="results-tabs" style={{ flexWrap: 'wrap', gap: '0.3rem' }}>
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
                  onClick={() => handleTabChange('summary')}
                >
                  Brief Summary
                </button>
              )}
              {result && (
                <button 
                  className={`tab-btn ${activeResultTab === 'chat' ? 'active' : ''}`}
                  onClick={() => setActiveResultTab('chat')}
                >
                  💬 RAG Console
                </button>
              )}
              {result && (
                <button 
                  className={`tab-btn ${activeResultTab === 'schema' ? 'active' : ''}`}
                  onClick={() => setActiveResultTab('schema')}
                >
                  📊 Schema Extractor
                </button>
              )}
              {result && (
                <button 
                  className={`tab-btn ${activeResultTab === 'graph' ? 'active' : ''}`}
                  onClick={() => handleTabChange('graph')}
                >
                  🕸️ Knowledge Graph
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
            {activeResultTab === 'summary' && summary && (
              <button className="copy-btn" onClick={() => copyToClipboard(summary)}>
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
              <div style={{ padding: '1.5rem', background: 'rgba(9, 10, 14, 0.3)', borderRadius: '12px', border: '1px solid var(--card-border)' }}>
                <h3 style={{ color: 'var(--primary)', marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.6rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '0.8rem' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary)' }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  Extract Summary Brief
                </h3>
                {summaryLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', color: 'var(--text-muted)', fontSize: '0.95rem', padding: '1rem 0' }}>
                    <span className="loading-pulse"></span> Generating summary via AI...
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-main)' }}>
                    {renderMarkdown(summary)}
                  </div>
                )}
              </div>
            )}

            {activeResultTab === 'chat' && result && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '500px', background: 'rgba(9, 10, 14, 0.4)', border: '1px solid var(--card-border)', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ padding: '1rem', borderBottom: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.02)' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)' }}></span>
                  <span style={{ fontWeight: '600', fontSize: '0.95rem' }}>AI Research Assistant (Active Context)</span>
                </div>
                <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {chatHistory.length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '0.8rem', textAlign: 'center', padding: '2rem' }}>
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                      </svg>
                      <div>
                        <p style={{ fontWeight: '600', color: 'var(--text-main)' }}>Context Loaded Successfully</p>
                        <p style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}>Ask me any question about the scraped content, tables, metadata, or text.</p>
                      </div>
                    </div>
                  ) : (
                    chatHistory.map((msg, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <div style={{
                          maxWidth: '80%',
                          padding: '0.9rem 1.2rem',
                          borderRadius: '12px',
                          background: msg.role === 'user' ? 'rgba(0, 180, 252, 0.1)' : 'rgba(255, 42, 95, 0.06)',
                          border: msg.role === 'user' ? '1px solid rgba(0, 180, 252, 0.25)' : '1px solid rgba(255, 42, 95, 0.2)',
                          color: 'var(--text-main)',
                          fontSize: '0.95rem',
                          lineHeight: '1.5',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                        }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: msg.role === 'user' ? 'var(--secondary)' : 'var(--primary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            {msg.role === 'user' ? 'User' : 'Assistant'}
                          </div>
                          <div>{renderMarkdown(msg.content)}</div>
                        </div>
                      </div>
                    ))
                  )}
                  {chatLoading && (
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <div style={{ background: 'rgba(255, 42, 95, 0.04)', border: '1px solid rgba(255, 42, 95, 0.1)', padding: '1rem', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '0.8rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        <span className="loading-pulse"></span> Analyzing context...
                      </div>
                    </div>
                  )}
                </div>
                <form onSubmit={handleSendChatMessage} style={{ padding: '1rem', borderTop: '1px solid var(--card-border)', background: 'rgba(5, 6, 8, 0.6)', display: 'flex', gap: '0.8rem' }}>
                  <input
                    type="text"
                    placeholder="Ask about details, metrics, or outline key insights..."
                    value={chatQuery}
                    onChange={(e) => setChatQuery(e.target.value)}
                    disabled={chatLoading}
                    style={{ flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--card-border)', borderRadius: '8px', color: '#fff', padding: '0.75rem 1rem', fontSize: '0.95rem', outline: 'none' }}
                  />
                  <button type="submit" className="btn btn-red" disabled={chatLoading || !chatQuery.trim()} style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', fontSize: '0.9rem' }}>
                    Send
                  </button>
                </form>
              </div>
            )}

            {activeResultTab === 'schema' && result && (
              <div style={{ padding: '1.5rem', background: 'rgba(9, 10, 14, 0.3)', borderRadius: '12px', border: '1px solid var(--card-border)', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div>
                  <h3 style={{ color: 'var(--primary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary)' }}>
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="9" y1="9" x2="15" y2="9"></line>
                      <line x1="9" y1="13" x2="15" y2="13"></line>
                      <line x1="9" y1="17" x2="15" y2="17"></line>
                    </svg>
                    Semantic Schema Extractor
                  </h3>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    Translate raw webpage contents into a structured, clean JSON output without manually writing selectors. Explain the fields you want to extract below.
                  </p>
                </div>

                <form onSubmit={handleExtractSchema} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="form-group">
                    <label style={{ fontSize: '0.75rem' }}>Define Target Fields / Schema</label>
                    <input
                      type="text"
                      placeholder="e.g. List of all products with their name, price, rating, and description"
                      value={schemaInput}
                      onChange={(e) => setSchemaInput(e.target.value)}
                      required
                      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--card-border)', borderRadius: '8px', color: '#fff', padding: '0.8rem 1rem' }}
                    />
                  </div>
                  <button type="submit" className="btn btn-red" disabled={schemaLoading || !schemaInput.trim()} style={{ alignSelf: 'flex-start', padding: '0.8rem 1.8rem' }}>
                    {schemaLoading ? (
                      <>
                        <span className="loading-pulse"></span> Extracting Schema...
                      </>
                    ) : 'Extract JSON Schema'}
                  </button>
                </form>

                {schemaResult && (
                  <div style={{ marginTop: '1rem' }}>
                    <div className="flex-between" style={{ marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--secondary)' }}>EXTRACTED STRUCTURED DATA (JSON)</span>
                      <button className="copy-btn" onClick={() => copyToClipboard(JSON.stringify(schemaResult, null, 2))}>
                        Copy JSON
                      </button>
                    </div>
                    <pre style={{ maxHeight: '400px', background: '#050608', border: '1px solid var(--card-border)', borderRadius: '8px', padding: '1.2rem', overflowX: 'auto', fontSize: '0.85rem' }}>
                      {JSON.stringify(schemaResult, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {activeResultTab === 'graph' && result && (
              <div style={{ padding: '1.5rem', background: 'rgba(9, 10, 14, 0.3)', borderRadius: '12px', border: '1px solid var(--card-border)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <h3 style={{ color: 'var(--primary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary)' }}>
                      <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                      <path d="M2 17l10 5 10-5"></path>
                      <path d="M2 12l10 5 10-5"></path>
                    </svg>
                    Interactive Entity Knowledge Graph
                  </h3>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    Map and explore relationships, organizations, systems, and metrics extracted from this page content. Drag nodes to customize the layout.
                  </p>
                </div>

                {graphLoading && (
                  <div style={{ height: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid var(--card-border)' }}>
                    <span className="loading-pulse" style={{ width: '20px', height: '20px' }}></span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Analyzing content and mapping entity connections...</span>
                  </div>
                )}

                {!graphLoading && graphData && (
                  <InteractiveKnowledgeGraph data={graphData} />
                )}
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
