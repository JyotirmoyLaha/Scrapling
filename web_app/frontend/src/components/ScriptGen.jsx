import React, { useState } from 'react';
import { CodeTerminalStreamer } from './PremiumAddons';

export default function ScriptGen() {
  const [url, setUrl] = useState('https://quotes.toscrape.com/');
  const [fetcherType, setFetcherType] = useState('stealthy');
  const [selector, setSelector] = useState('.quote');
  const [extractionType, setExtractionType] = useState('markdown');

  const getFetcherClass = () => {
    if (fetcherType === 'stealthy') return 'StealthyFetcher';
    if (fetcherType === 'dynamic') return 'DynamicFetcher';
    return 'Fetcher';
  };

  const getFetcherImport = () => {
    if (fetcherType === 'stealthy') return 'from scrapling.fetchers import StealthyFetcher';
    if (fetcherType === 'dynamic') return 'from scrapling.fetchers import DynamicFetcher';
    return 'from scrapling.fetchers import Fetcher';
  };

  const generateOneOffCode = () => {
    const imp = getFetcherImport();
    const cls = getFetcherClass();
    const fetchFunc = fetcherType === 'static' ? 'get' : 'fetch';
    
    let selectionLine = '';
    if (selector) {
      if (extractionType === 'markdown') {
        selectionLine = `\n# Extract target content inside selector\ntarget_data = response.css('${selector}').markdown\nprint(target_data)`;
      } else if (extractionType === 'text') {
        selectionLine = `\n# Extract target content inside selector\ntarget_data = response.css('${selector}').text\nprint(target_data)`;
      } else {
        selectionLine = `\n# Extract target content inside selector\ntarget_data = response.css('${selector}').getall()\nprint(target_data)`;
      }
    } else {
      if (extractionType === 'markdown') {
        selectionLine = `\nprint(response.markdown)`;
      } else if (extractionType === 'text') {
        selectionLine = `\nprint(response.text)`;
      } else {
        selectionLine = `\nprint(response.html)`;
      }
    }

    return `${imp}

# Fetch the webpage using Scrapling's engine
response = ${cls}.${fetchFunc}('${url}'${fetcherType !== 'static' ? ', headless=True' : ''})
${selectionLine}
`;
  };

  const generateSessionCode = () => {
    const sessionClass = fetcherType === 'stealthy' ? 'StealthySession' : (fetcherType === 'dynamic' ? 'DynamicSession' : 'FetcherSession');
    const importName = `from scrapling.fetchers import ${sessionClass}`;
    
    return `${importName}

# Persistent sessions handle cookies, authentication, and state automatically
with ${sessionClass}(headless=True) as session:
    # First request
    response = session.${fetcherType === 'static' ? 'get' : 'fetch'}('${url}')
    
    # Extract page data
    ${selector ? `items = response.css('${selector}').getall()` : `html_content = response.html`}
    print("Scraped page successfully!")
    
    # You can perform subsequent fetches using the same browser session
    # e.g., session.fetch('https://quotes.toscrape.com/page/2/')
`;
  };

  const generateSpiderCode = () => {
    return `from scrapling.spiders import Spider, Request, Response

class ProjectSpider(Spider):
    name = "research_spider"
    start_urls = ["${url}"]
    concurrent_requests = 4
    
    async def parse(self, response: Response):
        print(f"Crawled: {response.url} (Status: {response.status})")
        
        # Scrape items using CSS selectors
        ${selector ? `for item in response.css('${selector}'):
            yield {
                "content": item.markdown if hasattr(item, "markdown") else item.get(),
                "url": response.url
            }` : `yield {
            "title": response.css('title::text').get(),
            "body": response.markdown
        }`}
        
        # Follow pagination links automatically
        next_links = response.css('.next a::attr(href)').getall()
        for link in next_links:
            yield response.follow(link, callback=self.parse)

# Initialize and run spider
result = ProjectSpider().start()
print(f"Scraped {len(result.items)} items.")
# Save results to a local file
result.items.to_json("scraped_data.json")
`;
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert('Code copied to clipboard!');
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Script Generator</h1>
        <p className="page-subtitle">Translate your UI choices into clean, ready-to-run Python Scrapling scripts</p>
      </div>

      <div className="form-row" style={{ alignItems: 'flex-start', gap: '2rem' }}>
        {/* Configurations input */}
        <div className="glass-card" style={{ flex: '0.8' }}>
          <CodeTerminalStreamer />
          <h3 style={{ margin: '1.2rem 0 1.2rem 0', color: 'var(--primary)' }}>Script Options</h3>
          
          <div className="form-group">
            <label>Target URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
          </div>

          <div className="form-group">
            <label>Fetcher Type</label>
            <select value={fetcherType} onChange={(e) => setFetcherType(e.target.value)}>
              <option value="stealthy">StealthyFetcher</option>
              <option value="dynamic">DynamicFetcher</option>
              <option value="static">Fetcher (Static)</option>
            </select>
          </div>

          <div className="form-group">
            <label>CSS Selector</label>
            <input
              type="text"
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              placeholder="e.g. .quote"
            />
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

        {/* Code displays */}
        <div style={{ flex: '1.2', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {/* One-off script */}
          <div className="glass-card">
            <div className="flex-between" style={{ marginBottom: '1rem' }}>
              <h3 style={{ color: 'var(--primary)' }}>One-Off Fetch Script</h3>
              <button className="copy-btn" onClick={() => copyToClipboard(generateOneOffCode())}>
                Copy Code
              </button>
            </div>
            <pre>{generateOneOffCode()}</pre>
          </div>

          {/* Session script */}
          <div className="glass-card">
            <div className="flex-between" style={{ marginBottom: '1rem' }}>
              <h3 style={{ color: 'var(--secondary)' }}>Persistent Session Block</h3>
              <button className="copy-btn" onClick={() => copyToClipboard(generateSessionCode())}>
                Copy Code
              </button>
            </div>
            <pre>{generateSessionCode()}</pre>
          </div>

          {/* Full Spider script */}
          <div className="glass-card">
            <div className="flex-between" style={{ marginBottom: '1rem' }}>
              <h3 style={{ color: 'var(--success)' }}>Asynchronous Spider Template</h3>
              <button className="copy-btn" onClick={() => copyToClipboard(generateSpiderCode())}>
                Copy Code
              </button>
            </div>
            <pre>{generateSpiderCode()}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
