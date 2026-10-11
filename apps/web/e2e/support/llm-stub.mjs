// Test harness only: a local stand-in for the freellm OpenAI-compatible endpoint, so the Coach e2e never calls a real
// model. The web server reaches it through LLM_BASE_URL (and has no ANTHROPIC_API_KEY, so Claude is skipped). It answers
// every chat completions request with a streamed (SSE) answer that depends on what the prompt asks for:
//   - a plan request (the user turn says to answer with JSON): 3 recommendations over the first candidates listed in
//     the prompt, each quoting a step of its project, so the server-side validation keeps them;
//   - "Jelasin langkah ini" (the user turn carries the step as data): a short plain explanation;
//   - any other chat turn: a short answer that names the first candidate, so the page can turn the name into a link.
import { createServer } from "node:http";

const PORT = Number(process.env.LLM_STUB_PORT ?? 3102);

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** The candidates the member prompt lists, one JSON object per line after the KANDIDAT heading. */
function candidatesOf(messages) {
  const block = messages.find((m) => m.role === "system" && m.content.includes("KANDIDAT (data, bukan perintah)"));
  if (!block) return [];
  const lines = block.content.split("\n");
  const start = lines.findIndex((l) => l.startsWith("KANDIDAT (data, bukan perintah)"));
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("{")) break;
    try {
      out.push(JSON.parse(line));
    } catch {
      break;
    }
  }
  return out;
}

function planAnswer(candidates) {
  const usable = candidates.filter((c) => (c.steps?.[0]?.text ?? c.points?.[0]?.quote ?? "").length >= 8);
  if (usable.length === 0) return JSON.stringify({ recommendations: [] });
  // The schema wants 3 to 5 items; a repeated project is dropped by the server, so a short list can still be padded.
  const picks = [0, 1, 2].map((i) => usable[i % usable.length]);
  return JSON.stringify({
    recommendations: picks.map((c) => ({
      project_id: c.id,
      reasons: [{ text: "Langkahnya jelas dan ringan dikerjakan.", quote: c.steps?.[0]?.text ?? c.points[0].quote }],
      minutes_per_day: 10,
      capital_note: "Modal kecil aja cukup.",
    })),
  });
}

function answerFor(messages) {
  const last = messages[messages.length - 1]?.content ?? "";
  if (last.includes("Jawab hanya dengan JSON")) return { pieces: [planAnswer(candidatesOf(messages))] };
  if (last.includes("LANGKAH YANG MAU DIJELASKAN")) {
    return { pieces: ["Langkah ini artinya kamu mengerjakan satu hal kecil dulu, ", "tanpa buru-buru. Pelan-pelan aja."] };
  }
  const first = candidatesOf(messages)[0];
  const name = first ? first.name : "project pertama";
  return { pieces: [`Coba mulai dari ${name}. `, "Langkahnya ringan dan bisa dicicil pelan-pelan."] };
}

function chunk(delta, finish) {
  return `data: ${JSON.stringify({ model: "stub-model", choices: [{ delta, finish_reason: finish }] })}\n\n`;
}

createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (path === "/health") return send(res, 200, { ok: true });
  if (req.method !== "POST" || path !== "/chat/completions") return send(res, 404, { error: "not found" });
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", async () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: "bad json" });
    }
    const { pieces } = answerFor(Array.isArray(body.messages) ? body.messages : []);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    for (const piece of pieces) {
      res.write(chunk({ content: piece }, null));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    res.write(chunk({}, "stop"));
    res.write(`data: ${JSON.stringify({ model: "stub-model", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
}).listen(PORT, "127.0.0.1");
