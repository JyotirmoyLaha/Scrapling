import React, { useState } from 'react';
import Scraper from './components/Scraper';
import Discovery from './components/Discovery';
import Sessions from './components/Sessions';
import Library from './components/Library';
import ScriptGen from './components/ScriptGen';
import CyberCanvas from './components/CyberCanvas';

function App() {
  const [activeTab, setActiveTab] = useState('scraper');
  const [selectedUrl, setSelectedUrl] = useState('');

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'scraper':
        return <Scraper defaultUrl={selectedUrl} setDefaultUrl={setSelectedUrl} />;
      case 'discovery':
        return (
          <Discovery 
            onSelectUrl={(url) => {
              setSelectedUrl(url);
              setActiveTab('scraper');
            }} 
          />
        );
      case 'sessions':
        return <Sessions />;
      case 'library':
        return <Library />;
      case 'scriptgen':
        return <ScriptGen />;
      default:
        return <Scraper defaultUrl={selectedUrl} setDefaultUrl={setSelectedUrl} />;
    }
  };

  return (
    <div className="app-container">
      <CyberCanvas />
      {/* Sidebar Navigation */}
      <nav className="sidebar">
        <div className="brand-section">
          <svg 
            width="32" 
            height="32" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="#00b4fc" 
            strokeWidth="2.5" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          <span className="brand-logo">Scrapling<span className="cursor-dot">_</span></span>
        </div>

        <ul className="nav-links">
          <li className="nav-item">
            <button 
              className={`nav-button ${activeTab === 'scraper' ? 'active-red' : ''}`}
              onClick={() => setActiveTab('scraper')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polygon points="10 8 16 12 10 16 10 8"></polygon>
              </svg>
              Scraper Console
            </button>
          </li>
          
          <li className="nav-item">
            <button 
              className={`nav-button ${activeTab === 'discovery' ? 'active-blue' : ''}`}
              onClick={() => setActiveTab('discovery')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                <line x1="11" y1="8" x2="11" y2="14"></line>
                <line x1="8" y1="11" x2="14" y2="11"></line>
              </svg>
              Discovery Engine
            </button>
          </li>

          <li className="nav-item">
            <button 
              className={`nav-button ${activeTab === 'sessions' ? 'active-blue' : ''}`}
              onClick={() => setActiveTab('sessions')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                <line x1="6" y1="6" x2="6.01" y2="6"></line>
                <line x1="6" y1="18" x2="6.01" y2="18"></line>
              </svg>
              Persistent Sessions
            </button>
          </li>
          <li className="nav-item">
            <button 
              className={`nav-button ${activeTab === 'library' ? 'active-blue' : ''}`}
              onClick={() => setActiveTab('library')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
              Research Library
            </button>
          </li>
          <li className="nav-item">
            <button 
              className={`nav-button ${activeTab === 'scriptgen' ? 'active-blue' : ''}`}
              onClick={() => setActiveTab('scriptgen')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6"></polyline>
                <polyline points="8 6 2 12 8 18"></polyline>
              </svg>
              Script Generator
            </button>
          </li>
        </ul>
      </nav>

      {/* Main Content Area */}
      <main className="main-content">
        {renderActiveTab()}
      </main>
    </div>
  );
}

export default App;
