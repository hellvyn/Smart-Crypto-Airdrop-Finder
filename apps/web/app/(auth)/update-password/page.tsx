import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { getUser } from "@/lib/auth";
import { updatePassword } from "../actions";

export const metadata = { title: "Set a new password · Smart Airdrop Finder" };

/** Reached from the password-reset link (/auth/callback signs the user in first), or while logged in. */
export default async function UpdatePasswordPage() {
  const user = await getUser();
  if (!user) {
    return (
      <>
        <h1>Set a new password</h1>
        <p>
          Open the link from your password reset email first, or <Link href="/reset-password">request a new one</Link>
          .
        </p>
      </>
    );
  }
  return (
    <>
      <h1>Set a new password</h1>
      <AuthForm action={updatePassword} submitLabel="Update password">
        <label>
          New password
          <input type="password" name="password" autoComplete="new-password" required />
        </label>
      </AuthForm>
    </>
  );
}
