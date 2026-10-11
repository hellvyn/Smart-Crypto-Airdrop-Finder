"use client";

import { errors } from "@/lib/copy";

/** A page that failed to render: the generic Indonesian message and a retry. The error itself is never shown. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <p role="alert">{errors.generic}</p>
      <button type="button" onClick={() => reset()}>
        {errors.retry}
      </button>
    </>
  );
}
