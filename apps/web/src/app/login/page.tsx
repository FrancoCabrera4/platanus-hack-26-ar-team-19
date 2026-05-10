"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@repo/ui/components/ui/button";
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";
import { ApiError, login } from "@/lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      router.push("/explore");
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "login_failed";
      setError(code === "invalid_credentials" ? "Email o contraseña incorrectos." : "No se pudo iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-foreground text-background pl-8 pr-12 py-12 flex-col justify-between">
        <div>
          <img src="/logo-dark.svg" alt="negocIA" className="h-24 -ml-4" />
        </div>
        <div>
          <p
            className="text-4xl leading-tight mb-6"
            style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
          >
            El marketplace que compra por ti,
            <br />
            negocia por ti, y paga por ti.
          </p>
          <p className="text-background/60 max-w-md">
            Decile qué querés vender o comprar. La IA se encarga de encontrar el mejor precio.
          </p>
        </div>
        <p className="text-background/40 text-sm">© 2026 negocIA</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2
              className="text-3xl mb-2"
              style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
            >
              Iniciar sesión
            </h2>
            <p className="text-muted-foreground text-sm">
              Ingresá tu email y contraseña para continuar.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            No tenés cuenta?{" "}
            <Link href="/signup" className="text-foreground font-medium hover:underline">
              Crear cuenta
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
