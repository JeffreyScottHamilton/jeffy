"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function Unlock() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      setError("Wrong password.");
    } catch {
      setError("Couldn't reach Jeffy. Try again.");
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-[640px] flex-col px-5 pt-4">
      <h1 className="text-xl font-medium tracking-tight">Jeffy</h1>
      <form onSubmit={submit} className="mt-[20dvh] flex flex-col gap-3">
        <label htmlFor="password" className="text-[15px] text-ink-muted">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "unlock-error" : undefined}
          className="min-h-11 rounded-3xl border border-line bg-paper px-4 text-base text-ink"
        />
        {error && (
          <p id="unlock-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          className="min-h-11 rounded-full bg-cobalt px-5 text-[15px] text-white transition-colors hover:bg-cobalt-press disabled:opacity-40"
        >
          Unlock
        </button>
      </form>
    </main>
  );
}
