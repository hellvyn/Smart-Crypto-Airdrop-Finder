/** A dashed placeholder for a members-only block. No button and no link: there is no signup path (#46). */
export function MemberOnly({ title }: { title: string }) {
  return (
    <div className="ui-member-only" role="group" aria-label={title}>
      Member only
    </div>
  );
}
