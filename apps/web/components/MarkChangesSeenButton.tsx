"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import { changes as copy } from "@/lib/copy";

/** The submit button of the "Tandai sudah dibaca" form: disabled, with its own text, while the form is being sent. */
export function MarkChangesSeenButton() {
  const { pending } = useFormStatus();
  return (
    <Button variant="secondary" type="submit" disabled={pending}>
      {pending ? copy.markSeenPending : copy.markSeen}
    </Button>
  );
}
