"""Shared page-content helpers.

Extracted from main.py so the crawler can reuse them without importing the
FastAPI app (which would be a circular import: main -> crawl_api -> crawler -> main).
main.py re-exports both names, so its existing call sites are unchanged.
"""

import re
from typing import Optional

from markdownify import markdownify


def clean_for_llm(content: str, max_chars: int = 15000) -> str:
    if not content:
        return ""
    # If it is raw HTML, strip script, style, header, footer, nav tags and get plain text/markdown
    if "<html" in content or "<body" in content or "<div" in content or "<p" in content:
        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(content, "html.parser")
            # Remove scripts, styles, metadata, header, footer and nav
            for el in soup(["script", "style", "meta", "noscript", "header", "footer", "nav"]):
                el.decompose()
            content = soup.get_text(separator="\n")
        except Exception:
            pass

    # Normalize multiple newlines to max \n\n and multiple spaces to single space
    content = re.sub(r"\n\s*\n", "\n\n", content)
    content = re.sub(r"[ \t]+", " ", content)
    return content[:max_chars].strip()


def extract_content(page, css_selector: Optional[str], extraction_type: str) -> str:
    """Pull content out of a Scrapling `Response`/`Selector` in the requested format.

    `page` is anything with the `Selector` interface, so this works for both the
    one-off fetchers used by /api/scrape and the spider responses used by crawl jobs.
    """
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
