import { Button } from "@/components/ui";
import { coach } from "@/lib/copy";

/** "Tanya AI" on the project page: a link to the Coach about this project. Members only, nothing for a visitor. */
export function AskCoachLink({ projectId, member }: { projectId: string; member: boolean }) {
  if (!member) return null;
  return (
    <Button variant="secondary" href={`/coach?project=${encodeURIComponent(projectId)}`}>
      {coach.project.askAi}
    </Button>
  );
}
