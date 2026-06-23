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

def normalize_spaces(text: str) -> str:
    import re
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip().lower()

async def extract_by_text(page, target_text: str, extraction_type: str) -> str:
    # 1. Normalize query
    norm_target = normalize_spaces(target_text)
    if not norm_target:
        return "Target text is empty."

    # 2. Check if the page content actually contains the target text (ignoring whitespace differences)
    full_page_text = page.get_all_text(strip=True) if hasattr(page, "get_all_text") else page.html_content
    norm_page = normalize_spaces(full_page_text)
    
    if norm_target in norm_page:
        # Traverse elements to find the most specific one containing the target text
        candidates = []
        for el in page.css("*"):
            try:
                el_text = el.get_all_text(strip=True)
                if el_text:
                    norm_el_text = normalize_spaces(el_text)
                    if norm_target in norm_el_text:
                        candidates.append((len(norm_el_text), el))
            except Exception:
                pass
                
        if candidates:
            # Sort by text length ascending to get the smallest leaf element
            candidates.sort(key=lambda x: x[0])
            best_len, best_el = candidates[0]
            try:
                if extraction_type == "markdown":
                    val = markdownify(best_el.get())
                elif extraction_type == "text":
                    val = best_el.get_all_text(strip=True)
                else:
                    val = best_el.get()
                if val.strip():
                    return val.strip()
            except Exception:
                pass
        
        # If element retrieval failed, return the target text directly since we know it exists
        return target_text

    # 3. If no matching literal content is on the page, perform Semantic LLM-based extraction
    prompt = (
        "You are an expert semantic information extraction engine. Your task is to analyze the provided webpage content "
        "and extract specific paragraphs, lists, tables, or sections that are semantically relevant/related to the user's query.\n\n"
        f"User Query/Topic: \"{target_text}\"\n\n"
        "Instructions:\n"
        "1. Check if the webpage contains information related to the context or event of the User Query/Topic.\n"
        "2. If there is NO relevant or related information at all, output exactly: NOT_FOUND\n"
        "3. If there is relevant information, extract and return only the relevant sections/details from the page content. "
        "Do NOT include introductory phrases, conversational fillers, or external assumptions. Preserve the facts from the page.\n"
        f"4. Format the output as clean {extraction_type}.\n\n"
        f"Webpage Content:\n{full_page_text[:45000]}"
    )
    
    try:
        reply = await async_query_llm(prompt)
        reply_strip = reply.strip()
        if "NOT_FOUND" in reply_strip or len(reply_strip) < 10:
            return f"Text context '{target_text}' not found on the page."
        return reply_strip
    except Exception as e:
        print(f"[SEMANTIC EXTRACTION WARNING]: {e}")
        return f"Text context '{target_text}' not found on the page."

def load_env_file():
    import os
    # Check multiple possible paths for .env
    env_paths = [
        os.path.join(os.path.dirname(__file__), ".env"),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"),
        ".env"
    ]
    for path in env_paths:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            os.environ[k.strip()] = v.strip().strip('"').strip("'")
            except Exception as e:
                print(f"[ENV WARNING] Failed to read env file at {path}: {e}")

# Initial environment load at server startup
load_env_file()


def offline_summarize(text: str, max_sentences: int = 5) -> str:
    import re
    import math
    from collections import Counter

    if not text or len(text.strip()) < 10:
        return "No content available to summarize."

    # Robust list of stop words
    STOP_WORDS = {
        'the', 'a', 'an', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'in', 'of', 'to', 'is', 'are', 'was', 'were', 
        'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'this', 'that', 'these', 'those', 'it', 
        'its', 'they', 'them', 'their', 'he', 'him', 'his', 'she', 'her', 'we', 'us', 'our', 'you', 'your', 'i', 
        'me', 'my', 'with', 'from', 'by', 'as', 'about', 'into', 'through', 'over', 'after', 'before', 'will', 'would',
        'can', 'could', 'should', 'may', 'might', 'must', 'just', 'more', 'some', 'other', 'any', 'here', 'there',
        'when', 'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
        'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'don', 'now', 'click', 'read',
        'view', 'web', 'page', 'site', 'website', 'link', 'go', 'get', 'please', 'use', 'login', 'sign', 'user', 'cookies'
    }

    # Clean text lines and filter out obvious boilerplate/navigation lines
    lines = text.split('\n')
    cleaned_lines = []
    
    boilerplate_keywords = [
        'sign in', 'log in', 'create account', 'forgot password', 'privacy policy', 
        'terms of service', 'cookie policy', 'all rights reserved', 'copyright ©', 
        'powered by', 'share on', 'facebook', 'twitter', 'linkedin', 'instagram',
        'accept cookies', 'subscribe to', 'mailing list', 'newsletter'
    ]
    
    for line in lines:
        line_strip = line.strip()
        if not line_strip:
            continue
            
        line_lower = line_strip.lower()
        if any(keyword in line_lower for keyword in boilerplate_keywords):
            continue
            
        line_clean = re.sub(r'[#\*\[\]\(\)`_-]', ' ', line_strip)
        line_clean = re.sub(r'\s+', ' ', line_clean).strip()
        
        # Split line into sentences
        sub_sentences = re.split(r'(?<=[.!?])\s+', line_clean)
        for s in sub_sentences:
            s = s.strip()
            if len(s) > 15:  # Minimum character length
                cleaned_lines.append(s)

    # Filter candidates by length
    candidates = []
    for s in cleaned_lines:
        words = re.findall(r'\b\w+\b', s.lower())
        if 6 <= len(words) <= 45:
            candidates.append((s, words))

    if not candidates:
        simple_sentences = re.split(r'(?<=[.!?])\s+', text.strip())
        simple_sentences = [s.strip() for s in simple_sentences if len(s.strip()) > 10]
        if not simple_sentences:
            return "No readable content available to summarize."
        return "\n".join([f"• {s}" for s in simple_sentences[:max_sentences]])

    # Count word frequencies for content words
    all_content_words = []
    for _, words in candidates:
        all_content_words.extend([w for w in words if w not in STOP_WORDS and len(w) > 2])

    if not all_content_words:
        return "\n".join([f"• {c[0]}" for c in candidates[:max_sentences]])

    word_freq = Counter(all_content_words)

    # Score candidates
    scored_candidates = []
    total_candidates = len(candidates)
    
    for idx, (sentence, words) in enumerate(candidates):
        content_words = [w for w in words if w in word_freq]
        if not content_words:
            continue
            
        unique_content = set(content_words)
        freq_sum = sum(word_freq[w] for w in unique_content)
        
        # Length normalization: soft penalty for length using math.pow(len, 0.55)
        len_norm = math.pow(len(words), 0.55)
        score = freq_sum / len_norm
        
        # Position weight (Lead bias): boost sentences at the beginning of the text
        position_factor = 1.35 - 0.35 * (idx / total_candidates)
        score *= position_factor
        
        scored_candidates.append({
            'index': idx,
            'sentence': sentence,
            'words': words,
            'content_words': unique_content,
            'score': score
        })

    # Sort by score descending
    scored_candidates.sort(key=lambda x: x['score'], reverse=True)

    # Select sentences with Jaccard-based redundancy check
    selected = []
    for item in scored_candidates:
        if len(selected) >= max_sentences:
            break
            
        is_redundant = False
        for sel in selected:
            intersection = len(item['content_words'] & sel['content_words'])
            union = len(item['content_words'] | sel['content_words'])
            jaccard = intersection / union if union > 0 else 0
            if jaccard > 0.30:  # Similarity threshold
                is_redundant = True
                break
                
        if not is_redundant:
            selected.append(item)

    if not selected:
        selected = scored_candidates[:max_sentences]

    # Sort back by original index to keep narrative flow
    selected.sort(key=lambda x: x['index'])

    highlights = [f"• {item['sentence']}" for item in selected]
    
    # Extract top keywords
    top_keywords = [pair[0] for pair in word_freq.most_common(5)]
    themes_str = ", ".join([f"#{kw}" for kw in top_keywords])
    
    summary_parts = [
        "### 📌 Key Highlights",
        "\n".join(highlights)
    ]
    if top_keywords:
        summary_parts.append(f"### 🔑 Core Themes\n{themes_str}")
        
    return "\n\n".join(summary_parts)

async def generate_summary(text: str, max_sentences: int = 5) -> str:
    try:
        truncated_text = text[:40000]
        prompt = (
            "You are an expert content brief engine. Please analyze the following scraped webpage content and generate "
            "a highly structured summary. The summary must be direct, informative, and free of generic web boilerplate "
            "(such as headers/footers, logins, or cookie consent banners).\n\n"
            "Format your response in Markdown as follows:\n"
            "### 📌 Executive Brief\n"
            "[A concise, engaging 2-3 sentence overview of the page's main topic and purpose]\n\n"
            "### 🔑 Key Highlights\n"
            "- [Highlight point 1]\n"
            "- [Highlight point 2]\n"
            "- [Highlight point 3]\n"
            "- [Highlight point 4]\n"
            "- [Highlight point 5]\n\n"
            "### 🏷️ Main Topics\n"
            "#[Topic1] #[Topic2] #[Topic3]\n\n"
            f"Webpage Content:\n{truncated_text}"
        )
        return await async_query_llm(prompt)
    except Exception as e:
        print(f"[SUMMARY WARNING] Live summary generation failed (using offline fallback): {e}")
        return offline_summarize(text, max_sentences)

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
            content = await extract_by_text(page, req.target_text, req.extraction_type)
        else:
            content = extract_content(page, req.css_selector, req.extraction_type)

        title = req.title or page.css("title::text").get() or "Scraped Page"

        if req.save_to_library:
            database.save_scrape(req.url, title, content, req.extraction_type)

        return {
            "status": page.status,
            "url": page.url,
            "title": title,
            "content": content,
            "summary": ""
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SummarizeRequest(BaseModel):
    content: str

@app.post("/api/summarize")
async def run_summarize(req: SummarizeRequest):
    try:
        summary = await generate_summary(req.content)
        return {"summary": summary}
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
        summary = await generate_summary(content)

        # Extract links automatically
        links = []
        seen_urls = set()
        for link_elem in page.css("a"):
            try:
                href = link_elem.attrib.get("href")
                if href:
                    from urllib.parse import urljoin
                    absolute_url = urljoin(page.url, href)
                    if absolute_url not in seen_urls and absolute_url.startswith(("http://", "https://")):
                        text = link_elem.get_all_text(strip=True)
                        if not text:
                            text = absolute_url
                        links.append({
                            "text": text,
                            "url": absolute_url
                        })
                        seen_urls.add(absolute_url)
            except Exception:
                pass

        # Extract outline sections
        sections = []
        for h in page.css("h1, h2, h3"):
            try:
                text = h.get_all_text(strip=True)
                if text and len(text) > 2:
                    h_html = h.get().lower()
                    tag = "H"
                    if h_html.startswith("<h1"):
                        tag = "H1"
                    elif h_html.startswith("<h2"):
                        tag = "H2"
                    elif h_html.startswith("<h3"):
                        tag = "H3"
                    sections.append({
                        "text": text,
                        "tag": tag
                      })
            except Exception:
                pass

        return {
            "status": page.status,
            "url": page.url,
            "title": page.css("title::text").get() or "Scraped Page",
            "content": content,
            "summary": summary,
            "links": links[:120],
            "sections": sections[:60]
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

class ChatRequest(BaseModel):
    content: str
    query: str
    history: List[Dict[str, str]] = []

class SchemaRequest(BaseModel):
    content: str
    schema_description: str

class GraphRequest(BaseModel):
    content: str

current_gemini_index = 0
current_groq_index = 0

async def async_query_llm(prompt: str, json_mode: bool = False) -> str:
    global current_gemini_index, current_groq_index
    import os
    import httpx
    
    load_env_file()
    
    # Load and split Gemini keys (support comma-separated)
    gemini_env = os.getenv("GEMINI_API_KEYS") or os.getenv("GEMINI_API_KEY") or ""
    gemini_keys = [k.strip() for k in gemini_env.split(",") if k.strip()]
    
    # Load and split Groq keys (support comma-separated)
    groq_env = os.getenv("GROQ_API_KEYS") or os.getenv("GROQ_API_KEY") or ""
    groq_keys = [k.strip() for k in groq_env.split(",") if k.strip()]
    
    if not gemini_keys and not groq_keys:
        raise Exception("No active AI model keys configured. Please add GEMINI_API_KEY or GROQ_API_KEY to your .env file.")

    # Try Gemini keys with rotation
    if gemini_keys:
        num_gemini = len(gemini_keys)
        current_gemini_index = current_gemini_index % num_gemini
        last_gemini_err = None
        
        for attempt in range(num_gemini):
            idx = (current_gemini_index + attempt) % num_gemini
            g_key = gemini_keys[idx]
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={g_key}"
                headers = {"Content-Type": "application/json"}
                payload: dict = {
                    "contents": [{"parts": [{"text": prompt}]}]
                }
                if json_mode:
                    payload["generationConfig"] = {"responseMimeType": "application/json"}
                    
                async with httpx.AsyncClient() as client:
                    response = await client.post(url, json=payload, headers=headers, timeout=20.0)
                    if response.status_code == 200:
                        data = response.json()
                        res = data["candidates"][0]["content"]["parts"][0]["text"]
                        if res:
                            current_gemini_index = idx  # Keep this successful key active
                            return res.strip()
                    else:
                        try:
                            err_msg = response.json()["error"]["message"]
                            err_text = f"Gemini API Error ({response.status_code}): {err_msg}"
                        except Exception:
                            err_text = f"Gemini API Error ({response.status_code}): {response.text}"
                        
                        last_gemini_err = Exception(err_text)
                        print(f"[ROTATION] Gemini Key {idx+1}/{num_gemini} failed: {err_text}. Rotating...", flush=True)
            except Exception as e:
                last_gemini_err = e
                print(f"[ROTATION] Gemini Key {idx+1}/{num_gemini} error: {e}. Rotating...", flush=True)

        # Move to next key for the next overall call if all failed
        current_gemini_index = (current_gemini_index + 1) % num_gemini
        
        if last_gemini_err and not groq_keys:
            raise last_gemini_err

    # Try Groq keys with rotation
    if groq_keys:
        num_groq = len(groq_keys)
        current_groq_index = current_groq_index % num_groq
        last_groq_err = None
        
        for attempt in range(num_groq):
            idx = (current_groq_index + attempt) % num_groq
            gr_key = groq_keys[idx]
            try:
                url = "https://api.groq.com/openai/v1/chat/completions"
                headers = {
                    "Authorization": f"Bearer {gr_key}",
                    "Content-Type": "application/json"
                }
                payload: dict = {
                    "model": "llama-3.3-70b-versatile",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2
                }
                if json_mode:
                    payload["response_format"] = {"type": "json_object"}
                    
                async with httpx.AsyncClient() as client:
                    response = await client.post(url, json=payload, headers=headers, timeout=20.0)
                    if response.status_code == 200:
                        data = response.json()
                        res = data["choices"][0]["message"]["content"]
                        if res:
                            current_groq_index = idx  # Keep this successful key active
                            return res.strip()
                    else:
                        try:
                            err_data = response.json()
                            err_msg = err_data["error"]["message"]
                            err_text = f"Groq API Error ({response.status_code}): {err_msg}"
                        except Exception:
                            err_text = f"Groq API Error ({response.status_code}): {response.text}"
                        
                        last_groq_err = Exception(err_text)
                        print(f"[ROTATION] Groq Key {idx+1}/{num_groq} failed: {err_text}. Rotating...", flush=True)
            except Exception as e:
                last_groq_err = e
                print(f"[ROTATION] Groq Key {idx+1}/{num_groq} error: {e}. Rotating...", flush=True)

        # Move to next key for the next overall call if all failed
        current_groq_index = (current_groq_index + 1) % num_groq
        
        if last_groq_err:
            raise last_groq_err

    raise Exception("No active AI model keys configured. Please add GEMINI_API_KEY or GROQ_API_KEY to your .env file.")

@app.post("/api/chat")
async def run_chat(req: ChatRequest):
    try:
        context = f"You are a helpful research assistant. Answer questions about the following webpage content.\n\nWebpage Content:\n{req.content[:40000]}\n"
        
        history_str = ""
        if req.history:
            history_str = "\n".join(f"{h['role'].upper()}: {h['content']}" for h in req.history) + "\n"
            
        full_prompt = f"{context}\nConversational History:\n{history_str}USER: {req.query}\nASSISTANT:"
        
        reply = await async_query_llm(full_prompt)
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/extract-schema")
async def extract_schema(req: SchemaRequest):
    import json
    try:
        prompt = (
            "You are a data extraction bot. You must extract information from the provided webpage text "
            "and format it as a valid JSON object matching the requested schema description.\n\n"
            f"Requested Schema: {req.schema_description}\n\n"
            "Format the output strictly as a JSON object. Ensure all extracted items are contained in a "
            "top-level JSON key named 'extracted_data'.\n\n"
            f"Webpage Content:\n{req.content[:40000]}"
        )
        
        reply = await async_query_llm(prompt, json_mode=True)
        parsed_json = json.loads(reply)
        return parsed_json
    except json.JSONDecodeError:
        return {"extracted_data": reply, "error": "AI response was not valid JSON, returning raw text."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/knowledge-graph")
async def extract_knowledge_graph(req: GraphRequest):
    import json
    try:
        prompt = (
            "Analyze the following webpage content and extract a knowledge graph representing the main "
            "entities, concepts, topics, or organizations mentioned, and their relationships.\n\n"
            "You MUST format the output as a valid JSON object with the following strict structure:\n"
            "{\n"
            "  \"nodes\": [\n"
            "    { \"id\": \"unique_short_id\", \"label\": \"Display Label (e.g. Scrapling)\", \"type\": \"concept|org|tech|person|metric\" }\n"
            "  ],\n"
            "  \"edges\": [\n"
            "    { \"from\": \"source_node_id\", \"to\": \"target_node_id\", \"label\": \"relationship type (e.g. bypasses)\" }\n"
            "  ]\n"
            "}\n\n"
            "Limit the response to maximum 10-15 key nodes and their edges to keep the visualization clear.\n\n"
            f"Webpage Content:\n{req.content[:40000]}"
        )
        
        reply = await async_query_llm(prompt, json_mode=True)
        parsed_json = json.loads(reply)
        return parsed_json
    except json.JSONDecodeError:
        return {
            "nodes": [
                {"id": "1", "label": "Error", "type": "concept"},
                {"id": "2", "label": "No Graph Data", "type": "concept"}
            ],
            "edges": [
                {"from": "1", "to": "2", "label": "caused by JSON parse failure"}
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

