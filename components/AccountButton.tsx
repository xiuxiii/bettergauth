"use client";

import Link from "next/link";
import AccountAvatar from "@/components/AccountAvatar";
import { useAccount } from "@/lib/account/useAccount";

/**
 * Home's account entry, beside Settings: "Sign in" when signed out, the
 * student's avatar when signed in. Nothing at all when accounts are off, or
 * until the session is known (no signed-out flash for a signed-in student).
 */
export default function AccountButton({ className = "" }: { className?: string }) {
  const account = useAccount();
  if (account.status === "signedOut") {
    return (
      <Link
        href="/signin"
        className={`flex h-11 items-center rounded-full px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-ink ${className}`}
      >
        Sign in
      </Link>
    );
  }
  if (account.status !== "signedIn") return null;
  return (
    <Link
      href="/account"
      aria-label="Your account"
      className={`flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-slate-100 ${className}`}
    >
      <AccountAvatar name={account.name} email={account.email} url={account.avatarUrl} size={30} />
    </Link>
  );
}
