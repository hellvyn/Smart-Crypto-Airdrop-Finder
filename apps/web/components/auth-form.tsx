"use client";

import { useActionState, type ReactNode } from "react";

export type FormState = { error?: string } | null;

/** A form bound to a Server Action. Shows the action's error text (already mapped to Indonesian by the action). */
export function AuthForm({
  action,
  submitLabel,
  children,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="auth-form">
      {children}
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
