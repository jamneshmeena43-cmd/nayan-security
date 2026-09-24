import json
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:8091")
OUT = "/tmp/nayan-browser-results.json"


def overflow(page):
    return page.evaluate("""() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflow: doc.scrollWidth - doc.clientWidth };
    }""")


def main():
    results = []
    stamp = str(os.getpid())
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for name, width in (("mobile", 390), ("desktop", 1440)):
            page = browser.new_page(viewport={"width": width, "height": 900})
            errors = []
            page.on("pageerror", lambda err: errors.append(str(err)))
            page.goto(BASE + "/", wait_until="domcontentloaded")
            page.wait_for_selector("text=NAYAN")
            page.wait_for_timeout(600)
            title = page.locator("h1").first.inner_text()
            home = overflow(page)
            page.screenshot(path=f"/tmp/home-{name}.png")
            page.goto(BASE + "/auth?tab=register", wait_until="domcontentloaded")
            page.wait_for_selector("#auth-form")
            email = f"{name}-{stamp}@example.com"
            phone = ("91" if name == "mobile" else "92") + stamp.zfill(8)[-8:]
            page.fill("input[name='name']", "Browser Customer")
            page.fill("input[name='email']", email)
            page.fill("input[name='phone']", phone)
            page.fill("input[name='password']", "Browser1234")
            page.click("#auth-form button[type='submit']")
            page.wait_for_timeout(800)
            if "/profile" not in page.url:
                raise SystemExit(f"register failed {name}: {page.locator('#toast').inner_text()} url={page.url}")
            page.goto(BASE + "/product/psu-12v", wait_until="domcontentloaded")
            page.wait_for_selector("[data-action='add-cart']", timeout=8000)
            page.click("[data-action='add-cart']")
            page.goto(BASE + "/checkout", wait_until="domcontentloaded")
            page.wait_for_selector("#checkout-form")
            page.fill("input[name='name']", "Browser Customer")
            page.fill("input[name='phone']", phone)
            page.fill("textarea[name='address']", "Station Road")
            page.click("#checkout-form button[value='server']")
            page.wait_for_timeout(1200)
            if "/orders/" not in page.url:
                raise SystemExit(f"order failed {name}: {page.locator('#toast').inner_text()} url={page.url}")
            body = page.locator("body").inner_text()
            page.screenshot(path=f"/tmp/order-{name}.png")
            page.goto(BASE + "/admin/security", wait_until="domcontentloaded")
            page.wait_for_timeout(500)
            denied = page.locator("body").inner_text()
            results.append({
                "viewport": name,
                "width": width,
                "title": title,
                "home_overflow": home,
                "order_says_unpaid": "not paid" in body.lower() or "UNPAID" in body,
                "order_claims_success": "payment successful" in body.lower(),
                "security_denied": "cannot read the security log" in denied.lower(),
                "page_errors": errors,
            })
            page.close()
        admin = browser.new_page(viewport={"width": 1280, "height": 900})
        admin.goto(BASE + "/auth", wait_until="domcontentloaded")
        admin.wait_for_selector("input[name='password']")
        admin.fill("input[name='email']", "browser-admin@example.com")
        admin.fill("input[name='password']", "BrowserAdmin123")
        admin.click("#auth-form button[type='submit']")
        admin.wait_for_timeout(800)
        if "/profile" not in admin.url:
            raise SystemExit("admin login failed: " + admin.locator("#toast").inner_text())
        admin.goto(BASE + "/admin/security", wait_until="domcontentloaded")
        admin.wait_for_selector("h1")
        admin.wait_for_timeout(400)
        text = admin.locator("body").inner_text()
        admin.screenshot(path="/tmp/security-admin.png")
        results.append({
            "viewport": "admin-desktop",
            "security_heading": admin.locator("h1").first.inner_text(),
            "shows_sessions": "Active sessions" in text,
            "shows_password": "BrowserAdmin123" in text or "password_hash" in text,
            "overflow": overflow(admin),
        })
        browser.close()
    print(json.dumps(results, indent=2))
    with open(OUT, "w") as handle:
        json.dump(results, handle, indent=2)


if __name__ == "__main__":
    main()
