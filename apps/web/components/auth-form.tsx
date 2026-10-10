"use client";

import { useActionState, type ReactNode } from "react";

export type FormState = { error?: string; message?: string } | null;

/** A form bound to a Server Action. Shows Supabase's error message as-is, or the action's success message. */
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
      {state?.message ? (
        <p role="status" className="form-message">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
