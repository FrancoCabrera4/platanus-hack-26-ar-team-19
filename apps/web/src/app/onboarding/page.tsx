"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const COUNTRIES = [
  { code: "AR", name: "Argentina", flag: "🇦🇷", lat: -34.6, lng: -58.4 },
  { code: "CL", name: "Chile", flag: "🇨🇱", lat: -33.4, lng: -70.6 },
  { code: "CO", name: "Colombia", flag: "🇨🇴", lat: 4.7, lng: -74.1 },
  { code: "MX", name: "México", flag: "🇲🇽", lat: 19.4, lng: -99.1 },
  { code: "BR", name: "Brasil", flag: "🇧🇷", lat: -15.8, lng: -47.9 },
  { code: "PE", name: "Perú", flag: "🇵🇪", lat: -12.0, lng: -77.0 },
  { code: "UY", name: "Uruguay", flag: "🇺🇾", lat: -34.9, lng: -56.2 },
];

type Step = "country" | "mercadopago" | "ready";

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>("country");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [mpConnected, setMpConnected] = useState(false);
  const router = useRouter();

  function finishOnboarding() {
    setStep("ready");
  }

  function goToExplore() {
    localStorage.setItem("am_onboarding_done", "1");
    localStorage.setItem("am_mp_connected", mpConnected ? "1" : "0");
    router.push("/explore");
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-10">
          {["country", "mercadopago", "ready"].map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={`h-1.5 rounded-full flex-1 transition-colors ${
                  (step === "country" && i === 0) ||
                  (step === "mercadopago" && i <= 1) ||
                  (step === "ready" && i <= 2)
                    ? "bg-primary"
                    : "bg-border"
                }`}
              />
            </div>
          ))}
        </div>

        {/* Step 1: Country */}
        {step === "country" && (
          <div>
            <h1
              className="text-3xl mb-2 tracking-tight"
              style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
            >
              Dónde estás?
            </h1>
            <p className="text-muted-foreground text-sm mb-8">
              Elegí tu país para mostrarte productos y precios relevantes.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-8">
              {COUNTRIES.map((country) => (
                <button
                  key={country.code}
                  onClick={() => setSelectedCountry(country.code)}
                  className={`flex items-center gap-3 p-4 rounded-lg border text-left transition-all ${
                    selectedCountry === country.code
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-foreground/20 hover:bg-muted"
                  }`}
                >
                  <span className="text-2xl">{country.flag}</span>
                  <span className="font-medium text-sm">{country.name}</span>
                </button>
              ))}
            </div>

            <button
              onClick={() => selectedCountry && setStep("mercadopago")}
              disabled={!selectedCountry}
              className="w-full h-11 bg-foreground text-background rounded-lg text-sm font-medium disabled:opacity-30 hover:bg-foreground/90 transition-colors"
            >
              Continuar
            </button>
          </div>
        )}

        {/* Step 2: Mercado Pago */}
        {step === "mercadopago" && (
          <div>
            <h1
              className="text-3xl mb-2 tracking-tight"
              style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
            >
              Conectá Mercado Pago
            </h1>
            <p className="text-muted-foreground text-sm mb-8">
                  En esta demo lo simulamos para dejar listo el flujo de pagos sin bloquear el uso.
            </p>

            <div className="rounded-lg border border-border p-6 mb-6">
              <div className="flex items-center gap-4 mb-5">
                <img src="/mercado-pago.svg" alt="Mercado Pago" className="w-12 h-12 rounded-lg" />
                <div>
                  <p className="font-semibold">Mercado Pago</p>
                  <p className="text-sm text-muted-foreground">
                    {mpConnected ? "Cuenta vinculada" : "No vinculado"}
                  </p>
                </div>
                {mpConnected && (
                  <div className="ml-auto w-6 h-6 rounded-full bg-accent flex items-center justify-center">
                    <span className="text-accent-foreground text-xs font-bold">✓</span>
                  </div>
                )}
              </div>

              {!mpConnected && (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 text-sm text-muted-foreground">
                    <span className="text-primary mt-0.5">→</span>
                    <span>Marcar tu cuenta como lista para recibir pagos cuando cierres una venta</span>
                  </div>
                  <div className="flex items-start gap-3 text-sm text-muted-foreground">
                    <span className="text-primary mt-0.5">→</span>
                    <span>Simular el pago cuando tu agente cierre una compra</span>
                  </div>
                  <div className="flex items-start gap-3 text-sm text-muted-foreground">
                    <span className="text-primary mt-0.5">→</span>
                    <span>Tus datos financieros nunca se comparten con otros usuarios</span>
                  </div>
                </div>
              )}
            </div>

            {!mpConnected ? (
              <div className="space-y-3">
                <button
                  onClick={() => setMpConnected(true)}
                  className="w-full h-11 bg-[#009ee3] text-white rounded-lg text-sm font-medium hover:bg-[#007eb8] transition-colors"
                >
                  Conectar con Mercado Pago
                </button>
                <button
                  onClick={finishOnboarding}
                  className="w-full h-11 text-muted-foreground text-sm hover:text-foreground transition-colors"
                >
                  Omitir por ahora
                </button>
              </div>
            ) : (
              <button
                onClick={finishOnboarding}
                className="w-full h-11 bg-foreground text-background rounded-lg text-sm font-medium hover:bg-foreground/90 transition-colors"
              >
                Continuar
              </button>
            )}
          </div>
        )}

        {/* Step 3: Ready */}
        {step === "ready" && (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-accent mx-auto mb-6 flex items-center justify-center">
              <span className="text-accent-foreground text-2xl font-bold">✓</span>
            </div>
            <h1
              className="text-3xl mb-2 tracking-tight"
              style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
            >
              Todo listo
            </h1>
            <p className="text-muted-foreground text-sm mb-8 max-w-xs mx-auto">
              Tu cuenta está configurada. Explorá productos o hablá con tu agente para empezar a comprar o vender.
            </p>

            <div className="space-y-3">
              <button
                onClick={goToExplore}
                className="w-full h-11 bg-foreground text-background rounded-lg text-sm font-medium hover:bg-foreground/90 transition-colors"
              >
                Explorar productos
              </button>
              <button
                  onClick={goToExplore}
                className="w-full h-11 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                Hablar con mi agente
              </button>
            </div>
          </div>
        )}

        {/* Back button */}
        {step !== "country" && step !== "ready" && (
          <button
            onClick={() => setStep(step === "mercadopago" ? "country" : "mercadopago")}
            className="mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto block"
          >
            ← Volver
          </button>
        )}
      </div>
    </div>
  );
}
