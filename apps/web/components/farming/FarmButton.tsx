import Link from "next/link";
import { submitStartFarming, submitStopFarming } from "@/app/(app)/garapan/actions";
import { Button } from "@/components/ui";
import { garapan as copy } from "@/lib/copy";

/**
 * "Mulai garap" / "Berhenti garap" on the project page, next to Watch (Watch = keep an eye on it, garap = work on it
 * daily). Farming is for signed-in members only, so a visitor (`farming === null`) gets nothing. Each form sends the
 * action it wants, so a double submit cannot undo itself.
 */
export function FarmButton({ projectId, farming }: { projectId: string; farming: boolean | null }) {
  if (farming === null) return null;
  if (!farming) {
    return (
      <form action={submitStartFarming} className="farm-button">
        <input type="hidden" name="projectId" value={projectId} />
        <Button variant="primary" type="submit">
          {copy.start}
        </Button>
      </form>
    );
  }
  return (
    <div className="farm-button">
      <form action={submitStopFarming}>
        <input type="hidden" name="projectId" value={projectId} />
        <Button variant="secondary" type="submit">
          {copy.stop}
        </Button>
      </form>
      <Link href="/garapan">{copy.open}</Link>
    </div>
  );
}
