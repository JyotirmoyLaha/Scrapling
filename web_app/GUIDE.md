# Easy Guide: Scrapling Web Dashboard

Welcome! This guide is written in simple terms to help you understand how this web app works, what all the buttons and options do, and how to use them—even if you are completely new to web scraping.

---

## 🏗️ How the App Works (The Simple Version)
Think of this web app as having three parts working together on your computer:
1. **The Screen (Frontend)**: The visual web page you see in your browser at `http://localhost:5173`. You click buttons and type search terms here.
2. **The Brain (Backend)**: A hidden helper program running in your command window at `http://127.0.0.1:8000`. When you click "Scrape", the Screen asks the Brain to go fetch the website using the Scrapling tool.
3. **The Storage Box (SQLite Database)**: A simple file named `research.db` created inside your project folder. It stores any web page data you decide to save, so you don't lose it when you turn off the app.

---

## 🖥️ Section-by-Section Guide

### 1. Scraper Console (The Main Scraper)
Use this section when you have a specific website link (URL) and want to pull text or look at a screenshot.

#### **Options You Can Choose:**
*   **Target URL**: Paste the exact website address you want to scrape (e.g., `https://quotes.toscrape.com`).
*   **Fetcher Mode (How it loads the page)**:
    *   **Stealthy**: Opens a hidden browser that acts exactly like a human user. It hides the fact that it is a script, helping you bypass anti-robot block screens (like Cloudflare). *Use this if a website blocks you.*
    *   **Dynamic**: Opens a standard browser in the background. It is great for modern websites that load content dynamically using JavaScript (like scrolling tables or interactive charts).
    *   **Static**: Directly downloads the raw text of the website without launching a browser. It is lightning fast, but it will not run JavaScript. *Use this for simple blog posts or old websites.*
*   **Extraction Format (What the saved text looks like)**:
    *   **Markdown**: Converts the page into clean, easy-to-read text with simple formatting (like bold text and list bullets). Highly recommended!
    *   **Plain Text**: Strips away all website formatting and gives you only the raw words.
    *   **Raw HTML**: Gives you the raw website code (full of tags like `<div>` and `<p>`).
*   **CSS Selector (Optional)**: If you don't want the entire web page, you can put a filter label here to extract only specific parts. E.g., putting `.quote` will only grab the quotes, leaving everything else behind.
*   **Scrape Custom Title (Optional)**: Give your scrape a name (like "My Project Data"). If left blank, it will just use the title of the website.
*   **Target Text / Keyword (Optional)**: Search for a specific word or phrase on the page. If provided, the scraper will extract text only from the element containing this phrase, and the screenshot will zoom in and snap *only* that specific element!
*   **Save to Research Library**: Check this box if you want the app to automatically save the results to your history database.
*   **Spoof Google Referer (CF/WAF bypass)**:
    When checked, Scrapling adds a `Referer: https://www.google.com/` header to the request—making the target website think you arrived from a Google search result instead of loading the page directly.
    *   **How it helps**: Many Cloudflare and generic WAF configurations have a "known referer" allowlist. Traffic that appears to come from Google is less likely to be challenged because real humans almost always arrive via search engines. Enabling this dramatically raises success rates on Cloudflare-protected and basic-WAF sites.
    *   **When to leave it OFF**: Some advanced WAFs (notably **Imperva / Distil Networks**, used by Reuters, Bloomberg, etc.) actually *flag* requests that carry a Google referer without a matching Google search cookie trail. For those sites the fake referer triggers an instant `401 Unauthorized` block. **If you get a 401 with the box checked, uncheck it and try again.**
    *   **Rule of thumb**: Try with it **unchecked** first. If the site returns a Cloudflare challenge or a generic 403, check the box and re-scrape.

#### **Action Buttons & Output Tabs:**
*   **Scrape Content**: Downloads the page's text (or targeted text) and populates three output tabs:
    *   **Extracted Content**: Displays the full downloaded text or Markdown.
    *   **Brief Summary**: Displays a beautifully formatted content briefing of the scraped text. It automatically filters out web boilerplate (headers, footers, logins, cookies) and extracts the most informative sections.
        *   **Local NLP Ranker**: The default offline engine uses a keyword-density scoring model with lead bias and redundancy reduction to select key highlights and core themes.
        *   **AI-Powered Summaries (Optional)**: You can upgrade this to an advanced AI brief. Simply create a file named `.env` in the `web_app/backend/` folder and add your Gemini or Groq API Key:
            ```env
            # To use Google Gemini:
            GEMINI_API_KEY=your_actual_gemini_key_here

            # OR to use Groq (Llama-3.3-70b):
            GROQ_API_KEY=your_actual_groq_key_here
            ```
            Once configured, Scrapling will automatically query your chosen AI service to generate a professional Executive Brief, Key Highlights, and Main Topic tags.
    *   **Raw Response**: Displays the raw JSON metadata returned from the server.
*   **Capture Screenshot**: Takes a screenshot of the entire webpage (or just the targeted text element area) and displays it in the **Live Screenshot** tab.

---

### 2. Discovery Engine (Web Search & Link Finder)
Use this section if you do **not** have a specific website link, but want to search the web for information using keywords, a paragraph, or a news snippet.

#### **How to Use It:**
1. Type search terms or paste a block of text into the search box.
2. **Real-time Validation Indicator**: The app checks your text instantly and displays a colored status dot below the text box:
   * 🔴 **Red (Invalid)**: The query is empty or too short (less than 3 characters). The search button is locked.
   * 🟡 **Yellow (Warning)**: You pasted a direct website URL instead of a search query. It warns you to use the **Scraper Console** tab instead so you get direct access!
   * 🟢 **Green (Valid)**: The query is fully valid and ready to search!
3. Click **Find Verified URLs & Links**.
4. **Web Availability / Verification Card**: The app checks the search results and shows a status card at the top:
   * 🟢 **Green (Verified)**: The phrase is active and available on the web. It tells you how many websites publish this context.
   * 🔴 **Red (Unverified)**: The phrase is not found on the web. It alerts you that no matching website references exist.
5. **On each search result, you can click**:
   *   **Open in Scraper Console**: Sends that link directly to the main scraper page so you can inspect it further.
   *   **Quick Preview**: Downloads the page contents right there on the search screen, so you can read it quickly without leaving.
   *   **Seed Crawl**: Sends that link to the **Crawl Engine** as the starting point of a multi-page crawl.
   *   **Visit Link**: Opens the website in a new tab.
6. **Crawl all N results**: The button next to the results count sends *every* result to the Crawl Engine at once. Depth is set to 0 automatically, so it fetches exactly those pages and does not wander off following their links.

---

### 3. Crawl Engine (Multi-Page Crawler)

#### **What is it? (Read this first)**
The Scraper Console grabs **one** page — you give it a link, it gives you that page.

The Crawl Engine grabs **many** pages automatically. You give it a starting link. It reads that page, finds all the links on it, then goes and reads those pages too. Then it finds the links on *those* pages, and keeps going.

Think of it like a helper you send to a library. Instead of saying *"bring me this one book"*, you say *"start with this book, then also bring me every book it mentions"*.

It works in the background, so you can sit and watch a table fill up with pages as it collects them.

**A quick example**: give it `https://quotes.toscrape.com`, set depth to `1`, set pages to `20`. It reads the homepage, sees links to author pages and tag pages, and reads those too — stopping once it has 20 pages.

---

#### **Part 1: Filling in the Form**

**The basics (you must fill these in):**

*   **Job Name** — Just a name so you can recognise this run later in the list. Like "Blog posts" or "Product pages". If you leave it blank it will be called "Untitled Crawl".
*   **Start URLs** — The link (or links) to begin from. **Put one link on each line** if you have several. The crawler starts at all of them.

**How to load the pages:**

*   **Fetcher Mode** — Exactly the same three choices as the Scraper Console:
    *   **Static** — Fastest. Just downloads the text. Use this first.
    *   **Dynamic** — Opens a real browser. Use it if the site needs JavaScript to show its content.
    *   **Stealthy** — Opens a browser that hides the fact it's a robot. Use it if the site blocks you.
    *   ℹ️ The two browser modes need their browser downloaded once first. If a crawl fails saying **"Executable doesn't exist"**, the message tells you the exact command to run. Static mode never needs this.
*   **Output Format** — What the saved text should look like: **Markdown** (clean and readable, recommended), **Plain Text** (just words), or **Raw HTML** (the website's code).

**Controlling how far and how much (the important part):**

*   **Max Depth** — How many "hops" away from your starting page it is allowed to travel. This is the setting people get wrong most often, so here it is in plain terms:
    *   `0` = **only** the pages you typed in. It will not follow a single link.
    *   `1` = your pages, **plus** every page they link to.
    *   `2` = all of the above, **plus** every page *those* pages link to.
    *   ⚠️ Be careful: each step multiplies. If a page has 30 links, and each of those has 30 links, depth `2` is already 900 pages. **Start with 1.**
*   **Max Pages** — A hard stop. Once it has collected this many pages it finishes, no matter what depth would have allowed. **This is your safety net** — it is what stops a crawl running away with you. Keep it small (10–50) while you are still testing your settings.
*   **Concurrency** — How many pages it fetches *at the same time*. `1` means one after another (slow but gentle). `4` is a good default. Higher numbers finish faster but put more load on the website.
*   **Delay (s)** — How many seconds to wait between requests. `0` means no waiting. Setting this to `0.5` or `1` is the polite thing to do on small websites, so you don't overwhelm them.
*   **Page Timeout (s)** — How long to wait for one page before giving up on it. The default `45` seconds suits most sites. **If you see pages "timed out" in the failures list, raise this** — some sites genuinely take 30 seconds or more to finish loading, and a page abandoned at 30s is lost even though it was about to arrive. Lowering it makes a crawl of a broken site fail faster.
*   **Max Chars / Page** — How much text to keep from each page. The default `20000` characters is plenty for most articles. If pages are getting cut off at the end, raise it. Set it to `0` to keep the whole page no matter how long.

**Picking out only what you want (all optional — leave blank to keep everything):**

*   **Content Selector** — If you only want part of each page, put a CSS label here. For example, typing `article` saves only the article text and throws away the menus, sidebars and footers. Same idea as the Scraper Console's CSS Selector.
*   **Find Links Only Within** — This does **not** change what gets saved. It changes **where the crawler looks for links to follow next**. For example, typing `.pagination` means it only follows the "next page" buttons and ignores every other link on the page. Very useful for walking through a list page by page.
*   **Allow URL Patterns** — Only follow links that contain this text. Separate several with commas. Example: typing `/blog/` means it only visits links with `/blog/` in the address.
*   **Deny URL Patterns** — Never follow links containing this text. Example: typing `/login` skips sign-in pages. **If a link matches both Allow and Deny, Deny wins.**
    *   *(Note: these two boxes accept "regular expressions" — a pattern-matching mini-language. You don't need to know it. Typing plain text like `/blog/` works perfectly well. If you type something the computer can't understand, the app will tell you straight away and won't start the crawl.)*
*   **Allowed Domains** — Which websites it is allowed to visit. **Leave this blank** and it automatically stays on the same website(s) as your starting links — which is almost always what you want, and stops it wandering off onto Facebook or Twitter. Only fill it in if you deliberately want it to visit other sites too.

**The tick boxes:**

*   **Follow links** — Tick it (the default) and it follows links. Untick it and it fetches only your starting links and nothing else. *(Unticking this does the same thing as setting depth to 0.)*
*   **Obey robots.txt** — Most websites publish a small file called `robots.txt` saying which pages robots are welcome to visit. Ticked (the default) means you respect those wishes. **Leave this on** unless the website is your own. (If a site has no such file, nothing is blocked.)
*   **Headless** — Whether the browser stays invisible. Ticked (the default) means you won't see a browser window pop up. Only applies to Dynamic and Stealthy modes.
*   **Solve Cloudflare** — Tries to get past "Checking your browser..." block screens. Only available in Stealthy mode.
*   **Spoof Google Referer** — **Ticked by default**, because a lot of sites reject visitors who arrive with no referer at all, and this makes you look like you came from a Google search. Leave it on unless you hit trouble. ⚠️ Two things to know: it only applies to your **starting links** (pages found by following links send the page they came from instead, which is more natural anyway), and a few advanced protections actually dislike a Google referer — if you get `401` errors, untick it. (More detail in the Scraper Console section above.)
*   **Block trackers** — **Ticked by default** (browser modes only). Blocks analytics, advertising and chat-widget services. These never contain page content, but they are a common reason a page sits "loading" for half a minute — blocking them makes slow sites noticeably faster and prevents some timeouts outright.
*   **Resumable** — Saves its progress every 30 seconds. If you stop the crawl, you can carry on later from roughly where it left off instead of starting over.

> **Redirects are handled for you.** If your start URL redirects somewhere else — `morth.nic.in` sends you to `morth.gov.in`, or a bare domain sends you to `www.` — the crawler notices and allows the site it actually landed on. Without that, every link on the page would count as "a different website" and the crawl would stop after one page.

---

#### **Part 2: Watching It Run**

Press **Launch Crawl**. Your job appears in the **Crawl Jobs** table straight away.

**What the coloured status labels mean:**

| Label | What is happening |
| --- | --- |
| **queued** | Waiting its turn. Only **two** crawls run at once, so a third one waits here until a slot frees up. |
| **running** | Working right now (it has a little blinking dot). |
| **completed** | Finished on its own — it either ran out of pages to visit or hit your Max Pages limit. |
| **stopped** | You pressed Stop, or the app was closed while it was running. |
| **paused** | Stopped, but it had "Resumable" ticked, so its progress was saved. |
| **failed** | Something went wrong, **or the crawl captured no pages at all**. The reason is shown right underneath in orange, along with what to try next. |

> A crawl that finishes without capturing a single page is reported as **failed**, not "completed" — because nothing was achieved and you need to know why. Common reasons it will tell you about: the site refused every request (HTTP 403), robots.txt disallowed everything, the address was unreachable, or every link found pointed at another domain.

**The live panel underneath** updates every second while the crawl runs:

*   **The number tiles** tell you, at a glance:
    *   **Pages** — how many pages it has saved so far.
    *   **Requests** — how many times it has asked the website for something.
    *   **Req / Sec** — its current speed.
    *   **Elapsed** — how long it has been running.
    *   **Queued** — how many links it has found but not visited yet. This number going *down* means it is finishing up.
    *   **In Flight** — how many pages it is downloading at this exact moment.
    *   **Failed** — pages that wouldn't load.
    *   **Blocked** — times the website refused it.
    *   **Offsite** — links it skipped for pointing at a different website.
    *   **Robots Blocked** — links it skipped because the site's robots.txt asked it not to visit.
    *   **Downloaded** — total amount of data pulled down.
*   **The small coloured chips** (like `200 × 12`) count the website's replies. `200` in green means "page delivered fine" — that's what you want to see. Orange `404` means "page not found". Red `500` means the website itself had an error.
*   **The table at the bottom** adds a row for every page the moment it arrives, newest at the top. **Click any row** and it opens up to show you the text it captured, plus buttons to **Open in Scraper** or **Visit** the page in a new tab.

**The Stop button** ends the crawl politely: it lets the pages it is already downloading finish first, rather than yanking the plug. **Nothing you have already collected is lost** — everything saved so far stays.

---

#### **Part 3: Getting Your Data Out**

The buttons at the top-right of the live panel:

*   **JSON** — One structured file with everything. Best if you're going to feed it into another program.
*   **JSONL** — The same data, but one page per line. Handy for very large crawls and data tools.
*   **CSV** — A spreadsheet file. **Double-click it and it opens straight in Excel**, with accented and non-English characters intact.
*   **MD** — One single readable Markdown document containing every page, one after another, each with its title and link.

Clicking any of these downloads a real file to your computer (look in your Downloads folder).

*   **Send to Library** — Copies the crawled pages into your **Research Library** tab, so they sit alongside everything else you've saved and can be searched together. It saves up to 100 pages at a time and asks you to confirm first.

---

#### **When a site still won't crawl properly**

Most sites work once you pick the right Fetcher Mode. These are the cases that genuinely stay hard, and what to do about each:

| Symptom | What is going on | What helps |
| --- | --- | --- |
| Pages load, but **no links are followed** | The site's menus are built by JavaScript with no real links behind them (common with Angular/React government and corporate sites). There is nothing for a crawler to follow. | Feed the URLs in yourself: paste a list into **Start URLs**, or use the **Discovery Engine** to search the site and hit "Crawl all N results". |
| Everything returns **403** | The site is refusing automated visitors. | Stealthy mode, tick **Spoof Google Referer** and **Solve Cloudflare**, and raise **Delay** to 1–2 seconds so you look less like a machine. |
| Pages **time out** | The site is simply slow. | Raise **Page Timeout**, lower **Concurrency**. |
| Content is behind a **login** | The crawler is not signed in. | Use the **Persistent Sessions** tab to log in and browse manually — crawling cannot do this for you. |
| The site **asks not to be crawled** | Its robots.txt disallows it. | Respect it. Only untick **Obey robots.txt** for sites you own. |

There is no setting that makes every website work. Sites that require a login, hide everything behind JavaScript actions, or actively defend against automation will still need either manual URLs or a per-site approach.

---

> ⚠️ **One thing to watch out for**
> Start the backend the normal way, using `run_backend.bat`.
> If you happen to start it with the `--reload` option (a developer setting), then **saving any file on your computer restarts the backend and kills any crawl that is running**. Ordinary use is unaffected — just don't use `--reload` while crawling.

---

### 4. Persistent Sessions (Active Browser Manager)
Standard scraping opens a website, grabs the data, and immediately closes the window. **Sessions** let you keep a virtual browser tab open in the background.

#### **Why Use Sessions?**
*   If you need to log into a website and keep the login active.
*   If you need to click through multiple pages in order without losing your login cookies.

#### **How to Use It:**
1. Choose the browser type (Stealthy or Dynamic).
2. Uncheck **Headless Mode** if you want the actual browser window to pop up on your computer screen so you can watch it work.
3. **Spoof Google Referer**: Same concept as in the Scraper Console—adds a Google referer header. Leave it off unless you are hitting Cloudflare walls. See the detailed explanation in the Scraper Console section above.
4. Click **Open Session**. A session card with a code name (like `a7c2b9`) will appear.
5. Click on that session card to open the fetch box, type a URL, and click **Fetch via Session**.
6. When you are completely finished, click the red **Close** button to shut down the browser and free up your computer's RAM.

---

### 5. Research Library (Your Saved History)
This is a catalog of all the web page data you have saved.

*   **Search box**: Type keywords or parts of a link to instantly find a specific saved scrape.
*   **Copy button**: Instantly copies the text of that saved scrape so you can paste it into Word, Notepad, or an LLM.
*   **Delete button**: Permanently removes the scrape from your history.
*   **Clicking a card**: Opens a full-screen window to read the saved content comfortably.

---

### 6. Script Generator (Python Code Exporter)
Once you have tested options on the screen and found a combination that works, you might want to automate it using a Python script. This tab does the coding work for you.

It translates your screen choices into three clean Python scripts that you can copy-paste and run on your computer:
1. **One-Off Fetch Script**: A simple script to scrape a single page.
2. **Persistent Session Block**: A script showing how to keep cookies and stay logged in.
3. **Asynchronous Spider Template**: A production-grade script that can scroll through pages, run concurrently, and save the results directly to a local JSON file.
