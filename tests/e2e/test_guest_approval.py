"""Run with: python3 -m unittest discover -s tests/e2e -p 'test_*.py'.

Uses the running app and real Cloud data, with isolated host and guest browsers.
Requires Python Playwright and Chromium; APP_URL defaults to the local preview.
"""

import os
import unittest
from pathlib import Path

from playwright.async_api import async_playwright


class GuestApprovalTest(unittest.IsolatedAsyncioTestCase):
    async def test_host_approves_guest_and_approval_survives_refresh(self):
        url = os.environ.get("APP_URL", "http://localhost:8080").rstrip("/")
        screenshots = Path("/tmp/browser/guest-approval-test")
        screenshots.mkdir(parents=True, exist_ok=True)
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            try:
                host_context = await browser.new_context(viewport={"width": 1280, "height": 1800})
                guest_context = await browser.new_context(viewport={"width": 1280, "height": 1800})
                host = await host_context.new_page()
                guest = await guest_context.new_page()
                await host.goto(url, wait_until="networkidle")
                await host.get_by_role("button", name="Start a table", exact=True).click()
                await host.get_by_role("textbox", name="Your name").fill("Approval test host")
                await host.get_by_role("button", name="Open the table", exact=True).click()
                await host.wait_for_url("**/lobby/*")
                code = host.url.rsplit("/", 1)[-1]

                await guest.goto(f"{url}/t/{code}")
                await guest.get_by_role("textbox", name="Your name").fill("Approval test guest")
                await guest.get_by_role("button", name="Join", exact=True).click()
                await guest.get_by_role("heading", name="Waiting for the host", exact=True).wait_for()
                approve = host.get_by_role("button", name="Approve", exact=True)
                await approve.wait_for()
                await host.screenshot(path=str(screenshots / "1_pending.png"))

                await approve.click()
                await approve.wait_for(state="detached")
                await guest.get_by_role("heading", name="Almost time", exact=True).wait_for()
                seated = host.get_by_role("heading", name="At the table", exact=True).locator("..")
                self.assertIn("Approval test guest", await seated.inner_text())
                await host.screenshot(path=str(screenshots / "2_approved.png"))

                # Re-read from Cloud, rather than just trusting the realtime update.
                await host.reload(wait_until="networkidle")
                await host.get_by_role("heading", name="At the table", exact=True).wait_for()
                self.assertEqual(await host.get_by_role("button", name="Approve", exact=True).count(), 0)
                seated = host.get_by_role("heading", name="At the table", exact=True).locator("..")
                self.assertIn("Approval test guest", await seated.inner_text())
                await guest.reload(wait_until="networkidle")
                await guest.get_by_role("heading", name="Almost time", exact=True).wait_for()
                self.assertEqual(await guest.get_by_role("heading", name="Waiting for the host", exact=True).count(), 0)
                await guest.screenshot(path=str(screenshots / "3_approved_after_refresh.png"))

                # An approved guest enters when the host starts the table.
                await host.get_by_role("button", name="Start", exact=True).click()
                await guest.get_by_role("button", name="Start mic", exact=True).wait_for()
                await guest.reload(wait_until="networkidle")
                mic = guest.get_by_role("button", name="Start mic", exact=True)
                await mic.wait_for()
                self.assertTrue(await mic.is_enabled())
                self.assertEqual(guest.url, f"{url}/room/{code}")
                await guest.screenshot(path=str(screenshots / "4_live_after_refresh.png"))

                # Remove only the guest this test created.
                await host.get_by_role("button", name="guests", exact=True).click()
                await host.get_by_role("button", name="Remove", exact=True).click()
                await guest.get_by_role("heading", name="You're not at this table", exact=True).wait_for()
            finally:
                await browser.close()


if __name__ == "__main__":
    unittest.main()