"use client";

import { useEffect, useRef, useState } from "react";
import { auth } from "@/lib/copy";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void }) => string;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * The Cloudflare Turnstile box of the login form. Its token goes to the action in the hidden field `captchaToken`;
 * Supabase Auth checks it. A token works once, so the form remounts this after every answer.
 */
export function LoginCaptcha({ siteKey }: { siteKey: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState("");

  useEffect(() => {
    let widget: string | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const mount = () => {
      if (!window.turnstile || !box.current || widget !== undefined) return false;
      widget = window.turnstile.render(box.current, { sitekey: siteKey, callback: setToken, "expired-callback": () => setToken("") });
      return true;
    };
    if (!document.querySelector(`script[src="${SCRIPT}"]`)) {
      const script = document.createElement("script");
      script.src = SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
    if (!mount()) {
      timer = setInterval(() => {
        if (mount() && timer) clearInterval(timer);
      }, 200);
    }
    return () => {
      if (timer) clearInterval(timer);
      if (widget !== undefined) window.turnstile?.remove(widget);
    };
  }, [siteKey]);

  return (
    <div>
      <span className="visually-hidden">{auth.errors.captchaLabel}</span>
      <div ref={box} data-testid="login-captcha" />
      <input type="hidden" name="captchaToken" value={token} />
    </div>
  );
}
