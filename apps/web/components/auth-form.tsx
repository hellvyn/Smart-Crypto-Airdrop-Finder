"use client";

import { useActionState, type ReactNode } from "react";

/** `nonce` changes with every answer, so a one-use widget (the captcha) can start again after a refusal. */
export type FormState = { error?: string; nonce?: number } | null;

/** A form bound to a Server Action. Shows the action's error text (already mapped to Indonesian by the action). */
export function AuthForm({
  action,
  submitLabel,
  children,
  captcha,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  children: ReactNode;
  /** Shown above the button; remounted after every answer of the action. */
  captcha?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="auth-form">
      {children}
      {captcha ? <div key={state?.nonce ?? 0}>{captcha}</div> : null}
      <button type="submit" disabled={pending}>
        {submitLabel}
      </button>
      {state?.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
