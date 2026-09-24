# 🔧 Troubleshooting — "I unzipped the folder, now what?"

Every common problem, its **exact symptom**, why it happens, and the fix.
The first section alone solves it for about 90% of people.

---

## ⚡ Read this first (fixes 90% of problems)

If you received this as a **zip or folder** (rather than cloning from GitHub), then **two things in it cannot work on your computer**, no matter what:

1. **The `venv` folder** — it has the original computer's absolute paths baked into it (`C:\Users\HP\...`). Those paths do not exist on your machine.
2. **The browsers** — the browsers used by Stealthy and Dynamic modes are **not stored inside the project folder**. They live in `%LOCALAPPDATA%\ms-playwright`, so they were never in the zip.

**One-time fix — these four commands solve both:**

Open the `web_app\backend` folder, type `cmd` in the address bar and press Enter, then run:

```cmd
python -m venv venv --clear
venv\Scripts\python.exe -m pip install -r requirements.txt
venv\Scripts\python.exe -m playwright install chromium
venv\Scripts\python.exe -m patchright install chromium
```

The first run takes 5–10 minutes. After that, `run_backend.bat` and `run_frontend.bat` will work normally.

> If the project includes a **`setup.bat`**, you don't need to run the above manually — just double-click it, it does exactly this for you.

---

## 🖥️ Requirements (install these first)

| Needed | Where from | Watch out for |
| --- | --- | --- |
| **Python 3.10+** | https://www.python.org/downloads/ | You **must** tick **"Add Python to PATH"** during install |
| **Node.js LTS** | https://nodejs.org/ | Default options are fine |

To check, open a **new** Command Prompt:

```cmd
python --version
npm --version
```

Both should print a version. If you get `'python' is not recognized`, see **Problem 1**.

---

## Problem 1 — `'python' is not recognized as an internal or external command`

**Symptom:** You run `run_backend.bat` or `setup.bat` and the window shows this line, then closes.

**Why:** Python either isn't installed, or "Add to PATH" wasn't ticked during installation.

**Fix:**
1. Install Python from https://www.python.org/downloads/
2. **On the very first installer screen**, tick the **"Add python.exe to PATH"** box at the bottom. This is the most commonly missed step.
3. After installing, **close all Command Prompt windows and open new ones** — PATH does not update in already-open windows.
4. Confirm with `python --version`.

> The Microsoft Store version of Python also works, but occasionally causes permission issues. If you hit trouble, use the one from python.org.

---

## Problem 2 — `'npm' is not recognized`

**Symptom:** `run_frontend.bat` shows this error immediately.

**Fix:** Install the **LTS** version from https://nodejs.org/, then close and reopen your terminal. Check with `npm --version`.

---

## Problem 3 — `ERROR: No virtualenv found at web_app\backend\venv`

**Symptom:** `run_backend.bat` prints exactly this.

**Why:** The `venv` folder doesn't exist, or wasn't included in the zip.

**Fix:** Run the four commands from the **"Read this first"** section above, or run `setup.bat`.

---

## Problem 4 — The backend window closes instantly / `ModuleNotFoundError`

**Symptom:** You run `run_backend.bat`, a black window flashes and disappears. Or you see `ModuleNotFoundError: No module named 'fastapi'` or `'scrapling'`.

**Why:** This is the case described at the top — the `venv` came from someone else's computer, and the paths inside it are invalid on yours.

**Fix:**
```cmd
cd web_app\backend
python -m venv venv --clear
venv\Scripts\python.exe -m pip install -r requirements.txt
```

> `--clear` wipes the broken environment and builds a fresh one. This is safe — none of your scraped data is deleted, that lives separately in `research.db`.

**To read the error before the window closes:** open `cmd` in the project folder and type `run_backend.bat` there. The window will stay open and show the full error.

---

## Problem 5 — Stealthy/Dynamic crawl fails: `Executable doesn't exist`

**Symptom:** The job shows **failed**, with an error like:

```
BrowserType.launch_persistent_context: Executable doesn't exist at
C:\Users\...\AppData\Local\ms-playwright\chromium-1223\chrome-win64\chrome.exe
```

**Why:** The browser isn't installed. Browsers are not kept inside the project folder — they go to `%LOCALAPPDATA%\ms-playwright`, so they never travel with a zip.

**Fix — run both commands; one alone is not enough:**
```cmd
cd web_app\backend
venv\Scripts\python.exe -m playwright install chromium
venv\Scripts\python.exe -m patchright install chromium
```

> **This is the single most confusing part of the setup:** **Dynamic** mode uses *playwright*, **Stealthy** mode uses *patchright*, and each pins a **different** Chromium build. That's why you often see **Dynamic working while every Stealthy run fails** — it means the patchright browser is missing. Note that `scrapling install` only installs the playwright one, **not** patchright.

**Workaround in the meantime:** **Static** mode needs no browser at all and always works.

---

## Problem 6 — `Port 8000 is already in use` / `Address already in use`

**Why:** A backend is already running somewhere (you forgot to close an old window), or another app has taken the port.

**Fix — kill the old process:**
```cmd
netstat -ano | findstr :8000
taskkill /PID <the number in the last column> /F
```

Do the same with `:5173` for the frontend.

Simplest option: close every black window, then run both `.bat` files again.

---

## Problem 7 — Dashboard opens but everything is empty / "Failed to fetch"

**Symptom:** `http://localhost:5173` loads and the UI appears, but every button returns "Failed to fetch".

**Why:** The frontend is running but the **backend is not**. You need both.

**Fix:**
1. Check that the `run_backend.bat` window is **still open** — it should say `Application startup complete`.
2. Open `http://localhost:8000/docs` in your browser. If the API page loads, the backend is fine. If it doesn't, the backend is down — see **Problem 4**.

> **Both windows must stay open** the whole time you're using the app.

---

## Problem 8 — Crawl says "completed" but 0 pages, or CHARS = 0

**Why:** The site builds its content with JavaScript. Static mode doesn't run JavaScript, so it receives an empty shell.

**The app tells you this itself** — an amber warning appears: *"This site almost certainly renders its content with JavaScript..."*

**Fix:** Switch **Fetcher Mode** to **Stealthy** and run it again. (If this is your first time using Stealthy, you'll need the browsers from **Problem 5**.)

---

## Problem 9 — Crawl fails: "The site refused every request (HTTP 403)"

**Why:** The site is blocking automated visitors.

**Fix — try these in order:**
1. Tick **Spoof Google Referer** (it's on by default — if you unticked it, turn it back on). Many sites reject requests that arrive with no referer at all.
2. Switch **Fetcher Mode** to **Stealthy**.
3. Tick **Solve Cloudflare**.
4. Set **Delay** to `1`–`2` seconds. Hitting a site fast makes a block much more likely.

---

## Problem 10 — Pages are timing out / the crawl is very slow

**Symptom:** The FAILED counter climbs, errors mention `Timeout ... exceeded`. Or REQ/SEC sits around `0.01`.

**Why:** The site is genuinely slow — some take 30+ seconds to deliver a single page.

**Fix:**
- Raise **Page Timeout** from `45` to `90` or `120`.
- Lower **Concurrency** (`4` → `2`) so pages aren't competing for bandwidth.
- Leave **Block trackers** ticked — analytics and ad scripts are the usual reason a page hangs.

---

## Problem 11 — Crawl stops after 1 page, "No links were found"

**Why:** One of two reasons:
1. The site's menus are built by JavaScript with no real links behind them (very common on government and corporate sites). There is genuinely nothing for a crawler to follow.
2. Your **Allow/Deny patterns** or **Allowed Domains** are filtering everything out.

**Fix:**
- Leave **Allowed Domains** empty — the app works it out from your start URL, and handles redirects (like `nic.in` → `gov.in`) automatically.
- Clear the **Allow/Deny patterns** and try again.
- If the site really is JavaScript-only, supply the URLs yourself: paste a list into **Start URLs**, or use the **Discovery Engine** to search and click **"Crawl all N results"**.

---

## Problem 12 — AI Summary isn't working

**Symptom:** Summaries appear but feel basic.

**Why:** No API key is configured. **This is normal** — the app works without one, using its built-in offline summarizer.

**Fix (optional):** Open `web_app\backend\.env` and add **your own** free key from any one of:

- Groq — https://console.groq.com/keys
- Gemini — https://aistudio.google.com/
- NVIDIA — https://build.nvidia.com/
- OpenRouter — https://openrouter.ai/keys

One is enough. Save the file and restart the backend.

> ⚠️ **Don't use anyone else's keys.** If the zip arrived with a `.env` containing someone else's keys, delete them and add your own — otherwise you're spending their quota and their money.

---

## Problem 13 — A crawl vanished mid-run / "Interrupted by backend restart"

**Why:** The backend restarted while the crawl was running. The usual cause is running the backend with `--reload` and then saving a file.

**Fix:** Always start the backend with `run_backend.bat`. Whatever the job had already scraped is kept — you don't lose everything.

---

## Problem 14 — `research.db` has grown very large

**Why:** Every crawled page is stored in it. This reaches hundreds of MB easily.

**Fix:** Clean up from inside the app — **Delete** old jobs in the **Crawl Jobs** table, and remove unwanted entries from the **Research Library**. Export anything you want to keep as **JSON/CSV/MD** first.

---

## 🆘 Nothing works — the nuclear option

Rebuilds everything from scratch. **No scraped data is deleted** — that lives separately in `research.db`:

```cmd
cd web_app\backend
rmdir /s /q venv
python -m venv venv
venv\Scripts\python.exe -m pip install -r requirements.txt
venv\Scripts\python.exe -m playwright install chromium
venv\Scripts\python.exe -m patchright install chromium

cd ..\frontend
rmdir /s /q node_modules
npm install
```

Then run `run_backend.bat` and `run_frontend.bat`.

---

## 📋 Before asking for help, send this

1. Which `.bat` you ran, and the **full error text** (a screenshot is fine)
2. The output of `python --version` and `npm --version`
3. Whether both windows are open
4. Which site and which Fetcher Mode you were trying

> **Tip:** instead of double-clicking a `.bat`, run it from `cmd`. The window won't close on the error, so you can read the whole message.
