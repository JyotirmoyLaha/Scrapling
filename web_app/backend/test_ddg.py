import sys
from scrapling.fetchers import Fetcher

def search_ddg(query):
    url = f"https://html.duckduckgo.com/html/?q={query}"
    print(f"Fetching: {url}")
    # Using the static Fetcher since DuckDuckGo HTML does not require JS
    response = Fetcher.get(url)
    print(f"Response status: {response.status}")
    
    # Let's find results
    # Each result is inside div.web-result
    results = response.css('div.web-result')
    print(f"Found {len(results)} results")
    
    for r in results[:5]:
        title_elems = r.css('a.result__a')
        snippet_elems = r.css('a.result__snippet')
        url_elems = r.css('a.result__url')
        
        title = title_elems[0].get_all_text(strip=True) if len(title_elems) > 0 else "No Title"
        link = title_elems[0].attrib.get('href') if len(title_elems) > 0 else "No Link"
        snippet = snippet_elems[0].get_all_text(strip=True) if len(snippet_elems) > 0 else "No Snippet"
        
        # Clean up redirects if any
        # DuckDuckGo HTML links sometimes look like: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com
        if link.startswith("//duckduckgo.com/l/?uddg="):
            from urllib.parse import parse_qs, urlparse
            parsed = urlparse("https:" + link)
            qs = parse_qs(parsed.query)
            if 'uddg' in qs:
                link = qs['uddg'][0]
        elif link.startswith("/l/?uddg="):
            from urllib.parse import parse_qs, urlparse
            parsed = urlparse("https://duckduckgo.com" + link)
            qs = parse_qs(parsed.query)
            if 'uddg' in qs:
                link = qs['uddg'][0]
        
        print(f"Title: {title}")
        print(f"Link: {link}")
        print(f"Snippet: {snippet}")
        print("-" * 40)

if __name__ == "__main__":
    q = "Python Scrapling library"
    if len(sys.argv) > 1:
        q = " ".join(sys.argv[1:])
    search_ddg(q)
