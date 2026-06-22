from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict
import base64
import uuid
from datetime import datetime
from markdownify import markdownify

from scrapling.fetchers import (
    Fetcher,
    AsyncFetcher,
    DynamicFetcher,
    StealthyFetcher,
    AsyncDynamicSession,
    AsyncStealthySession,
)
import database

def extract_content(page, css_selector: Optional[str], extraction_type: str) -> str:
    if css_selector:
        target_selector = page.css(css_selector)
        if not target_selector:
            return ""
        parts = []
        for sel in target_selector:
            if extraction_type == "markdown":
                parts.append(markdownify(sel.get()))
            elif extraction_type == "text":
                parts.append(sel.get_all_text(strip=True))
            else:
                parts.append(sel.get())
        return "\n\n".join(parts)
    else:
        if extraction_type == "markdown":
            return markdownify(page.html_content)
        elif extraction_type == "text":
            return page.get_all_text(strip=True)
        else:
            return page.html_content

def escape_xpath_literal(s: str) -> str:
    if "'" not in s:
        return f"'{s}'"
    if '"' not in s:
        return f'"{s}"'
    parts = s.split("'")
    concatted = ", \"'\", ".join(f"'{p}'" for p in parts)
    return f"concat({concatted})"

def extract_by_text(page, target_text: str, extraction_type: str) -> str:
    xpath_literal = escape_xpath_literal(target_text)
    selectors = page.xpath(f"//*[contains(text(), {xpath_literal})]")
    if not selectors:
        selectors = page.xpath(f"//*[contains(., {xpath_literal})]")
        
    if not selectors:
        return f"Text '{target_text}' not found on the page."
        
    # Find the most specific (shortest HTML) element containing the text
    best_sel = selectors[0]
    for sel in selectors:
        try:
            html_content = sel.get()
            if html_content and len(html_content) < len(best_sel.get()):
                best_sel = sel
        except Exception:
            pass
            
    if extraction_type == "markdown":
        return markdownify(best_sel.get())
    elif extraction_type == "text":
        return best_sel.get_all_text(strip=True)
    else:
        return best_sel.get()

def generate_summary(text: str, max_sentences: int = 5) -> str:
    import re
    from collections import Counter
    if not text or len(text.strip()) < 10:
        return "No content available to summarize."
        
    # Clean markdown and spacing
    clean_text = re.sub(r'[#\*\[\]\(\)`-]', ' ', text)
    clean_text = re.sub(r'\s+', ' ', clean_text)
    
    # Split into sentences using a robust regex pattern
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    # Filter empty or tiny sentences
    sentences = [s for s in sentences if len(s.strip()) > 3]
    
    if len(sentences) <= max_sentences:
        return "\n".join([f"• {s}" for s in sentences if s.strip()])
        
    # Extract terms and frequencies
    words = re.findall(r'\b\w+\b', clean_text.lower())
    stop_words = {
        'the', 'a', 'an', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'in', 'of', 'to', 'is', 'are', 'was', 'were', 
        'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'this', 'that', 'these', 'those', 'it', 
        'its', 'they', 'them', 'their', 'he', 'him', 'his', 'she', 'her', 'we', 'us', 'our', 'you', 'your', 'i', 
        'me', 'my', 'with', 'from', 'by', 'as', 'about', 'into', 'through', 'over', 'after', 'before', 'will', 'would',
        'can', 'could', 'should', 'may', 'might', 'must', 'just', 'more', 'some', 'other', 'any'
    }
    filtered_words = [w for w in words if w not in stop_words and len(w) > 2]
    
    if not filtered_words:
        return "\n".join([f"• {s}" for s in sentences[:max_sentences]])
        
    word_freq = Counter(filtered_words)
    
    # Score sentences based on word frequency
    sentence_scores = {}
    for idx, sentence in enumerate(sentences):
        s_words = re.findall(r'\b\w+\b', sentence.lower())
        if len(s_words) < 5:
            continue
        score = sum(word_freq[w] for w in s_words if w in word_freq)
        sentence_scores[idx] = score / len(s_words)
        
    if not sentence_scores:
        return "\n".join([f"• {s}" for s in sentences[:max_sentences]])
        
    # Get top sentences
    top_indices = sorted(sentence_scores, key=lambda idx: sentence_scores[idx], reverse=True)[:max_sentences]
    top_indices.sort()
    
    summary_sentences = [sentences[idx].strip() for idx in top_indices]
    return "\n".join([f"• {s}" for s in summary_sentences])

from contextlib import asynccontextmanager

# Initialize Database on startup using lifespan context manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    yield

app = FastAPI(title="Scrapling Visual Workspace API", lifespan=lifespan)

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Keep track of active persistent sessions
# Format: { session_id: { "session": session_obj, "type": "stealthy" | "dynamic", "created_at": str } }
active_sessions: Dict[str, dict] = {}

class ScrapeRequest(BaseModel):
    url: str
    fetcher_type: str = "stealthy"      # "static", "dynamic", "stealthy"
    extraction_type: str = "markdown"   # "markdown", "text", "html"
    css_selector: Optional[str] = None
    save_to_library: bool = False
    title: Optional[str] = None
    target_text: Optional[str] = None
    google_search: bool = False

class SessionOpenRequest(BaseModel):
    session_type: str = "stealthy"       # "stealthy" or "dynamic"
    headless: bool = True
    solve_cloudflare: bool = False
    google_search: bool = False

class SessionFetchRequest(BaseModel):
    url: str
    css_selector: Optional[str] = None
    extraction_type: str = "markdown"
    google_search: bool = False

class ScreenshotRequest(BaseModel):
    url: str
    session_type: str = "stealthy"
    target_text: Optional[str] = None
    google_search: bool = False

class LibrarySaveRequest(BaseModel):
    url: str
    title: str
    content: str
    extraction_type: str

# API Routes
@app.get("/api/search")
async def search_web(q: str):
    if not q:
        raise HTTPException(status_code=400, detail="Query string is required")
    try:
        from urllib.parse import parse_qs, urlparse
        # URL encode query
        url = f"https://html.duckduckgo.com/html/?q={q}"
        page = await AsyncFetcher.get(url)
        
        results = page.css('div.web-result')
        search_results = []
        for r in results:
            title_elems = r.css('a.result__a')
            snippet_elems = r.css('a.result__snippet')
            
            title = title_elems[0].get_all_text(strip=True) if len(title_elems) > 0 else "No Title"
            link = title_elems[0].attrib.get('href') if len(title_elems) > 0 else ""
            snippet = snippet_elems[0].get_all_text(strip=True) if len(snippet_elems) > 0 else ""
            
            if not link:
                continue
                
            # Clean DuckDuckGo redirects
            if link.startswith("//duckduckgo.com/l/?uddg="):
                parsed = urlparse("https:" + link)
                qs = parse_qs(parsed.query)
                if 'uddg' in qs:
                    link = qs['uddg'][0]
            elif link.startswith("/l/?uddg="):
                parsed = urlparse("https://duckduckgo.com" + link)
                qs = parse_qs(parsed.query)
                if 'uddg' in qs:
                    link = qs['uddg'][0]
                    
            search_results.append({
                "title": title,
                "url": link,
                "snippet": snippet
            })
            
        return search_results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/scrape")
async def run_scrape(req: ScrapeRequest):
    try:
        # Run one-off scrape
        if req.fetcher_type == "stealthy":
            page = await StealthyFetcher.async_fetch(req.url, headless=True, google_search=req.google_search)
        elif req.fetcher_type == "dynamic":
            page = await DynamicFetcher.async_fetch(req.url, headless=True, google_search=req.google_search)
        else:
            page = await AsyncFetcher.get(req.url)

        if req.target_text:
            content = extract_by_text(page, req.target_text, req.extraction_type)
        else:
            content = extract_content(page, req.css_selector, req.extraction_type)

        title = req.title or page.css("title::text").get() or "Scraped Page"

        if req.save_to_library:
            database.save_scrape(req.url, title, content, req.extraction_type)

        summary = generate_summary(content)
        return {
            "status": page.status,
            "url": page.url,
            "title": title,
            "content": content,
            "summary": summary
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/screenshot")
async def run_screenshot(req: ScreenshotRequest):
    try:
        captured = {}
        async def _capture(page_obj):
            try:
                if req.target_text:
                    locator = page_obj.get_by_text(req.target_text).first
                    await locator.wait_for(state="attached", timeout=5000)
                    captured["bytes"] = await locator.screenshot(type="png")
                else:
                    captured["bytes"] = await page_obj.screenshot(type="png", full_page=False)
            except Exception as e:
                try:
                    captured["bytes"] = await page_obj.screenshot(type="png", full_page=False)
                except Exception as inner_e:
                    captured["error"] = inner_e

        if req.session_type == "stealthy":
            async with AsyncStealthySession(headless=True, google_search=req.google_search) as session:
                await session.fetch(req.url, page_action=_capture)
        else:
            async with AsyncDynamicSession(headless=True, google_search=req.google_search) as session:
                await session.fetch(req.url, page_action=_capture)

        if "error" in captured:
            raise captured["error"]
        
        if "bytes" not in captured:
            raise Exception("Failed to capture screenshot")

        b64_img = base64.b64encode(captured["bytes"]).decode("utf-8")
        return {"screenshot": f"data:image/png;base64,{b64_img}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Persistent Sessions Management
@app.post("/api/sessions/open")
async def open_session(req: SessionOpenRequest):
    session_id = str(uuid.uuid4())[:8]
    try:
        if req.session_type == "stealthy":
            session = AsyncStealthySession(headless=req.headless, solve_cloudflare=req.solve_cloudflare, google_search=req.google_search)
        else:
            session = AsyncDynamicSession(headless=req.headless, google_search=req.google_search)
        
        await session.start()
        active_sessions[session_id] = {
            "session": session,
            "type": req.session_type,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        return {
            "session_id": session_id,
            "type": req.session_type,
            "created_at": active_sessions[session_id]["created_at"],
            "message": "Session opened successfully."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/sessions")
def list_sessions():
    res = []
    for sid, info in active_sessions.items():
        res.append({
            "session_id": sid,
            "type": info["type"],
            "created_at": info["created_at"]
        })
    return res

@app.delete("/api/sessions/{session_id}")
async def close_session(session_id: str):
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        info = active_sessions.pop(session_id)
        await info["session"].close()
        return {"message": f"Session {session_id} closed successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/sessions/{session_id}/fetch")
async def session_fetch(session_id: str, req: SessionFetchRequest):
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        info = active_sessions[session_id]
        session = info["session"]
        
        # Run fetch inside the persistent session
        page = await session.fetch(req.url, google_search=req.google_search)
        
        content = extract_content(page, req.css_selector, req.extraction_type)

        summary = generate_summary(content)
        return {
            "status": page.status,
            "url": page.url,
            "title": page.css("title::text").get() or "Scraped Page",
            "content": content,
            "summary": summary
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Library Management
@app.get("/api/library")
def get_library(search: Optional[str] = None):
    return database.get_scrapes(search)

@app.post("/api/library")
def save_to_library(req: LibrarySaveRequest):
    try:
        database.save_scrape(req.url, req.title, req.content, req.extraction_type)
        return {"message": "Saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/library/{scrape_id}")
def delete_from_library(scrape_id: int):
    try:
        database.delete_scrape(scrape_id)
        return {"message": "Deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
