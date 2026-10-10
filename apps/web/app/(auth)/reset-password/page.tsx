import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { requestPasswordReset } from "../actions";

export const metadata = { title: "Reset password · Smart Airdrop Finder" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1>Reset your password</h1>
      <p className="muted">We will email you a link to set a new password.</p>
      <AuthForm action={requestPasswordReset} submitLabel="Send reset link">
        <label>
          Email
          <input type="email" name="email" autoComplete="email" required />
        </label>
      </AuthForm>
      <p className="muted">
        <Link href="/login">Back to log in</Link>
      </p>
    </>
  );
}
