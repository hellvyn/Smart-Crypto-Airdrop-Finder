import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { safeNextPath } from "@/lib/safe-next";
import { signUp } from "../actions";

export const metadata = { title: "Sign up · Smart Airdrop Finder" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  return (
    <>
      <h1>Sign up</h1>
      <AuthForm action={signUp} submitLabel="Sign up">
        <input type="hidden" name="next" value={next} />
        <label>
          Email
          <input type="email" name="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input type="password" name="password" autoComplete="new-password" required />
        </label>
      </AuthForm>
      <p className="muted">
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </>
  );
}
