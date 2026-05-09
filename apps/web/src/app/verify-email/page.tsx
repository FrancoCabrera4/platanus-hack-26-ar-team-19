"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@repo/ui/components/ui/button";
import { Input } from "@repo/ui/components/ui/input";
import { verifyEmail } from "@/lib/api";

export default function VerifyEmailPage() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function submit(value = token) {
    if (!value.trim()) return;
    setStatus("loading");
    try {
      await verifyEmail(value.trim());
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("token");
    if (initial) setToken(initial);
    if (initial) void submit(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-sm">
        <h1
          className="mb-2 text-3xl"
          style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
        >
          Verificar email
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Pegá el token dev que recibiste al crear la cuenta.
        </p>
        <div className="space-y-3">
          <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token" />
          <Button className="w-full" onClick={() => submit()} disabled={status === "loading"}>
            {status === "loading" ? "Verificando..." : "Verificar"}
          </Button>
          {status === "success" && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              Email verificado. Ya podés usar el agente.
            </div>
          )}
          {status === "error" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              Token inválido o vencido.
            </div>
          )}
          <Link href="/explore" className="block text-center text-sm text-muted-foreground hover:text-foreground">
            Ir a explorar
          </Link>
        </div>
      </div>
    </main>
  );
}
