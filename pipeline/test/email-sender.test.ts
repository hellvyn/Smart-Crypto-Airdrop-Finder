import { describe, expect, it } from "vitest";
import { BrevoSender } from "../src/notify/email-sender.js";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body = '{"messageId":"<x@smtp-relay.mailin.fr>"}') {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(body, { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const FROM = { email: "digest@saf.test", name: "Smart Airdrop Finder" };
const MESSAGE = { to: "alice@example.test", subject: "Airdrop digest", html: "<p>hi</p>", text: "hi" };

describe("BrevoSender", () => {
  it("posts the transactional email with the api-key header and the documented body", async () => {
    const { calls, fetchImpl } = fakeFetch(201);
    const sender = new BrevoSender({ fetch: fetchImpl, apiKey: "xkeysib-secret", from: FROM });
    const result = await sender.send(MESSAGE);

    expect(result).toEqual({ ok: true, status: 201 });
    expect(calls).toHaveLength(1);
    const call = calls[0] as Call;
    expect(call.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(call.init.method).toBe("POST");
    const headers = new Headers(call.init.headers);
    expect(headers.get("api-key")).toBe("xkeysib-secret");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
    expect(JSON.parse(String(call.init.body))).toEqual({
      sender: { email: "digest@saf.test", name: "Smart Airdrop Finder" },
      to: [{ email: "alice@example.test" }],
      subject: "Airdrop digest",
      htmlContent: "<p>hi</p>",
      textContent: "hi",
    });
    // Each send is cut off by a timeout.
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns ok:false with the status for a non-201 answer", async () => {
    const { fetchImpl } = fakeFetch(400, '{"code":"invalid_parameter","message":"to is invalid: bob@example.test"}');
    const sender = new BrevoSender({ fetch: fetchImpl, apiKey: "k", from: FROM });
    expect(await sender.send(MESSAGE)).toEqual({ ok: false, status: 400 });
  });

  it("treats any 2xx other than 201 as not sent", async () => {
    const { fetchImpl } = fakeFetch(200);
    const sender = new BrevoSender({ fetch: fetchImpl, apiKey: "k", from: FROM });
    expect(await sender.send(MESSAGE)).toEqual({ ok: false, status: 200 });
  });

  it("never throws: a network error or timeout is status 0", async () => {
    const fetchImpl = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof fetch;
    const sender = new BrevoSender({ fetch: fetchImpl, apiKey: "k", from: FROM });
    expect(await sender.send(MESSAGE)).toEqual({ ok: false, status: 0 });
  });
});
