"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@repo/ui/components/ui/button";
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // TODO: conectar con backend
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-foreground text-background p-12 flex-col justify-between">
        <div>
          <h1
            className="text-2xl"
            style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
          >
            AgentMarket
          </h1>
        </div>
        <div>
          <p
            className="text-4xl leading-tight mb-6"
            style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
          >
            Tu agente negocia,
            <br />
            vos cerrás el deal.
          </p>
          <p className="text-background/60 max-w-md">
            Decile qué querés vender o comprar. La IA se encarga de encontrar el mejor precio.
          </p>
        </div>
        <p className="text-background/40 text-sm">© 2026 AgentMarket</p>
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
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Contraseña</Label>
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground">
                  Olvidé mi contraseña
                </button>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full">
              Entrar
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
