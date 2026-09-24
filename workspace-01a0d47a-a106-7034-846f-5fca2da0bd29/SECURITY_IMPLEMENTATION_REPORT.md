# SECURITY IMPLEMENTATION REPORT

NAYAN SECURITY is not claimed to be unhackable. This report lists what is enforced on the server, what was actually tested, and what still depends on external configuration.

## Features implemented

- Existing customer SPA is kept. CCTV remains the primary category. Glass, solar, electrical, AC and networking are not promoted.
- Sample shops, professionals, reviews and catalog prices stay labeled as samples. The live preview database has no seeded customers, orders, payments or settlements.
- Accounts: customer, professional, seller and admin. Passwords are bcrypt hashes. There is no built-in default admin password.
- Sessions are HttpOnly cookies with expiry and logout. CSRF is required on cookie-authenticated writes. The payment webhook is the exception and must carry an HMAC.
- Admin roles: SUPER_ADMIN, OPERATIONS_ADMIN, FINANCE_ADMIN, SUPPORT_ADMIN, SERVICE_MANAGER, PRODUCT_MANAGER, CONTENT_MANAGER. Sensitive admin APIs check the role on the server. A hidden URL is not access.
- Product orders are priced on the server in paise. Client price, commission and a browser “success” flag are ignored.
- Payment is marked paid only after HMAC confirmation or a verified webhook whose amount matches the order. Duplicate webhook event ids are ignored. Settlements are created only after that verification. Commission is calculated on the server. Refunds cannot exceed the verified amount and are permission-checked.
- Uploads are checked for type and size, stored under a server filename, and are not executed. Download is limited to the owner or an admin with customer-read permission.
- Audit and security events redact passwords and secrets. The admin Security view shows recent sign-ins, failed logins, suspicious events, admin actions and active sessions.
- SQLite backups can be created by a super admin. Restore refuses a path outside the backup folder. It is not a public API.
- Headers: Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. HSTS is sent only when ENABLE_HSTS=1 and the request is HTTPS. Frame protection uses CSP frame-ancestors and does not set X-Frame-Options: DENY, so the preview iframe is not blocked.

## APIs protected

- `/api/auth/*` — register, login, logout, session, forgot-password request. Admin registration is rejected. Login errors do not reveal whether the account exists. Repeated failures lock the account.
- `/api/orders` and `/api/orders/{id}` — ownership: customer sees own orders, seller sees own lines, professional sees assigned jobs, admin needs `orders.read`. Other reads return 404.
- `/api/orders/{id}/status` — payment status cannot be set here. Customer can cancel only an unpaid confirmed order.
- `/api/payments/initiate` — returns 503 and does not mark paid when gateway keys are missing.
- `/api/payments/confirm` — requires a matching HMAC. `{success: true}` without a signature is rejected.
- `/api/payments/webhook` — HMAC over the raw body, amount check, idempotent event id.
- `/api/refunds`, `/api/settlements`, `/api/commission-rules` — finance permission. Sellers cannot edit commission or totals.
- `/api/products` — a seller can edit only their own products, and only after approval.
- `/api/uploads` — authenticated, CSRF, type and size checks.
- `/api/admin/security`, `/api/admin/users`, `/api/admin/backups` — admin permission. Support can read the security view. Support cannot change commission.

## Auth and RBAC status

Implemented and checked on the server. Frontend menu hiding is not the control. The preview process has no `ADMIN_EMAIL` or `ADMIN_PASSWORD`, so no super admin exists until those environment values are set and the process is restarted.

## Payment status

Not live. Razorpay order creation is implemented and used only when `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set. Without them, checkout saves an unpaid order and the initiate call returns `gateway_not_configured`. Cashfree is not connected. No card data is collected in the browser.

## Upload status

JPEG, PNG, GIF, WEBP and PDF only, 5 MB maximum, server-chosen filename, nosniff on download. The booking form can show progress, preview, retry and remove when the user is signed in. Service booking itself is still a device draft, not a server job.

## Database status

SQLite with foreign keys, integer paise, and stored historical line prices. Parameterized ORM queries. The preview file is `data/nayan.db` and is not served over HTTP. This is not a hosted Postgres deployment.

## Tests performed

These were executed. Results were not invented.

- `python3 -m pytest tests/test_security.py -q` — 12 passed. Covered password hashing, lockout, logout, admin auth and RBAC, commission permission, price tampering, IDOR, CSRF, webhook rejection and idempotency, refund settlement adjustment, cross-seller product edit, upload rejection, security headers, secret-file blocking, stored-script stripping, and backup path rejection.
- Browser flow on a temporary server, viewports 390 and 1440: register, place an order, page says unpaid, no “payment successful”, customer security view denied, no page errors, no horizontal overflow.
- Admin browser check: Security page shows sessions and does not show the password.
- Layout sweep of the live preview at 360 and 1920 on home, services, shop, product, cart, checkout, orders, auth, security, booking, professionals and support: overflow 0, no page errors.
- Live preview checks: `/api/health` 200, `/api/admin/security` 401 without a session, `/.env` and `/backend/config.py` 404, no `X-Frame-Options` deny header, CSP includes `frame-ancestors`.

Not run: a live Razorpay or Cashfree capture, email or SMS delivery, a production HTTPS/HSTS deployment, multi-server rate limiting, or a third-party penetration test.

## Remaining production dependencies

- Set `SECRET_KEY`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first super admin can exist. Do not commit them.
- Set Razorpay keys and `PAYMENT_WEBHOOK_SECRET`, and point the gateway webhook at `/api/payments/webhook`. Cashfree still needs an adapter.
- Put the app behind HTTPS, then set `ENABLE_HSTS=1` and `SECURE_COOKIES=1`.
- Replace SQLite and the in-memory rate limiter before more than one server process.
- Connect email before password reset can be delivered. SMS/OTP is intentionally not accepted.
- Schedule copies of `data/backups`, and test a restore on a spare machine. The web app does not offer public restore.
- Service booking, assignment and customer confirmation of a visit are not a complete server workflow yet. Product checkout is.
