import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { safeNextPath } from "@/lib/safe-next";
import { logIn } from "../actions";

export const metadata = { title: "Log in · Smart Airdrop Finder" };

const LINK_ERROR = "This link is invalid or has expired. Request a new one.";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  return (
    <>
      <h1>Log in</h1>
      {params.error === "link" ? (
        <p role="alert" className="form-error">
          {LINK_ERROR}
        </p>
      ) : null}
      <AuthForm action={logIn} submitLabel="Log in">
        <input type="hidden" name="next" value={next} />
        <label>
          Email
          <input type="email" name="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input type="password" name="password" autoComplete="current-password" required />
        </label>
      </AuthForm>
      <p className="muted">
        <Link href="/reset-password">Forgot your password?</Link> · No account?{" "}
        <Link href="/signup">Sign up</Link>
      </p>
    </>
  );
}
