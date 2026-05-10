"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveCard, getMe } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const MP_PUBLIC_KEY = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "";

const COUNTRIES = [
  { code: "AR", name: "Argentina", flag: "\u{1F1E6}\u{1F1F7}" },
  { code: "CL", name: "Chile", flag: "\u{1F1E8}\u{1F1F1}" },
  { code: "CO", name: "Colombia", flag: "\u{1F1E8}\u{1F1F4}" },
  { code: "MX", name: "México", flag: "\u{1F1F2}\u{1F1FD}" },
  { code: "BR", name: "Brasil", flag: "\u{1F1E7}\u{1F1F7}" },
  { code: "PE", name: "Perú", flag: "\u{1F1F5}\u{1F1EA}" },
  { code: "UY", name: "Uruguay", flag: "\u{1F1FA}\u{1F1FE}" },
];

type Step = "country" | "mercadopago" | "card" | "ready";

declare global {
  interface Window {
    MercadoPago: new (key: string) => {
      createCardToken: (data: {
        cardNumber: string;
        cardholderName: string;
        cardExpirationMonth: string;
        cardExpirationYear: string;
        securityCode: string;
        identificationType: string;
        identificationNumber: string;
      }) => Promise<{ id: string }>;
    };
  }
}

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>("country");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [mpConnected, setMpConnected] = useState(false);
  const [mpLoading, setMpLoading] = useState(false);
  const [cardSaved, setCardSaved] = useState(false);
  const [cardLastFour, setCardLastFour] = useState("");
  const [cardLoading, setCardLoading] = useState(false);
  const [cardError, setCardError] = useState("");
  const [cardForm, setCardForm] = useState({
    number: "",
    name: "",
    expMonth: "",
    expYear: "",
    cvv: "",
    docType: "DNI",
    docNumber: "",
  });
  const router = useRouter();

  // Detect state from DB + OAuth callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mpResult = params.get("mp");

    getMe().then((user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      if (mpResult === "ok" || user.mpConnected) {
        setMpConnected(true);
        setStep("card");
      } else if (mpResult === "error") {
        setStep("mercadopago");
      }
      if (mpResult) {
        window.history.replaceState({}, "", "/onboarding");
      }
    }).catch(() => {
      router.replace("/login");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load MercadoPago.js SDK
  useEffect(() => {
    if (document.getElementById("mp-sdk")) return;
    const script = document.createElement("script");
    script.id = "mp-sdk";
    script.src = "https://sdk.mercadopago.com/js/v2";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  async function connectMP() {
    setMpLoading(true);
    try {
      const res = await fetch(`${API_URL}/payments/mp/connect`, { credentials: "include" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setMpLoading(false);
    }
  }

  async function handleSaveCard() {
    setCardLoading(true);
    setCardError("");
    try {
      if (!window.MercadoPago) throw new Error("MercadoPago SDK not loaded");
      const mp = new window.MercadoPago(MP_PUBLIC_KEY);
      const token = await mp.createCardToken({
        cardNumber: cardForm.number.replace(/\s/g, ""),
        cardholderName: cardForm.name,
        cardExpirationMonth: cardForm.expMonth,
        cardExpirationYear: cardForm.expYear,
        securityCode: cardForm.cvv,
        identificationType: cardForm.docType,
        identificationNumber: cardForm.docNumber,
      });
      const result = await saveCard(token.id);
      setCardSaved(true);
      setCardLastFour(result.lastFour);
    } catch (err) {
      setCardError((err as Error).message || "Error al guardar la tarjeta");
    } finally {
      setCardLoading(false);
    }
  }

  function goToExplore() {
    localStorage.setItem("am_onboarding_done", "1");
    router.push("/explore");
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-10">
          {["country", "mercadopago", "card", "ready"].map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={`h-1.5 rounded-full flex-1 transition-colors ${
                  (step === "country" && i === 0) ||
                  (step === "mercadopago" && i <= 1) ||
                  (step === "card" && i <= 2) ||
                  (step === "ready" && i <= 3)
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
            <h1 className="text-3xl mb-2 tracking-tight" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
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

        {/* Step 2: Connect MercadoPago */}
        {step === "mercadopago" && (
          <div>
            <h1 className="text-3xl mb-2 tracking-tight" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
              Conectá Mercado Pago
            </h1>
            <p className="text-muted-foreground text-sm mb-8">
              Vinculá tu cuenta para que tu agente pueda cobrar y pagar automáticamente.
            </p>
            <div className="rounded-lg border border-border p-6 mb-6">
              <div className="flex items-center gap-4 mb-5">
                <img src="/mercado-pago.svg" alt="Mercado Pago" className="w-12 h-12" />
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
                    <span>Tu agente podrá pagar automáticamente cuando cierre un trato</span>
                  </div>
                  <div className="flex items-start gap-3 text-sm text-muted-foreground">
                    <span className="text-primary mt-0.5">→</span>
                    <span>Recibí pagos cuando alguien compre tus productos</span>
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
                  onClick={connectMP}
                  disabled={mpLoading}
                  className="w-full h-11 bg-[#009ee3] text-white rounded-lg text-sm font-medium hover:bg-[#007eb8] transition-colors disabled:opacity-60"
                >
                  {mpLoading ? "Redirigiendo..." : "Conectar con Mercado Pago"}
                </button>
                <button
                  onClick={() => setStep("card")}
                  className="w-full h-11 text-muted-foreground text-sm hover:text-foreground transition-colors"
                >
                  Omitir por ahora
                </button>
              </div>
            ) : (
              <button
                onClick={() => setStep("card")}
                className="w-full h-11 bg-foreground text-background rounded-lg text-sm font-medium hover:bg-foreground/90 transition-colors"
              >
                Continuar
              </button>
            )}
          </div>
        )}

        {/* Step 3: Card tokenization */}
        {step === "card" && (
          <div>
            <h1 className="text-3xl mb-2 tracking-tight" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
              Guardá tu tarjeta
            </h1>
            <p className="text-muted-foreground text-sm mb-8">
              Para que tu agente pueda pagar automáticamente cuando cierre un trato.
            </p>

            {cardSaved ? (
              <div className="rounded-lg border border-accent bg-accent/5 p-6 mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center">
                    <span className="text-accent-foreground text-lg font-bold">✓</span>
                  </div>
                  <div>
                    <p className="font-semibold">Tarjeta guardada</p>
                    <p className="text-sm text-muted-foreground">
                      **** **** **** {cardLastFour}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Número de tarjeta</label>
                  <input
                    type="text"
                    placeholder="5031 7557 3453 0604"
                    value={cardForm.number}
                    onChange={(e) => setCardForm({ ...cardForm, number: e.target.value })}
                    className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    maxLength={19}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Nombre del titular</label>
                  <input
                    type="text"
                    placeholder="APRO"
                    value={cardForm.name}
                    onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })}
                    className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Mes</label>
                    <input
                      type="text"
                      placeholder="11"
                      value={cardForm.expMonth}
                      onChange={(e) => setCardForm({ ...cardForm, expMonth: e.target.value })}
                      className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      maxLength={2}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Año</label>
                    <input
                      type="text"
                      placeholder="2025"
                      value={cardForm.expYear}
                      onChange={(e) => setCardForm({ ...cardForm, expYear: e.target.value })}
                      className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      maxLength={4}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">CVV</label>
                    <input
                      type="text"
                      placeholder="123"
                      value={cardForm.cvv}
                      onChange={(e) => setCardForm({ ...cardForm, cvv: e.target.value })}
                      className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      maxLength={4}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Tipo de documento</label>
                    <select
                      value={cardForm.docType}
                      onChange={(e) => setCardForm({ ...cardForm, docType: e.target.value })}
                      className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="DNI">DNI</option>
                      <option value="CI">CI</option>
                      <option value="LC">LC</option>
                      <option value="LE">LE</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Número de documento</label>
                    <input
                      type="text"
                      placeholder="12345678"
                      value={cardForm.docNumber}
                      onChange={(e) => setCardForm({ ...cardForm, docNumber: e.target.value })}
                      className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
                {cardError && (
                  <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                    {cardError}
                  </p>
                )}
              </div>
            )}

            {cardSaved ? (
              <button
                onClick={() => setStep("ready")}
                className="w-full h-11 bg-foreground text-background rounded-lg text-sm font-medium hover:bg-foreground/90 transition-colors"
              >
                Continuar
              </button>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={handleSaveCard}
                  disabled={cardLoading || !cardForm.number || !cardForm.name || !cardForm.cvv}
                  className="w-full h-11 bg-[#009ee3] text-white rounded-lg text-sm font-medium hover:bg-[#007eb8] transition-colors disabled:opacity-40"
                >
                  {cardLoading ? "Guardando..." : "Guardar tarjeta"}
                </button>
                <button
                  onClick={() => setStep("ready")}
                  className="w-full h-11 text-muted-foreground text-sm hover:text-foreground transition-colors"
                >
                  Omitir por ahora
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Ready */}
        {step === "ready" && (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-accent mx-auto mb-6 flex items-center justify-center">
              <span className="text-accent-foreground text-2xl font-bold">✓</span>
            </div>
            <h1 className="text-3xl mb-2 tracking-tight" style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}>
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
            onClick={() => {
              if (step === "card") setStep("mercadopago");
              else if (step === "mercadopago") setStep("country");
            }}
            className="mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto block"
          >
            ← Volver
          </button>
        )}
      </div>
    </div>
  );
}
