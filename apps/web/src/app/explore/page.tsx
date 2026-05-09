"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getMe,
  getBuyerConversation,
  getSearch,
  listBuyerConversations,
  listListings,
  logout,
  startBuyerConversation,
  startSellerConversation,
  streamMessage,
  type AuthUser,
  type ConversationSummary,
  type Listing,
} from "@/lib/api";

type NegStatus = "accepted" | "rejected" | "running" | "pending" | null;

type Tile = {
  id: string;
  title: string;
  askPrice?: number;
  imageUrl?: string;
  dealPrice?: number;
  negStatus: NegStatus;
  negId?: string;
  h: number;
  color: string;
};

const FALLBACK_TILES: Tile[] = [
  { id: "f1", title: "Bicicleta Trek FX3", h: 280, color: "hsl(220 14% 90%)", negStatus: null },
  { id: "f2", title: "MacBook Air M2", h: 340, color: "hsl(220 14% 86%)", negStatus: null },
  { id: "f3", title: "Escritorio IKEA", h: 240, color: "hsl(220 14% 92%)", negStatus: null },
  { id: "f4", title: "iPhone 15 Pro", h: 320, color: "hsl(220 14% 88%)", negStatus: null },
  { id: "f5", title: "Silla Herman Miller", h: 360, color: "hsl(220 14% 84%)", negStatus: null },
  { id: "f6", title: "Monitor LG 27\"", h: 260, color: "hsl(220 14% 91%)", negStatus: null },
  { id: "f7", title: "Cámara Sony A7III", h: 300, color: "hsl(220 14% 87%)", negStatus: null },
  { id: "f8", title: "Teclado Keychron K2", h: 220, color: "hsl(220 14% 93%)", negStatus: null },
  { id: "f9", title: "Zapatillas Nike Air", h: 290, color: "hsl(220 14% 89%)", negStatus: null },
  { id: "f10", title: "Mochila Peak Design", h: 330, color: "hsl(220 14% 85%)", negStatus: null },
  { id: "f11", title: "Auriculares Sony WH", h: 250, color: "hsl(220 14% 90%)", negStatus: null },
  { id: "f12", title: "Kindle Paperwhite", h: 270, color: "hsl(220 14% 88%)", negStatus: null },
];

const TILE_HEIGHTS = [200, 220, 240, 260, 280, 300, 320, 340, 360];
const TILE_COLORS = [
  "hsl(220 14% 84%)",
  "hsl(220 14% 86%)",
  "hsl(220 14% 88%)",
  "hsl(220 14% 90%)",
  "hsl(220 14% 92%)",
];

function listingsToTiles(listings: Listing[]): Tile[] {
  return listings.map((l, i) => ({
    id: l.id,
    title: l.title,
    askPrice: l.askPrice,
    imageUrl: l.imageUrl ?? undefined,
    negStatus: null,
    h: TILE_HEIGHTS[i % TILE_HEIGHTS.length]!,
    color: TILE_COLORS[i % TILE_COLORS.length]!,
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
  const [tiles, setTiles] = useState<Tile[]>(FALLBACK_TILES);
  const [searching, setSearching] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [chatHistory, setChatHistory] = useState<ConversationSummary[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatOpen = messages.length > 0;

  useEffect(() => {
    getMe()
      .then((me) => {
        if (!me) {
          router.replace("/login");
          return;
        }
        setUser(me);
      })
      .catch(() => {})
      .finally(() => setAuthLoading(false));
  }, [router]);

  const refreshListings = useCallback(() => {
    listListings(40)
      .then((listings) => {
        if (listings.length > 0) setTiles(listingsToTiles(listings));
      })
      .catch(() => {
        // keep fallback tiles
      });
  }, []);

  useEffect(() => {
    refreshListings();
  }, [refreshListings]);

  async function pollSearch(searchId: string) {
    setSearching(true);
    setTiles([]);
    const seenNegotiations = new Set<string>();

    const poll = async () => {
      try {
        const search = await getSearch(searchId);

        for (const neg of search.negotiations) {
          if (seenNegotiations.has(neg.id)) continue;
          seenNegotiations.add(neg.id);

          const listing = neg.listing;
          const newTile: Tile = {
            id: listing.id,
            title: listing.title,
            askPrice: listing.askPrice,
            imageUrl: listing.imageUrl ?? undefined,
            dealPrice: neg.finalPrice ?? undefined,
            negStatus: neg.status as NegStatus,
            negId: neg.id,
            h: TILE_HEIGHTS[seenNegotiations.size % TILE_HEIGHTS.length]!,
            color: TILE_COLORS[seenNegotiations.size % TILE_COLORS.length]!,
          };
          setTiles((prev) => {
            const existing = prev.findIndex((t) => t.id === listing.id);
            if (existing >= 0) {
              const copy = [...prev];
              copy[existing] = newTile;
              return copy;
            }
            return [...prev, newTile];
          });

          if (neg.status === "accepted" && neg.finalPrice) {
            setMessages((prev) => [...prev, { role: "assistant", content: `Encontré "${listing.title}" y cerré un deal a ${formatARS(neg.finalPrice!)}` }]);
          } else if (neg.status === "rejected") {
            setMessages((prev) => [...prev, { role: "assistant", content: `"${listing.title}" — no se pudo cerrar trato, sigo buscando...` }]);
          } else {
            setMessages((prev) => [...prev, { role: "assistant", content: `Negociando "${listing.title}"...` }]);
          }
        }

        if (search.status === "completed" || search.status === "failed") {
          setSearching(false);
          const deal = search.deals[0];
          if (deal) {
            setMessages((prev) => [...prev, { role: "assistant", content: `Listo! Tu mejor deal quedó en ${formatARS(deal.finalPrice)}.` }]);
          } else if (seenNegotiations.size === 0) {
            setMessages((prev) => [...prev, { role: "assistant", content: "No encontré productos que matcheen. Probá con otra búsqueda." }]);
            refreshListings();
          }
          return;
        }
        setTimeout(poll, 1500);
      } catch {
        setTimeout(poll, 2000);
      }
    };
    setTimeout(poll, 1500);
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "28px";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleLogout() {
    await logout();
    router.push("/login");
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

    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    try {
      if (!user) throw new Error("No hay sesión activa.");
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

      await streamMessage(
        mode === "seller" ? "seller" : "buyer",
        convId,
        text,
        (chunk) => appendToLastAssistant(chunk),
        (data) => {
          if (data.searchId) {
            appendToLastAssistant("\n\nBuscando productos que matcheen...");
            pollSearch(data.searchId);
          } else if (data.listingId) {
            appendToLastAssistant("\n\nTu publicación está lista.");
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
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error conectando con el agente." },
      ]);
    } finally {
      setStreaming(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }

  function handleNewChat() {
    setMessages([]);
    setConversationId(null);
    setChatMode("idle");
    setShowHistory(false);
  }

  async function toggleHistory() {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    try {
      const convs = await listBuyerConversations();
      setChatHistory(convs);
    } catch { /* ignore */ }
    setShowHistory(true);
  }

  async function restoreChat(convId: string) {
    try {
      const conv = await getBuyerConversation(convId);
      setConversationId(conv.id);
      setChatMode("buyer");
      setMessages(conv.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
      setShowHistory(false);
    } catch { /* ignore */ }
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
        <img src="/logo.svg" alt="negocIA" className="h-10" />
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

      <div className="p-4 columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3 pb-28">
        {tiles.map((item, i) => (
          <div
            key={item.id}
            className="mb-3 break-inside-avoid cursor-pointer group animate-msg-in transition-transform duration-300 ease-out hover:scale-[1.03] hover:-translate-y-1"
            style={{ animationDelay: searching ? `${i * 0.15}s` : "0s" }}
          >
            <div
              className="rounded-xl overflow-hidden relative"
              style={{ height: item.h, backgroundColor: item.color }}
            >
              {item.imageUrl && (
                <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-110" />
              )}
              {item.negStatus === "accepted" && (
                <span className="absolute top-2 left-2 bg-accent text-accent-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                  Deal cerrado
                </span>
              )}
              {item.negStatus === "rejected" && (
                <span className="absolute top-2 left-2 bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                  Sin acuerdo
                </span>
              )}
              {(item.negStatus === "running" || item.negStatus === "pending") && (
                <span className="absolute top-2 left-2 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                  Negociando...
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 px-0.5 group-hover:text-foreground transition-colors line-clamp-2">
              {item.title}
            </p>
            {item.dealPrice != null ? (
              <p className="text-xs text-accent px-0.5 font-bold">{formatARS(item.dealPrice)}</p>
            ) : item.askPrice != null ? (
              <p className="text-xs text-foreground/80 px-0.5 font-medium">{formatARS(item.askPrice)}</p>
            ) : null}
            {item.negId && (
              <button
                onClick={() => router.push(`/negotiation/${item.negId}`)}
                className="mt-1 text-[10px] text-primary hover:underline px-0.5"
              >
                Ver negociación
              </button>
            )}
          </div>
        ))}
        {searching && tiles.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-20">
            <img src="/logo-icon.svg" alt="" className="h-12 w-12 grayscale opacity-30 animate-thinking" />
            <p className="mt-4 text-sm text-muted-foreground">Buscando productos...</p>
          </div>
        )}
        {searching && tiles.length > 0 && (
          <div className="mb-3 break-inside-avoid">
            <div className="rounded-xl bg-border animate-pulse flex items-center justify-center" style={{ height: 240 }}>
              <img src="/logo-icon.svg" alt="" className="h-8 w-8 grayscale opacity-30 animate-thinking" />
            </div>
            <div className="mt-1.5 px-0.5 h-3 w-3/4 rounded bg-border animate-pulse" />
          </div>
        )}
      </div>

      {/* Chat container */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl px-4 flex items-end gap-2 transition-all duration-300 ease-out">
        {/* History button - hides when chat or history is open */}
        <div className="shrink-0 mb-[13px]">
          <button
            type="button"
            onClick={toggleHistory}
            className="liquid-glass w-10 h-10 rounded-full flex items-center justify-center hover:scale-105 transition-transform"
            title="Historial de chats"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/60">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 liquid-glass rounded-3xl">
          {/* Chat history list */}
          <div
            className="transition-all duration-300 ease-out overflow-hidden"
            style={{
              maxHeight: showHistory ? "50vh" : "0px",
              opacity: showHistory ? 1 : 0,
            }}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-black/5">
              <p className="text-xs font-medium text-foreground/70">Chats anteriores</p>
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="w-6 h-6 rounded-full hover:bg-black/5 flex items-center justify-center transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/50">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="max-h-[40vh] overflow-y-auto">
              {chatHistory.length === 0 ? (
                <p className="text-xs text-foreground/40 px-4 py-6 text-center">No hay chats aún</p>
              ) : (
                chatHistory.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => restoreChat(c.id)}
                    className="w-full text-left px-4 py-3 hover:bg-black/5 transition-colors border-b border-black/5 last:border-0"
                  >
                    <p className="text-sm text-foreground line-clamp-1">{c.preview || "Chat sin mensajes"}</p>
                    <p className="text-[10px] text-foreground/40 mt-0.5">
                      {c.status === "completed" ? "Completado" : "En progreso"}
                      {" · "}
                      {new Date(c.createdAt).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Messages (animated) */}
          <div
            className="transition-all duration-300 ease-out overflow-hidden"
            style={{
              maxHeight: chatOpen && !showHistory ? "50vh" : "0px",
              opacity: chatOpen && !showHistory ? 1 : 0,
            }}
          >
            {/* Mini header */}
            <div className="flex items-center justify-end px-3 py-2 border-b border-white/10">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="w-6 h-6 rounded-full hover:bg-black/5 flex items-center justify-center transition-colors"
                  title="Nuevo chat"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/50">
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
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/50">
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
                        <div className="bg-primary/20 text-amber-900 px-4 py-2 rounded-2xl rounded-br-md max-w-[75%]">
                          <p className="text-sm">{msg.content}</p>
                        </div>
                      </div>
                    ) : streaming && i === messages.length - 1 && !msg.content ? (
                      <div className="flex items-center gap-2 py-1">
                        <img src="/logo-icon.svg" alt="" className="h-6 w-6 grayscale animate-thinking" />
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
          <form onSubmit={handleSend} className={chatOpen || showHistory ? "px-3 py-3" : "px-5 py-2.5"}>
            <div className={`flex items-end gap-2 ${chatOpen || showHistory ? "border border-black/10 rounded-full px-4 py-2" : ""}`}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Decile a tu agente qué querés comprar o vender..."
                rows={1}
                disabled={streaming}
                autoFocus
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none resize-none disabled:opacity-50"
                style={{ height: "28px", maxHeight: "160px", lineHeight: "28px" }}
              />
              <button
                type="submit"
                disabled={streaming}
                className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:bg-primary/80 transition-colors disabled:opacity-50"
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
