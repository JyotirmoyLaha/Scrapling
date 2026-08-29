"""The crawl runs inside an anyio task group, so real failures arrive wrapped.

Reporting the wrapper directly gives the user 'ExceptionGroup: unhandled errors in
a TaskGroup (1 sub-exception)', which says nothing -- and in the browser-not-installed
case it hides a message that states the exact fix. These pin the unwrapping.
"""

from crawl_jobs import describe_exception

PLAYWRIGHT_MSG = (
    "BrowserType.launch_persistent_context: Executable doesn't exist at "
    "C:\\Users\\HP\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe\n"
    "╔════════════════════════════════════════════════════════════╗\n"
    "║ Looks like Playwright was just installed or updated.       ║\n"
    "║ Please run the following command to download new browsers: ║\n"
    "║     patchright install                                     ║\n"
    "╚════════════════════════════════════════════════════════════╝"
)


def test_plain_exception_is_reported_as_is():
    assert describe_exception(ValueError("bad selector")) == "ValueError: bad selector"


def test_exception_group_is_unwrapped_to_its_cause():
    group = ExceptionGroup("unhandled errors in a TaskGroup", [RuntimeError("boom")])
    out = describe_exception(group)
    assert out == "RuntimeError: boom"
    assert "ExceptionGroup" not in out
    assert "sub-exception" not in out


def test_nested_groups_are_flattened():
    inner = ExceptionGroup("inner", [RuntimeError("deep")])
    outer = ExceptionGroup("outer", [inner])
    assert describe_exception(outer) == "RuntimeError: deep"


def test_multiple_causes_are_all_reported_once():
    group = ExceptionGroup(
        "g", [RuntimeError("a"), ValueError("b"), RuntimeError("a")]
    )
    out = describe_exception(group)
    assert "RuntimeError: a" in out
    assert "ValueError: b" in out
    assert out.count("RuntimeError: a") == 1  # duplicates collapsed


def test_missing_browser_gets_an_actionable_hint():
    group = ExceptionGroup("g", [RuntimeError(PLAYWRIGHT_MSG)])
    out = describe_exception(group)

    # the actionable part of the original message survives
    assert "Executable doesn't exist" in out
    # the ASCII advice banner is stripped
    assert "╔" not in out and "║" not in out
    # and we add the fix. Stealthy mode needs patchright's Chromium specifically --
    # `scrapling install` only installs playwright's, so naming it alone is wrong.
    assert "patchright install chromium" in out


def test_message_is_capped_and_single_line():
    group = ExceptionGroup("g", [RuntimeError("x" * 5000)])
    out = describe_exception(group)
    assert len(out) <= 401
    assert "\n" not in out


def test_base_exception_group_is_handled():
    # anyio produces a BaseExceptionGroup (not an ExceptionGroup) when any member
    # is a BaseException; describe_exception must unwrap those too.
    group = BaseExceptionGroup("g", [KeyboardInterrupt()])
    assert describe_exception(group) == "KeyboardInterrupt: KeyboardInterrupt"


def test_empty_message_falls_back_to_the_type_name():
    assert describe_exception(ExceptionGroup("g", [RuntimeError()])) == "RuntimeError: RuntimeError"
