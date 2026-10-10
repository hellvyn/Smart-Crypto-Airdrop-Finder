import { AuthForm } from "@/components/auth-form";
import { safeNextPath } from "@/lib/safe-next";
import { logIn } from "../actions";

export const metadata = { title: "Log in · Smart Airdrop Finder" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  return (
    <>
      <h1>Log in</h1>
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
      <p className="muted">Belum punya akses? Hubungi admin.</p>
    </>
  );
}
