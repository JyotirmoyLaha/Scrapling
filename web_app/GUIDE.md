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
   *   **Visit Link**: Opens the website in a new tab.

---

### 3. Persistent Sessions (Active Browser Manager)
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

### 4. Research Library (Your Saved History)
This is a catalog of all the web page data you have saved.

*   **Search box**: Type keywords or parts of a link to instantly find a specific saved scrape.
*   **Copy button**: Instantly copies the text of that saved scrape so you can paste it into Word, Notepad, or an LLM.
*   **Delete button**: Permanently removes the scrape from your history.
*   **Clicking a card**: Opens a full-screen window to read the saved content comfortably.

---

### 5. Script Generator (Python Code Exporter)
Once you have tested options on the screen and found a combination that works, you might want to automate it using a Python script. This tab does the coding work for you.

It translates your screen choices into three clean Python scripts that you can copy-paste and run on your computer:
1. **One-Off Fetch Script**: A simple script to scrape a single page.
2. **Persistent Session Block**: A script showing how to keep cookies and stay logged in.
3. **Asynchronous Spider Template**: A production-grade script that can scroll through pages, run concurrently, and save the results directly to a local JSON file.
