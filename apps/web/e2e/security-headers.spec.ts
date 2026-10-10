import { expect, test } from "@playwright/test";

const EXPECTED = {
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
};

for (const path of ["/", "/login", "/watchlist", "/api/wallet-activity"]) {
  test(`security headers are sent on ${path}`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    const headers = res.headers();
    for (const [key, value] of Object.entries(EXPECTED)) expect(headers[key], key).toBe(value);
  });
}
