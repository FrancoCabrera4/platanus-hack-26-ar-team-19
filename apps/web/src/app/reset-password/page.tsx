"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@repo/ui/components/ui/button";
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";
import { resetPassword } from "@/lib/api";

export default function ResetPasswordPage() {
  const [token, setToken] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") ?? "";
  });
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      await resetPassword(token.trim(), password);
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-sm">
        <h1
          className="mb-2 text-3xl"
          style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
        >
          Resetear password
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Usá el token dev generado desde login.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Token</Label>
            <Input value={token} onChange={(e) => setToken(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Nueva contraseña</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <Button className="w-full" disabled={status === "loading"}>
            {status === "loading" ? "Guardando..." : "Cambiar contraseña"}
          </Button>
          {status === "success" && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              Contraseña actualizada. Ya podés iniciar sesión.
            </div>
          )}
          {status === "error" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              Token inválido o contraseña demasiado corta.
            </div>
          )}
          <Link href="/login" className="block text-center text-sm text-muted-foreground hover:text-foreground">
            Volver a login
          </Link>
        </form>
      </div>
    </main>
  );
}
