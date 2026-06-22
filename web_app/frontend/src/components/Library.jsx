import React, { useState, useEffect } from 'react';
import { HoloArchiveStack } from './PremiumAddons';

export default function Library() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchLibrary();
  }, [search]);

  const fetchLibrary = async () => {
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:8000/api/library?search=${encodeURIComponent(search)}`);
      if (!response.ok) throw new Error('Failed to load library items');
      const data = await response.json();
      setItems(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this scrape from the library?')) return;

    try {
      const response = await fetch(`http://localhost:8000/api/library/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete item');
      
      if (selectedItem?.id === id) {
        setSelectedItem(null);
      }
      
      await fetchLibrary();
    } catch (err) {
      alert(err.message);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert('Copied content to clipboard!');
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Research Library</h1>
        <p className="page-subtitle">Search, view, and organize your gathered project information database</p>
      </div>

      {/* Search Header */}
      <div className="glass-card" style={{ padding: '1.2rem', marginBottom: '2rem' }}>
        <input
          type="text"
          placeholder="Search by keywords, URLs, titles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', fontSize: '1.05rem', padding: '0.8rem 1.2rem' }}
        />
      </div>

      {/* Main Grid View */}
      {loading && items.length === 0 ? (
        <div className="loading-container">
          <span className="loading-pulse"></span>
          <p>Loading research library...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>
            {search ? 'No matches found for your search query.' : 'Your research library is currently empty. Run a scrape and tick "Save to Research Library" to begin archiving.'}
          </p>
        </div>
      ) : (
        <div>
          {items.length > 0 && (
            <div style={{ marginBottom: '2.5rem' }}>
              <HoloArchiveStack items={items} onSelectItem={(item) => setSelectedItem(item)} />
            </div>
          )}
          <div className="library-grid">
            {items.map((item) => (
              <div 
                key={item.id} 
                className="glass-card library-card"
                style={{
                  borderLeft: '4px solid var(--primary)',
                  cursor: 'pointer'
                }}
                onClick={() => setSelectedItem(item)}
              >
                <div className="library-card-header">
                  <div className="library-card-title">{item.title || 'Untitled Scrape'}</div>
                  <span className="status-badge" style={{ backgroundColor: 'rgba(0, 180, 252, 0.1)', color: 'var(--secondary)' }}>
                    {item.extraction_type}
                  </span>
                </div>
                
                <div className="library-card-meta">
                  <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', marginBottom: '0.4rem' }}>
                    {item.url}
                  </div>
                  <div style={{ fontSize: '0.75rem' }}>{item.timestamp}</div>
                </div>

                <div className="library-card-actions">
                  <button 
                    className="copy-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(item.content);
                    }}
                    style={{ flex: '1' }}
                  >
                    Copy
                  </button>
                  <button 
                    className="copy-btn"
                    style={{ backgroundColor: 'var(--accent)', color: 'white', border: 'none', flex: '1' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(item.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail Overlay Modal */}
      {selectedItem && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(9, 10, 14, 0.85)',
            backdropFilter: 'blur(8px)',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem'
          }}
          onClick={() => setSelectedItem(null)}
        >
          <div 
            className="glass-card" 
            style={{ 
              width: '100%', 
              maxWidth: '900px', 
              maxHeight: '90vh', 
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid rgba(255, 255, 255, 0.12)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-between">
              <span className="status-badge" style={{ backgroundColor: 'rgba(255, 42, 95, 0.1)', color: 'var(--primary)' }}>
                {selectedItem.extraction_type}
              </span>
              <button 
                className="copy-btn" 
                style={{ fontSize: '1rem', padding: '0.5rem 1rem' }} 
                onClick={() => setSelectedItem(null)}
              >
                Close View
              </button>
            </div>

            <div>
              <h2 style={{ fontSize: '1.6rem', fontWeight: '700', marginBottom: '0.5rem' }}>{selectedItem.title}</h2>
              <a 
                href={selectedItem.url} 
                target="_blank" 
                rel="noreferrer" 
                style={{ color: 'var(--secondary)', textDecoration: 'none', fontSize: '0.9rem', wordBreak: 'break-all' }}
              >
                {selectedItem.url}
              </a>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.4rem' }}>
                Archived: {selectedItem.timestamp}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn btn-secondary" onClick={() => copyToClipboard(selectedItem.content)}>
                Copy Raw Scraped Text
              </button>
              <button 
                className="btn btn-danger" 
                onClick={() => {
                  handleDelete(selectedItem.id);
                }}
              >
                Delete Record
              </button>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <pre style={{ maxHeight: '450px' }}>{selectedItem.content}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
