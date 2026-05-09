"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getMe,
  listCoordinationMessages,
  listDashboardDeals,
  logout,
  sendCoordinationMessage as sendCoordinationMessageRequest,
  suggestShipping,
  updateMyLocation,
  type AuthUser,
  type CoordinationMessage,
  type DashboardDeal,
  type ShippingSuggestion,
} from "@/lib/api";

type Tab = "all" | "buyer" | "seller";

function formatARS(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [deals, setDeals] = useState<DashboardDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await getMe();
        if (!me) {
          router.replace("/login");
          return;
        }
        if (cancelled) return;
        setUser(me);
        const nextDeals = await listDashboardDeals();
        if (cancelled) return;
        setDeals(nextDeals);
        setSelectedId((current) => current ?? nextDeals[0]?.id ?? null);
      } catch {
        if (!cancelled) router.replace("/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const counts = useMemo(
    () => ({
      all: deals.length,
      buyer: deals.filter((deal) => deal.role === "buyer").length,
      seller: deals.filter((deal) => deal.role === "seller").length,
    }),
    [deals],
  );

  const filteredDeals = useMemo(
    () => deals.filter((deal) => tab === "all" || deal.role === tab),
    [deals, tab],
  );
  const selectedDeal =
    filteredDeals.find((deal) => deal.id === selectedId) ??
    filteredDeals[0] ??
    null;

  useEffect(() => {
    if (!selectedDeal) {
      setSelectedId(filteredDeals[0]?.id ?? null);
    }
  }, [filteredDeals, selectedDeal]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-muted/40 p-4">
        <div className="mx-auto flex min-h-[70vh] max-w-6xl items-center justify-center">
          <p className="text-sm text-muted-foreground">Cargando dashboard...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-muted/40">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 px-4 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4">
          <Link href="/explore" className="shrink-0">
            <p
              className="text-lg tracking-tight"
              style={{
                fontFamily: "var(--font-heading)",
                fontStyle: "italic",
              }}
            >
              negocIA
            </p>
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/explore"
              className="hidden rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
            >
              Explorar
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Salir
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
              {user ? initials(user.name) : "U"}
            </div>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[380px_1fr]">
        <section className="space-y-4">
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Operaciones
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight">
              Compras y ventas
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Desde acá se coordinan entregas de acuerdos cerrados.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-background p-1">
            {(["all", "buyer", "seller"] as const).map((nextTab) => (
              <button
                key={nextTab}
                type="button"
                onClick={() => setTab(nextTab)}
                className={`rounded-md px-3 py-2 text-sm transition-colors ${
                  tab === nextTab
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {nextTab === "all"
                  ? `Todo ${counts.all}`
                  : nextTab === "buyer"
                    ? `Compras ${counts.buyer}`
                    : `Ventas ${counts.seller}`}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filteredDeals.length === 0 ? (
              <EmptyState tab={tab} />
            ) : (
              filteredDeals.map((deal) => (
                <DealListItem
                  key={deal.id}
                  deal={deal}
                  active={selectedDeal?.id === deal.id}
                  onClick={() => setSelectedId(deal.id)}
                />
              ))
            )}
          </div>
        </section>

        <section>
          {selectedDeal && user ? (
            <DealDetail
              deal={selectedDeal}
              currentUser={user}
              onUserChange={setUser}
            />
          ) : (
            <div className="flex min-h-[520px] items-center justify-center rounded-lg border border-border bg-background p-8 text-center">
              <div>
                <h2 className="text-lg font-medium">Sin operaciones todavía</h2>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  Cuando cierres una compra o venta, la gestión del envío va a
                  aparecer en este panel.
                </p>
                <Link
                  href="/explore"
                  className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Ir a explorar
                </Link>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background p-5 text-sm text-muted-foreground">
      {tab === "buyer"
        ? "Todavía no tenés compras cerradas."
        : tab === "seller"
          ? "Todavía no tenés ventas cerradas."
          : "Todavía no hay operaciones para mostrar."}
    </div>
  );
}

function DealListItem({
  deal,
  active,
  onClick,
}: {
  deal: DashboardDeal;
  active: boolean;
  onClick: () => void;
}) {
  const counterparty = deal.role === "buyer" ? deal.seller : deal.buyer;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${
        active
          ? "border-foreground bg-background shadow-sm"
          : "border-border bg-background hover:border-foreground/30"
      }`}
    >
      <div className="flex gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
          {deal.product.imageUrl ? (
            <img
              src={deal.product.imageUrl}
              alt={deal.product.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              Sin foto
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-medium">{deal.product.title}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                deal.role === "buyer"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {deal.role === "buyer" ? "Compra" : "Venta"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Con {counterparty.name}
          </p>
          <p className="mt-2 text-sm font-medium">
            {deal.finalPrice != null
              ? formatARS(deal.finalPrice)
              : formatARS(deal.product.askPrice)}
          </p>
        </div>
      </div>
    </button>
  );
}

function DealDetail({
  deal,
  currentUser,
  onUserChange,
}: {
  deal: DashboardDeal;
  currentUser: AuthUser;
  onUserChange: (user: AuthUser) => void;
}) {
  const counterparty = deal.role === "buyer" ? deal.seller : deal.buyer;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="grid gap-0 border-b border-border lg:grid-cols-[1fr_280px]">
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                deal.role === "buyer"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {deal.role === "buyer" ? "Compra cerrada" : "Venta cerrada"}
            </span>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
              Envío pendiente
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-tight">
            {deal.product.title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {deal.role === "buyer" ? "Vendedor" : "Comprador"}:{" "}
            <span className="font-medium text-foreground">
              {counterparty.name}
            </span>
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              label="Precio final"
              value={
                deal.finalPrice != null
                  ? formatARS(deal.finalPrice)
                  : formatARS(deal.product.askPrice)
              }
            />
            <Metric label="Estado" value="A coordinar" />
            <Metric
              label="Categoria"
              value={deal.product.category ?? "General"}
            />
            <Metric label="Operacion" value={deal.role === "buyer" ? "Compra" : "Venta"} />
          </dl>
        </div>
        <div className="h-56 bg-muted lg:h-auto">
          {deal.product.imageUrl ? (
            <img
              src={deal.product.imageUrl}
              alt={deal.product.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Sin imagen
            </div>
          )}
        </div>
      </div>
      <ShippingAssistant
        deal={deal}
        currentUser={currentUser}
        onUserChange={onUserChange}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/70 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

function ShippingAssistant({
  deal,
  currentUser,
  onUserChange,
}: {
  deal: DashboardDeal;
  currentUser: AuthUser;
  onUserChange: (user: AuthUser) => void;
}) {
  const [locationDraft, setLocationDraft] = useState(currentUser.location ?? "");
  const [suggestion, setSuggestion] = useState<ShippingSuggestion | null>(deal.midpoint);
  const [loading, setLoading] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<CoordinationMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const accountLocation = currentUser.location?.trim() ?? "";
  const canSuggest = accountLocation || locationDraft.trim();
  const userRoleLabel = deal.role === "buyer" ? "comprador" : "vendedor";
  const meetingTips = suggestion?.meetingTips ?? [];
  const counterparty = deal.role === "buyer" ? deal.seller : deal.buyer;
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Scroll chat to bottom when messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    setLocationDraft(currentUser.location ?? "");
    setSuggestion(deal.midpoint);
    setMessageDraft("");
    setError(null);
  }, [deal.id, deal.midpoint, currentUser.location]);

  const fetchMessages = useCallback(async () => {
    try {
      const messages = await listCoordinationMessages(deal.id);
      setChatMessages(messages);
    } catch {
      // silent fail for polling
    }
  }, [deal.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadMessages() {
      setChatLoading(true);
      try {
        const messages = await listCoordinationMessages(deal.id);
        if (!cancelled) setChatMessages(messages);
      } catch {
        if (!cancelled) setChatMessages([]);
      } finally {
        if (!cancelled) setChatLoading(false);
      }
    }

    void loadMessages();

    // Auto-reload chat messages every 5 seconds
    pollingRef.current = setInterval(() => {
      if (!cancelled) void fetchMessages();
    }, 5000);

    return () => {
      cancelled = true;
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [deal.id, fetchMessages]);

  function handleDetectLocation() {
    if (!navigator.geolocation || detectingLocation) {
      setError("Tu navegador no permite detectar la ubicación automáticamente.");
      return;
    }

    setDetectingLocation(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = position.coords.latitude.toFixed(5);
        const longitude = position.coords.longitude.toFixed(5);
        setLocationDraft(`Ubicación actual (${latitude}, ${longitude})`);
        setDetectingLocation(false);
      },
      () => {
        setError("No pude detectar tu ubicación. Podés escribir una zona aproximada.");
        setDetectingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  async function handleSuggest() {
    if (!canSuggest || loading) return;
    setLoading(true);
    setError(null);
    try {
      let nextLocation = accountLocation;
      if (!nextLocation) {
        setSavingLocation(true);
        const response = await updateMyLocation(locationDraft);
        onUserChange(response.user);
        nextLocation = response.user.location ?? "";
        setSavingLocation(false);
      }

      const nextSuggestion = await suggestShipping({
        negotiationId: deal.id,
        userLocation: nextLocation,
      });
      setSuggestion(nextSuggestion);
      if (chatMessages.length === 0) {
        setMessageDraft(
          `Hola ${counterparty.name}, negocIA sugiere encontrarnos en ${nextSuggestion.midpointLabel}. Te queda cómodo?`,
        );
      }
    } catch {
      setError("No se pudo generar la sugerencia de envío.");
    } finally {
      setSavingLocation(false);
      setLoading(false);
    }
  }

  async function sendCoordinationMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed || sendingMessage) return;

    setSendingMessage(true);
    setError(null);
    try {
      const message = await sendCoordinationMessageRequest(deal.id, trimmed);
      setChatMessages((messages) => [...messages, message]);
      setMessageDraft("");
    } catch {
      setError("No se pudo enviar el mensaje de coordinación.");
    } finally {
      setSendingMessage(false);
    }
  }

  function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendCoordinationMessage(messageDraft);
  }

  const quickMessages = suggestion
    ? [
        `Me sirve ${suggestion.midpointLabel}. Podés hoy?`,
        "Prefiero un lugar transitado y con buena luz.",
        "Te parece confirmar punto exacto y horario antes de salir?",
      ]
    : [];

  return (
    <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
      <div className="p-5">
        <h3 className="text-lg font-medium">Asistente de envio</h3>
        <div className="mt-4 space-y-3">
          <ChatBubble side="assistant">
            Para coordinar la entrega necesito tu ubicación aproximada como{" "}
            {userRoleLabel}. Puede ser barrio, zona o tu ubicación actual.
          </ChatBubble>
          <ChatBubble side="assistant">
            Uso la ubicación guardada en las cuentas para calcular un punto de
            encuentro cómodo para ambos.
          </ChatBubble>
          {suggestion && (
            <ChatBubble side="assistant">
              Propongo <span className="font-medium">{suggestion.midpointLabel}</span>.{" "}
              {suggestion.rationale}
            </ChatBubble>
          )}
          {error && <ChatBubble side="assistant">{error}</ChatBubble>}
        </div>

        {suggestion && (
          <div className="mt-6 rounded-lg border border-border">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-medium">
                Chat con {counterparty.name}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Coordinación final de punto y horario
              </p>
            </div>

            <div ref={chatContainerRef} className="max-h-72 space-y-3 overflow-y-auto p-4">
              <ChatBubble side="assistant">
                Punto sugerido:{" "}
                <span className="font-medium">{suggestion.midpointLabel}</span>.
                Usalo como base para acordar con {counterparty.name}.
              </ChatBubble>
              {chatLoading ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                  Cargando mensajes...
                </p>
              ) : chatMessages.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                  Todavía no mandaste mensajes para esta entrega.
                </p>
              ) : (
                chatMessages.map((message) => (
                  <ChatBubble
                    key={message.id}
                    side={message.side === deal.role ? "user" : "assistant"}
                  >
                    {message.content}
                  </ChatBubble>
                ))
              )}
            </div>

            <div className="border-t border-border p-4">
              <div className="mb-3 flex flex-wrap gap-2">
                {quickMessages.map((message) => (
                  <button
                    key={message}
                    type="button"
                    onClick={() => void sendCoordinationMessage(message)}
                    disabled={sendingMessage}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                  >
                    {message}
                  </button>
                ))}
              </div>
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  placeholder={`Mensaje para ${counterparty.name}`}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-foreground"
                />
                <button
                  type="submit"
                  disabled={!messageDraft.trim() || sendingMessage}
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingMessage ? "Enviando..." : "Enviar"}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      <aside className="border-t border-border bg-muted/40 p-5 lg:border-l lg:border-t-0">
        {accountLocation ? (
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Tu ubicación de cuenta
            </p>
            <p className="mt-1 text-sm font-medium">{accountLocation}</p>
          </div>
        ) : (
          <>
            <label className="text-xs font-medium text-muted-foreground">
              Tu ubicación
            </label>
            <input
              value={locationDraft}
              onChange={(event) => setLocationDraft(event.target.value)}
              placeholder="Ej. Palermo, CABA"
              className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-foreground"
            />
            <button
              type="button"
              onClick={handleDetectLocation}
              disabled={detectingLocation}
              className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {detectingLocation ? "Detectando..." : "Detectar ubicación actual"}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={handleSuggest}
          disabled={!canSuggest || loading}
          className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {savingLocation ? "Guardando..." : loading ? "Pensando..." : "Sugerir punto medio"}
        </button>

        {suggestion && (
          <div className="mt-5 rounded-lg border border-border bg-background p-4">
            <p className="text-sm font-medium">{suggestion.midpointLabel}</p>
            {meetingTips.length > 0 && (
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {meetingTips.map((tip) => (
                  <li key={tip}>- {tip}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function ChatBubble({
  side,
  children,
}: {
  side: "assistant" | "user";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`max-w-[86%] rounded-lg px-3 py-2 text-sm ${
        side === "assistant"
          ? "bg-muted text-foreground"
          : "ml-auto bg-foreground text-background"
      }`}
    >
      {children}
    </div>
  );
}
