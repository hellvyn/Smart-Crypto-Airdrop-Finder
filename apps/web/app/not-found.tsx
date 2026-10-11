import Link from "next/link";
import { errors } from "@/lib/copy";
import { LIST_PATH } from "@/lib/routes";

/** Every 404 (an unknown path, a removed page, `notFound()` for an unknown project) in Indonesian. */
export default function NotFound() {
  return (
    <>
      <h1>{errors.notFoundHeading}</h1>
      <p>{errors.notFoundText}</p>
      <p>
        <Link href={LIST_PATH}>{errors.backToList}</Link>
      </p>
    </>
  );
}
