# 🕸️ Scrapling Web Dashboard

Welcome to the **Scrapling Web Dashboard**, a modern, stealthy, and adaptive visual workspace for high-performance web scraping, page automation, and AI-powered content briefing.

This dashboard exposes the full power of the **Scrapling library** via an intuitive, cyberpunk-themed web interface, allowing you to scrape, screenshot, and summarize any web page under the radar.

---

## 🚀 Quick Start (Launch the App)

You can launch both parts of the application using the preconfigured Windows batch files in the root folder:

### 1. Start the API Brain (Backend)
Double-click **`run_backend.bat`**. This launches a FastAPI server running locally at:
`http://localhost:8000`

### 2. Start the Interface (Frontend)
Double-click **`run_frontend.bat`**. This spins up the Vite + React dev server and opens the dashboard in your default browser at:
`http://localhost:5173`

### 3. One-time: install the browsers (only needed for Dynamic / Stealthy modes)
**Static** mode needs nothing. The two browser-backed modes each use a *different* browser stack with its own pinned Chromium build, so they are installed separately. From `web_app/backend`:

```bash
venv\Scripts\python.exe -m playwright  install chromium   # for Dynamic mode
venv\Scripts\python.exe -m patchright  install chromium   # for Stealthy mode
```

> Note: `scrapling install` only covers the **playwright** half. If Dynamic mode works but every Stealthy run fails with *"Executable doesn't exist"*, you are missing the **patchright** browser — run the second command above.

---

## 🔑 AI Briefing & API Keys Setup

The dashboard features an **Executive Brief Summary** tab that parses and summarizes scraped content. It is powered by a dual-engine architecture:
- **Local NLP Ranker (Offline)**: Uses a density-scoring algorithm with lead bias and duplicate filtration to outline key highlights automatically.
- **AI Briefs (Online)**: Leverages LLMs for abstractive summaries.

To enable advanced AI briefings, configure your keys in the newly created env file:
👉 **[web_app/backend/.env](file:///c:/Users/HP/Downloads/Scrapling/web_app/backend/.env)**

```env
# To use Google Gemini:
GEMINI_API_KEY=your_actual_gemini_key_here

# OR to use Groq (Llama-3.3-70b):
GROQ_API_KEY=your_actual_groq_key_here
```

*The system will automatically detect which key is configured (Gemini takes priority, falling back to Groq, and then to the local NLP model).*

---

## 🖥️ Dashboard Features

### 1. Scraper Console
- **Stealthy Fetching**: Spoofs TLS client fingerprints and masks WebGL/Canvas to bypass anti-bot shields like Cloudflare and Akamai.
- **Targeted Scraping**: Narrow down elements using custom CSS/XPath selectors.
- **Dynamic Elements**: Choose *Dynamic Mode* to load pages that execute heavy JavaScript.
- **Visual Verification**: Take live, element-focused screenshots of any webpage to verify loading status.

### 2. Discovery Engine
- Search the web for topics or news snippets.
- Instantly verify availability and citation density of phrases.
- Push search result URLs directly into the Scraper Console — or seed a whole crawl from them.

### 3. Crawl Engine
- **Real multi-page crawls** built on `scrapling.spiders`: depth limiting, link rules, allowed domains, robots.txt compliance, per-domain concurrency and delays.
- **Background jobs** with live progress streamed over Server-Sent Events — pages, requests/sec, queue depth, in-flight tasks, HTTP status breakdown and failure counters, all updating in real time.
- **Graceful stop** that drains in-flight requests instead of dropping them, plus optional checkpointing so a stopped crawl can resume.
- **Jobs survive restarts**: crawl state and every scraped page are persisted to SQLite, and interrupted jobs are reconciled on startup.
- **Export** any crawl as JSON, JSONL, CSV, or Markdown, or push the results straight into the Research Library.

### 4. Persistent Sessions
- Spin up background browser sessions.
- Log into pages, maintain cookie states, and navigate multi-step flows without getting logged out or blocked.

### 5. Research Library
- Save your scraped articles, HTML contents, or Markdown captures.
- Cataloged in a local database (`research.db`) with instant full-text search.

### 6. Script Generator
- Exports your exact dashboard scraping actions into ready-to-run Python code templates, including:
  - Simple one-off fetch scripts.
  - Stateful session blocks.
  - Concurrency-ready async spider pipelines.

---

## 📦 Developer Notice: Repository Files

Your root repository folder contains developer-oriented files (like `pyproject.toml`, `setup.cfg`, `tox.ini`, and `scrapling/` source folder). 

> [!IMPORTANT]
> **Do not delete these files!**
> 1. The dashboard backend imports the local `scrapling` library, which is installed in your python environment in **editable mode** pointing to this directory. Deleting these files will break the app imports.
> 2. Keeping these files ensures you can seamlessly pull updates from the upstream repository (`git pull`) without encountering merge conflicts.

---

## 📘 Core Scrapling Library Documentation
For advanced customization, CLI controls, or automated pipelines, read the official library docs:
- **Official Documentation**: [scrapling.readthedocs.io](https://scrapling.readthedocs.io)
- **Interactive Shell CLI**: Run `scrapling shell` in your console.
