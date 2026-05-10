"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getDashboard,
  getMe,
  type AuthUser,
  type DashboardNegotiation,
} from "@/lib/api";

type Tab = "sales" | "purchases";

function formatARS(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);
}

function paymentLabel(neg: DashboardNegotiation): { text: string; cls: string } {
  if (neg.paymentStatus === "approved") return { text: "Pagado", cls: "bg-emerald-100 text-emerald-800" };
  if (neg.paymentStatus === "rejected") return { text: "Pago rechazado", cls: "bg-rose-100 text-rose-800" };
  if (neg.status === "paying" || neg.paymentStatus === "pending") return { text: "Pago pendiente", cls: "bg-amber-100 text-amber-800" };
  return { text: "Cerrada", cls: "bg-emerald-100 text-emerald-800" };
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tab, setTab] = useState<Tab>("sales");
  const [sales, setSales] = useState<DashboardNegotiation[]>([]);
  const [purchases, setPurchases] = useState<DashboardNegotiation[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNeg, setOpenNeg] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then((me) => {
        if (!me) { router.replace("/login"); return; }
        setUser(me);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  const fetchDashboard = useCallback(async () => {
    try {
      const data = await getDashboard();
      setSales(data.sales);
      setPurchases(data.purchases);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const items = tab === "sales" ? sales : purchases;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border px-4 h-14 flex items-center justify-between">
        <a href="/explore">
          <img src="/logo.svg" alt="negocIA" className="h-10" />
        </a>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:block">{user?.name}</span>
          <button
            type="button"
            onClick={() => router.push("/explore")}
            className="w-8 h-8 rounded-full bg-primary flex items-center justify-center hover:scale-105 transition-transform"
          >
            <span className="text-primary-foreground text-xs font-medium">
              {(user?.name ?? "").slice(0, 2).toUpperCase()}
            </span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-4 pb-16">
        {/* Title */}
        <div className="mb-6 mt-2">
          <h1
            className="text-3xl tracking-tight"
            style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
          >
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tus negociaciones cerradas y pagos.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 bg-muted rounded-lg p-1 w-fit">
          <button
            type="button"
            onClick={() => setTab("sales")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === "sales"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Ventas {sales.length > 0 && <span className="ml-1 text-xs opacity-60">({sales.length})</span>}
          </button>
          <button
            type="button"
            onClick={() => setTab("purchases")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === "purchases"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Compras {purchases.length > 0 && <span className="ml-1 text-xs opacity-60">({purchases.length})</span>}
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl bg-white border border-black/5 p-4 animate-pulse">
                <div className="h-3 w-1/3 rounded bg-zinc-200" />
                <div className="mt-3 h-3 w-2/3 rounded bg-zinc-100" />
                <div className="mt-2 h-3 w-1/2 rounded bg-zinc-100" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground">
              {tab === "sales"
                ? "No tenés ventas cerradas todavia."
                : "No tenés compras cerradas todavia."}
            </p>
            <button
              type="button"
              onClick={() => router.push("/explore")}
              className="mt-4 px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              Ir a explorar
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((neg) => {
              const payment = paymentLabel(neg);
              const counterpart = tab === "sales" ? neg.buyer : neg.seller;
              const isOpen = openNeg === neg.id;

              return (
                <div key={neg.id} className="rounded-xl bg-white border border-black/5 overflow-hidden">
                  {/* Card header */}
                  <button
                    type="button"
                    onClick={() => setOpenNeg(isOpen ? null : neg.id)}
                    className="w-full text-left p-4 hover:bg-black/[0.02] transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {neg.product.imageUrl ? (
                        <img
                          src={neg.product.imageUrl}
                          alt={neg.product.title}
                          className="w-12 h-12 rounded-lg object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-muted shrink-0 flex items-center justify-center">
                          <span className="text-muted-foreground text-[10px]">IMG</span>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{neg.product.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {tab === "sales" ? "Comprador" : "Vendedor"}: {counterpart?.name ?? "—"}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {neg.finalPrice != null && (
                            <span className="text-xs font-bold text-foreground">{formatARS(neg.finalPrice)}</span>
                          )}
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${payment.cls}`}>
                            {payment.text}
                          </span>
                        </div>
                      </div>
                      <svg
                        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className={`text-foreground/30 shrink-0 mt-1 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </button>

                  {/* Expanded: negotiation messages */}
                  {isOpen && (
                    <div className="border-t border-black/5 bg-zinc-50/50">
                      {/* Info bar */}
                      <div className="px-4 pt-3 pb-2 flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">
                          Precio pedido: {formatARS(neg.product.askPrice)}
                        </span>
                        {neg.finalPrice != null && (
                          <>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <span className="text-[10px] text-muted-foreground">
                              Precio final: <span className="font-medium text-foreground">{formatARS(neg.finalPrice)}</span>
                            </span>
                          </>
                        )}
                        {neg.verificationCode && (
                          <>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <span className="text-[10px] font-mono bg-foreground/10 px-1.5 py-0.5 rounded">
                              Codigo: {neg.verificationCode}
                            </span>
                          </>
                        )}
                      </div>

                      {/* Contact info */}
                      {counterpart && (
                        <div className="px-4 pb-2">
                          <div className="rounded-lg bg-white border border-black/5 p-3 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <span className="text-primary text-xs font-medium">
                                {counterpart.name.slice(0, 2).toUpperCase()}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{counterpart.name}</p>
                              <p className="text-[10px] text-muted-foreground truncate">{counterpart.email}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Negotiation messages */}
                      <div className="px-4 pb-4">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2 font-medium">
                          Negociacion IA
                        </p>
                        {neg.messages.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Sin mensajes de negociacion.</p>
                        ) : (
                          <div className="space-y-2">
                            {neg.messages.map((msg) => (
                              <div key={msg.id} className={`flex ${msg.side === "buyer" ? "justify-end" : "justify-start"}`}>
                                <div
                                  className={`max-w-[80%] px-3 py-1.5 rounded-2xl ${
                                    msg.side === "buyer"
                                      ? "bg-primary/40 text-amber-950 rounded-br-md"
                                      : "bg-white border border-black/10 rounded-bl-md"
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <span className="text-[10px] font-medium opacity-60">
                                      {msg.side === "buyer" ? "Comprador" : "Vendedor"}
                                    </span>
                                    {msg.proposedPrice != null && (
                                      <span className="text-[10px] font-bold">{formatARS(msg.proposedPrice)}</span>
                                    )}
                                  </div>
                                  <p className="text-xs">{msg.content}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
