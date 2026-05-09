"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  getNegotiation,
  getSearch,
  type NegotiationDetail,
  type SearchDetail,
} from "@/lib/api";

function formatARS(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

const STATUS_COPY: Record<SearchDetail["status"], { label: string; cls: string }> = {
  collecting: { label: "Recolectando preferencias", cls: "bg-amber-100 text-amber-800" },
  ready: { label: "Listo para arrancar", cls: "bg-blue-100 text-blue-800" },
  running: { label: "Negociando…", cls: "bg-blue-100 text-blue-800" },
  completed: { label: "Búsqueda completa", cls: "bg-emerald-100 text-emerald-800" },
  failed: { label: "Falló", cls: "bg-rose-100 text-rose-800" },
};

const NEG_STATUS_COPY: Record<string, { label: string; cls: string }> = {
  pending: { label: "pendiente", cls: "bg-zinc-100 text-zinc-700" },
  running: { label: "negociando", cls: "bg-blue-100 text-blue-800" },
  accepted: { label: "cerrada", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "rechazada", cls: "bg-rose-100 text-rose-800" },
  timed_out: { label: "sin acuerdo", cls: "bg-zinc-100 text-zinc-700" },
  error: { label: "error", cls: "bg-rose-100 text-rose-800" },
};

export default function SearchPage() {
  const params = useParams<{ id: string }>();
  const searchId = params.id;
  const [search, setSearch] = useState<SearchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      try {
        const s = await getSearch(searchId);
        if (cancelled) return;
        setSearch(s);
        if (s.status === "completed" || s.status === "failed") {
          stoppedRef.current = true;
          if (interval) clearInterval(interval);
        }
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
    }

    void tick();
    interval = setInterval(() => {
      if (!stoppedRef.current) void tick();
    }, 1500);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [searchId]);

  if (error) {
    return (
      <Shell>
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-800">
          Error: {error}
        </div>
      </Shell>
    );
  }

  if (!search) {
    return (
      <Shell>
        <SkeletonCard />
      </Shell>
    );
  }

  const statusInfo = STATUS_COPY[search.status] ?? STATUS_COPY.collecting;
  const acceptedNegotiation = search.negotiations.find((n) => n.status === "accepted") ?? null;

  return (
    <Shell>
      <div className="space-y-6">
        <header className="rounded-2xl bg-white border border-black/5 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Búsqueda activa</p>
              <h1 className="mt-1 text-2xl font-medium tracking-tight">{search.query}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Tope <span className="font-medium text-foreground">{formatARS(search.maxPrice)}</span>
                {search.category ? <> · categoría <span className="font-medium text-foreground">{search.category}</span></> : null}
              </p>
            </div>
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${statusInfo.cls}`}>
              {(search.status === "running" || search.status === "ready") && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              )}
              {statusInfo.label}
            </span>
          </div>
        </header>

        {acceptedNegotiation && <OutcomeCard negotiation={acceptedNegotiation} />}

        <section>
          <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground">
            Negociaciones
            {search.negotiations.length > 0 && <span className="ml-2 text-foreground">({search.negotiations.length})</span>}
          </h2>
          {search.negotiations.length === 0 ? (
            search.status === "running" || search.status === "ready" ? (
              <div className="space-y-3">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No se encontraron productos que coincidan con tu búsqueda.</p>
            )
          ) : (
            <div className="space-y-3">
              {search.negotiations.map((n) => (
                <NegotiationCard key={n.id} summary={n} maxPrice={search.maxPrice} />
              ))}
            </div>
          )}
        </section>

        <footer className="pt-2 text-center">
          <Link href="/explore" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Volver a explorar
          </Link>
        </footer>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border px-4 h-14 flex items-center justify-between">
        <Link href="/explore">
          <p
            className="text-lg tracking-tight"
            style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
          >
            negocIA
          </p>
        </Link>
        <div className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center cursor-pointer">
          <span className="text-background text-xs font-medium">IR</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-4 pb-16">{children}</main>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl bg-white border border-black/5 p-4 animate-pulse">
      <div className="h-3 w-1/3 rounded bg-zinc-200" />
      <div className="mt-3 h-3 w-2/3 rounded bg-zinc-100" />
      <div className="mt-2 h-3 w-1/2 rounded bg-zinc-100" />
    </div>
  );
}

function OutcomeCard({ negotiation }: { negotiation: SearchDetail["negotiations"][number] }) {
  return (
    <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <p className="text-sm text-emerald-900/80">¡Negociación cerrada!</p>
          <p className="text-lg font-medium text-emerald-950">
            {negotiation.product.title} · {formatARS(negotiation.finalPrice!)}
          </p>
        </div>
      </div>
    </div>
  );
}

function NegotiationCard({
  summary,
  maxPrice,
}: {
  summary: SearchDetail["negotiations"][number];
  maxPrice: number;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<NegotiationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const status = NEG_STATUS_COPY[summary.status] ?? NEG_STATUS_COPY.pending;

  // Auto-poll messages while the negotiation is running and the card is open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const d = await getNegotiation(summary.id);
        if (!cancelled) setDetail(d);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const interval = setInterval(() => {
      if (summary.status === "running" || summary.status === "pending") void load();
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, summary.id, summary.status]);

  const dropPct =
    summary.finalPrice && summary.product.askPrice > 0
      ? Math.round(((summary.product.askPrice - summary.finalPrice) / summary.product.askPrice) * 100)
      : null;

  return (
    <div className="rounded-xl bg-white border border-black/5 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-4 hover:bg-black/[0.02] transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{summary.product.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pedido: {formatARS(summary.product.askPrice)}
              {summary.finalPrice != null && (
                <>
                  {" "}· Cerrado: <span className="font-medium text-foreground">{formatARS(summary.finalPrice)}</span>
                  {dropPct != null && dropPct > 0 && (
                    <span className="ml-1 text-emerald-700">(-{dropPct}%)</span>
                  )}
                </>
              )}
            </p>
          </div>
          <span className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}>
            {status.label}
          </span>
        </div>
      </button>

      {open && (
        <div className="border-t border-black/5 bg-zinc-50/50 px-4 py-3">
          {loading && !detail ? (
            <div className="space-y-2">
              <div className="h-3 w-2/3 rounded bg-zinc-200 animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-zinc-100 animate-pulse" />
            </div>
          ) : detail && detail.messages.length > 0 ? (
            <div className="space-y-3">
              {detail.messages.map((m) => (
                <div key={m.id} className={`flex ${m.side === "buyer" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[78%] rounded-2xl px-3 py-2 ${
                      m.side === "buyer"
                        ? "bg-foreground text-background rounded-br-md"
                        : "bg-white border border-black/10 rounded-bl-md"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide opacity-70">
                      <span>{m.side === "buyer" ? "comprador" : "vendedor"}</span>
                      <span>·</span>
                      <span>{m.action}</span>
                      {m.proposedPrice != null && (
                        <>
                          <span>·</span>
                          <span className="font-medium">{formatARS(m.proposedPrice)}</span>
                        </>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm leading-snug">{m.content}</p>
                  </div>
                </div>
              ))}
              {detail.reason && (
                <p className="pt-1 text-xs italic text-muted-foreground">Motivo: {detail.reason}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Esperando primer turno…</p>
          )}
          <p className="mt-3 text-[10px] text-muted-foreground">
            Tope del comprador: {formatARS(maxPrice)} (privado para el vendedor)
          </p>
        </div>
      )}
    </div>
  );
}
