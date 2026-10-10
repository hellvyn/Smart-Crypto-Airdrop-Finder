import Link from "next/link";
import { submitStartFarming, submitStopFarming } from "@/app/(app)/garapan/actions";
import { Button } from "@/components/ui";

/**
 * "Mulai garap" / "Berhenti garap" on the project page, next to Watch (Watch = keep an eye on it, garap = work on it
 * daily). A visitor (`farming === null`) gets a link to login that comes back to the project. Each form sends the
 * action it wants, so a double submit cannot undo itself.
 */
export function FarmButton({ projectId, slug, farming }: { projectId: string; slug: string; farming: boolean | null }) {
  if (farming === null) {
    return (
      <Button variant="primary" href={`/login?next=${encodeURIComponent(`/projects/${slug}`)}`}>
        Mulai garap
      </Button>
    );
  }
  if (!farming) {
    return (
      <form action={submitStartFarming} className="farm-button">
        <input type="hidden" name="projectId" value={projectId} />
        <Button variant="primary" type="submit">
          Mulai garap
        </Button>
      </form>
    );
  }
  return (
    <div className="farm-button">
      <form action={submitStopFarming}>
        <input type="hidden" name="projectId" value={projectId} />
        <Button variant="secondary" type="submit">
          Berhenti garap
        </Button>
      </form>
      <Link href="/garapan">Buka Garapan saya</Link>
    </div>
  );
}
