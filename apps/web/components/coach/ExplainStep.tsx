"use client";

import Link from "next/link";
import { useState } from "react";
import { startCoachThreadAction } from "@/app/(public)/coach/actions";
import { streamCoachChat } from "@/lib/coach-client";
import { coach } from "@/lib/copy";

const copy = coach.explain;

/**
 * "Jelasin langkah ini" under one step of the project page (members only; the page does not render it for a
 * visitor). It posts `explain_step` with the step's id on a thread about this project and shows the answer right
 * below the step as plain text. Each click costs one of the member's 20 messages of the day.
 */
export function ExplainStep({ projectId, stepId }: { projectId: string; stepId: string }) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; needProfile: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function explain() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setAnswer("");
    let id = threadId;
    if (id === null) {
      try {
        const started = await startCoachThreadAction(projectId);
        if (!started.ok) {
          setAnswer(null);
          setError({ message: started.message, needProfile: false });
          setBusy(false);
          return;
        }
        id = started.threadId;
        setThreadId(id);
      } catch {
        setAnswer(null);
        setError({ message: coach.errors.unavailable, needProfile: false });
        setBusy(false);
        return;
      }
    }
    const outcome = await streamCoachChat(
      { threadId: id, message: coach.explainRequest, kind: "explain_step", stepId },
      (text) => setAnswer(text),
    );
    if (!outcome.ok) {
      setAnswer(null);
      // "bad_input" is what the route answers when there is no profile yet; the message of the route says less.
      const needProfile = outcome.code === "bad_input";
      setError({ message: needProfile ? copy.needProfile : outcome.message, needProfile });
    }
    setBusy(false);
  }

  return (
    <div className="explain-step">
      <button type="button" className="explain-step-button" disabled={busy} onClick={explain}>
        {copy.button}
      </button>
      {answer !== null ? (
        <p className="explain-step-answer" data-testid="explain-answer">
          {answer === "" ? copy.loading : answer}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="form-error">
          {error.message}
          {error.needProfile ? (
            <>
              {" "}
              <Link href="/coach">{copy.toCoach}</Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
