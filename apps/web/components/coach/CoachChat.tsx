"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { startCoachThreadAction } from "@/app/(public)/coach/actions";
import { Button } from "@/components/ui";
import { streamCoachChat } from "@/lib/coach-client";
import { linkify, type CoachLink } from "@/lib/coach-text";
import { coach } from "@/lib/copy";

const copy = coach.chat;
const MAX_MESSAGE_CHARS = 1000;

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** Project names of this answer that link to their pages (from the server, never from the model's text). */
  links?: CoachLink[];
}

/** Text with the candidates' names as internal links. Everything else stays as plain text. */
function Linked({ text, links }: { text: string; links: CoachLink[] }) {
  return (
    <>
      {linkify(text, links).map((segment, i) =>
        segment.href ? (
          <Link key={i} href={segment.href}>
            {segment.text}
          </Link>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The chat under the plan (spec §5.3). The answer streams in as plain text; project names from the candidate list
 * become links built by the server. "Sisa X/100 pesan hari ini" and the disclaimer stay in view. With no thread yet
 * (the "Tanya AI" page), the first message opens one about `projectId`.
 */
export function CoachChat({
  threadId: initialThreadId,
  projectId,
  remaining: initialRemaining,
  initialMessages = [],
}: {
  threadId: string | null;
  projectId: string | null;
  remaining: number | null;
  initialMessages?: ChatTurn[];
}) {
  const [threadId, setThreadId] = useState(initialThreadId);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [turns, setTurns] = useState<ChatTurn[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const spent = remaining !== null && remaining <= 0;

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (busy || spent || message === "") return;
    if (message.length > MAX_MESSAGE_CHARS) {
      setError(coach.errors.bad_input);
      return;
    }
    setError(null);
    setBusy(true);
    setDraft("");
    setTurns((t) => [...t, { role: "user", text: message }, { role: "assistant", text: "" }]);
    const dropAnswer = () => setTurns((t) => t.slice(0, -1));

    let id = threadId;
    if (id === null) {
      try {
        const started = projectId === null ? null : await startCoachThreadAction(projectId);
        if (started === null || !started.ok) {
          setError(started === null ? coach.errors.not_member : started.message);
          dropAnswer();
          setBusy(false);
          return;
        }
        id = started.threadId;
        setThreadId(id);
      } catch {
        setError(coach.errors.unavailable);
        dropAnswer();
        setBusy(false);
        return;
      }
    }

    const outcome = await streamCoachChat({ threadId: id, message, kind: "chat" }, (text) =>
      setTurns((t) => [...t.slice(0, -1), { role: "assistant", text }]),
    );
    if (outcome.ok) {
      setTurns((t) => [...t.slice(0, -1), { role: "assistant", text: outcome.text, links: outcome.links }]);
      if (outcome.remaining !== null) setRemaining(outcome.remaining);
    } else {
      dropAnswer();
      setError(outcome.message);
      if (outcome.quota) setRemaining(0);
    }
    setBusy(false);
  }

  return (
    <section className="coach-chat" aria-labelledby="coach-chat-title">
      <h2 id="coach-chat-title" className="coach-section-title">
        {copy.title}
      </h2>
      <p className="muted coach-chat-meta">
        {remaining !== null ? <span data-testid="coach-remaining">{copy.remaining(remaining)}</span> : null}
        {remaining !== null ? " · " : null}
        <span>{copy.disclaimer}</span>
      </p>
      {turns.length > 0 ? (
        <ol className="coach-turns" aria-live="polite" aria-busy={busy}>
          {turns.map((turn, i) => (
            <li key={i} className="coach-turn" data-role={turn.role}>
              <span className="coach-turn-who">{turn.role === "user" ? copy.you : copy.coach}</span>
              <p data-testid={turn.role === "assistant" ? "coach-answer" : undefined} className="coach-turn-text">
                {turn.role === "assistant" ? <Linked text={turn.text} links={turn.links ?? []} /> : turn.text}
                {turn.role === "assistant" && busy && i === turns.length - 1 && turn.text === "" ? copy.sending : null}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : spent ? (
        <p role="status" className="form-error">
          {coach.errors.quota}
        </p>
      ) : null}
      <form className="coach-chat-form" onSubmit={send}>
        <label htmlFor="coach-message">{copy.label}</label>
        <textarea
          id="coach-message"
          rows={3}
          value={draft}
          disabled={busy || spent}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button variant="primary" type="submit" disabled={busy || spent}>
          {copy.send}
        </Button>
      </form>
    </section>
  );
}
