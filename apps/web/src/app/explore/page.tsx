"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  getMe,
  listListings,
  logout,
  requestEmailVerification,
  startBuyerConversation,
  startSellerConversation,
  streamMessage,
  verifyEmail,
  type AuthUser,
  type Listing,
} from "@/lib/api";

type Tile = {
  id: string;
  title: string;
  askPrice?: number;
  imageUrl?: string | null;
  h: number;
  color: string;
};

const FALLBACK_TILES: Tile[] = [
  { id: "f1", title: "Bicicleta Trek FX3", h: 280, color: "hsl(220 14% 90%)" },
  { id: "f2", title: "MacBook Air M2", h: 340, color: "hsl(220 14% 86%)" },
  { id: "f3", title: "Escritorio IKEA", h: 240, color: "hsl(220 14% 92%)" },
  { id: "f4", title: "iPhone 15 Pro", h: 320, color: "hsl(220 14% 88%)" },
  { id: "f5", title: "Silla Herman Miller", h: 360, color: "hsl(220 14% 84%)" },
  { id: "f6", title: "Monitor LG 27\"", h: 260, color: "hsl(220 14% 91%)" },
  { id: "f7", title: "Cámara Sony A7III", h: 300, color: "hsl(220 14% 87%)" },
  { id: "f8", title: "Teclado Keychron K2", h: 220, color: "hsl(220 14% 93%)" },
  { id: "f9", title: "Zapatillas Nike Air", h: 290, color: "hsl(220 14% 89%)" },
  { id: "f10", title: "Mochila Peak Design", h: 330, color: "hsl(220 14% 85%)" },
  { id: "f11", title: "Auriculares Sony WH", h: 250, color: "hsl(220 14% 90%)" },
  { id: "f12", title: "Kindle Paperwhite", h: 270, color: "hsl(220 14% 88%)" },
];

const TILE_HEIGHTS = [200, 220, 240, 260, 280, 300, 320, 340, 360];
const TILE_COLORS = [
  "hsl(220 14% 84%)",
  "hsl(220 14% 86%)",
  "hsl(220 14% 88%)",
  "hsl(220 14% 90%)",
  "hsl(220 14% 92%)",
];
const LISTINGS_PAGE_SIZE = 40;

function listingsToTiles(listings: Listing[], offset = 0): Tile[] {
  return listings.map((l, i) => ({
    id: l.id,
    title: l.title,
    askPrice: l.askPrice,
    imageUrl: l.imageUrl,
    h: TILE_HEIGHTS[(offset + i) % TILE_HEIGHTS.length]!,
    color: TILE_COLORS[(offset + i) % TILE_COLORS.length]!,
  }));
}

function formatARS(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

const SELL_KEYWORDS = ["vender", "vendo", "publicar", "listar", "tengo para vender", "quiero vender"];

type Message = {
  role: "user" | "assistant";
  content: string;
};

type ChatMode = "idle" | "buyer" | "seller";

export default function ExplorePage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("idle");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [verificationToken, setVerificationToken] = useState("");
  const [devToken, setDevToken] = useState<string | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [visibleListingCount, setVisibleListingCount] = useState(LISTINGS_PAGE_SIZE);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const chatOpen = messages.length > 0;
  const visibleListings = useMemo(
    () => listings.slice(0, visibleListingCount),
    [listings, visibleListingCount],
  );
  const tiles = listings.length > 0 ? listingsToTiles(visibleListings) : FALLBACK_TILES;
  const hasMoreListings = visibleListingCount < listings.length;

  useEffect(() => {
    getMe()
      .then((me) => {
        if (!me) {
          router.replace("/login");
          return;
        }
        setUser(me);
      })
      .catch(() => setAuthError("No se pudo cargar la sesión."))
      .finally(() => setAuthLoading(false));
  }, [router]);

  const refreshListings = useCallback(() => {
    listListings()
      .then((nextListings) => {
        setListings(nextListings);
        setVisibleListingCount(LISTINGS_PAGE_SIZE);
      })
      .catch(() => {
        // keep fallback tiles
      });
  }, []);

  useEffect(() => {
    refreshListings();
  }, [refreshListings]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "28px";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const marker = loadMoreRef.current;
    if (!marker || !hasMoreListings) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisibleListingCount((count) => Math.min(count + LISTINGS_PAGE_SIZE, listings.length));
      },
      { rootMargin: "600px 0px" },
    );

    observer.observe(marker);
    return () => observer.disconnect();
  }, [hasMoreListings, listings.length, visibleListingCount]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  async function resendVerification() {
    setAuthError(null);
    try {
      const res = await requestEmailVerification();
      setDevToken(res.verificationToken ?? null);
    } catch {
      setAuthError("No se pudo generar un token de verificación.");
    }
  }

  async function submitVerification() {
    if (!verificationToken.trim()) return;
    setAuthError(null);
    try {
      const res = await verifyEmail(verificationToken.trim());
      setUser(res.user);
      setDevToken(null);
      setVerificationToken("");
    } catch {
      setAuthError("Token inválido o vencido.");
    }
  }

  function detectMode(text: string): ChatMode {
    const lower = text.toLowerCase();
    if (SELL_KEYWORDS.some((kw) => lower.includes(kw))) return "seller";
    return "buyer";
  }

  const appendToLastAssistant = useCallback((chunk: string) => {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === "assistant") {
        copy[copy.length - 1] = { ...last, content: last.content + chunk };
      }
      return copy;
    });
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setStreaming(true);

    try {
      if (!user) throw new Error("No hay sesión activa.");
      if (!user.emailVerified) throw new ApiError(403, "email_not_verified");
      let convId = conversationId;
      let mode = chatMode;

      if (!convId) {
        mode = detectMode(text);
        setChatMode(mode);
        const conv =
          mode === "seller"
            ? await startSellerConversation()
            : await startBuyerConversation();
        convId = conv.id;
        setConversationId(conv.id);
      }
      if (!convId) throw new Error("No se pudo iniciar la conversación.");

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      await streamMessage(
        mode === "seller" ? "seller" : "buyer",
        convId,
        text,
        (chunk) => appendToLastAssistant(chunk),
        (data) => {
          if (data.searchId) {
            router.push(`/search/${data.searchId}`);
          } else if (data.listingId) {
            appendToLastAssistant(`\n\n✓ Tu publicación está lista (id: ${data.listingId.slice(0, 8)}…).`);
            refreshListings();
          }
        },
        (error) => {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = { ...last, content: error };
            }
            return copy;
          });
        },
      );
    } catch (err) {
      const message =
        err instanceof ApiError && err.code === "email_not_verified"
          ? "Verificá tu email antes de usar el agente."
          : "Error conectando con el agente.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: message },
      ]);
    } finally {
      setStreaming(false);
    }
  }

  function handleNewChat() {
    setMessages([]);
    setConversationId(null);
    setChatMode("idle");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border px-4 h-14 flex items-center justify-between">
        <p
          className="text-lg tracking-tight"
          style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
        >
          AgentMarket
        </p>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {user?.name ?? "Cargando..."}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Salir
          </button>
          <div className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center">
            <span className="text-background text-xs font-medium">
              {(user?.name ?? "AM").slice(0, 2).toUpperCase()}
            </span>
          </div>
        </div>
      </header>

      {authLoading && (
        <div className="p-4 text-sm text-muted-foreground">Cargando sesión...</div>
      )}

      {user && !user.emailVerified && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center">
            <span className="font-medium">Verificá tu email para usar el agente.</span>
            <input
              value={verificationToken}
              onChange={(e) => setVerificationToken(e.target.value)}
              placeholder="Token dev"
              className="h-8 flex-1 rounded-md border border-amber-200 bg-white px-2 text-xs outline-none"
            />
            <button onClick={submitVerification} className="h-8 rounded-md bg-foreground px-3 text-xs text-background">
              Verificar
            </button>
            <button onClick={resendVerification} className="h-8 rounded-md border border-amber-300 px-3 text-xs">
              Generar token
            </button>
          </div>
          {devToken && (
            <code className="mx-auto mt-2 block max-w-3xl break-all rounded bg-white/70 p-2 text-xs">
              {devToken}
            </code>
          )}
          {authError && <p className="mx-auto mt-2 max-w-3xl text-xs text-destructive">{authError}</p>}
        </div>
      )}

      <div
        className="p-4 columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3 pb-4"
      >
        {tiles.map((item) => (
          <div key={item.id} className="mb-3 break-inside-avoid cursor-pointer group">
            <div
              className="rounded-xl overflow-hidden"
              style={{ height: item.h, backgroundColor: item.color }}
            >
              {item.imageUrl && (
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 px-0.5 group-hover:text-foreground transition-colors line-clamp-2">
              {item.title}
            </p>
            {item.askPrice != null && (
              <p className="text-xs text-foreground/80 px-0.5 font-medium">{formatARS(item.askPrice)}</p>
            )}
          </div>
        ))}
      </div>

      {listings.length > LISTINGS_PAGE_SIZE && (
        <div ref={loadMoreRef} className="px-4 pb-32 pt-2 text-center text-xs text-muted-foreground">
          {hasMoreListings ? `Mostrando ${visibleListings.length} de ${listings.length}` : "No hay más publicaciones"}
        </div>
      )}

      {/* Chat container */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl px-4 flex flex-col items-stretch">
        <div className="bg-white/50 backdrop-blur-2xl border border-white/30 shadow-[0_8px_32px_rgba(0,0,0,0.08)] rounded-3xl">
          {/* Messages (animated) */}
          <div
            className="transition-all duration-300 ease-out overflow-hidden"
            style={{
              maxHeight: chatOpen ? "50vh" : "0px",
              opacity: chatOpen ? 1 : 0,
            }}
          >
            {/* Mini header */}
            <div className="flex items-center justify-end px-3 py-2 border-b border-black/5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="w-6 h-6 rounded-full hover:bg-black/5 flex items-center justify-center transition-colors"
                  title="Nuevo chat"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="w-6 h-6 rounded-full hover:bg-black/5 flex items-center justify-center transition-colors"
                  title="Cerrar"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="max-h-[40vh] overflow-y-auto p-5">
              <div className="space-y-4">
                {messages.map((msg, i) => (
                  <div key={i} className="animate-msg-in" style={{ animationDelay: `${i * 0.05}s` }}>
                    {msg.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="bg-primary text-primary-foreground px-4 py-2 rounded-2xl rounded-br-md max-w-[75%]">
                          <p className="text-sm">{msg.content}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-foreground text-sm leading-relaxed">
                        {msg.content}
                        {streaming && i === messages.length - 1 && (
                          <span className="inline-block w-0.5 h-4 bg-foreground/50 ml-0.5 animate-pulse align-middle" />
                        )}
                      </p>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </div>

          {/* Input */}
          <form onSubmit={handleSend} className={chatOpen ? "px-3 py-3" : "px-5 py-2.5"}>
            <div className={`flex items-end gap-2 ${chatOpen ? "border border-black/10 rounded-full px-4 py-2" : ""}`}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Decile a tu agente qué querés comprar o vender..."
                rows={1}
                disabled={streaming}
                className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none resize-none disabled:opacity-50"
                style={{ height: "28px", maxHeight: "160px", lineHeight: "28px" }}
              />
              <button
                type="submit"
                disabled={streaming}
                className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center shrink-0 hover:bg-foreground/90 transition-colors disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
