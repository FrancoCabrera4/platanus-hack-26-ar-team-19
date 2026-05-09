"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  createUser,
  startBuyerConversation,
  startSellerConversation,
  streamMessage,
} from "@/lib/api";

const LISTINGS = [
  { id: 1, title: "Bicicleta Trek FX3", h: 280, color: "hsl(220 14% 90%)" },
  { id: 2, title: "MacBook Air M2", h: 340, color: "hsl(220 14% 86%)" },
  { id: 3, title: "Escritorio IKEA", h: 240, color: "hsl(220 14% 92%)" },
  { id: 4, title: "iPhone 15 Pro", h: 320, color: "hsl(220 14% 88%)" },
  { id: 5, title: "Silla Herman Miller", h: 360, color: "hsl(220 14% 84%)" },
  { id: 6, title: "Monitor LG 27\"", h: 260, color: "hsl(220 14% 91%)" },
  { id: 7, title: "Cámara Sony A7III", h: 300, color: "hsl(220 14% 87%)" },
  { id: 8, title: "Teclado Keychron K2", h: 220, color: "hsl(220 14% 93%)" },
  { id: 9, title: "Zapatillas Nike Air", h: 290, color: "hsl(220 14% 89%)" },
  { id: 10, title: "Mochila Peak Design", h: 330, color: "hsl(220 14% 85%)" },
  { id: 11, title: "Auriculares Sony WH", h: 250, color: "hsl(220 14% 90%)" },
  { id: 12, title: "Kindle Paperwhite", h: 270, color: "hsl(220 14% 88%)" },
  { id: 13, title: "Guitarra Fender", h: 350, color: "hsl(220 14% 86%)" },
  { id: 14, title: "Patineta eléctrica", h: 230, color: "hsl(220 14% 92%)" },
  { id: 15, title: "Lentes Ray-Ban", h: 200, color: "hsl(220 14% 91%)" },
  { id: 16, title: "PS5 Digital", h: 310, color: "hsl(220 14% 87%)" },
  { id: 17, title: "Mesa de ping pong", h: 280, color: "hsl(220 14% 89%)" },
  { id: 18, title: "Drone DJI Mini 3", h: 340, color: "hsl(220 14% 85%)" },
  { id: 19, title: "Reloj Casio Vintage", h: 210, color: "hsl(220 14% 93%)" },
  { id: 20, title: "Parlante JBL", h: 260, color: "hsl(220 14% 90%)" },
];

const SELL_KEYWORDS = ["vender", "vendo", "publicar", "listar", "tengo para vender", "quiero vender"];

type Message = {
  role: "user" | "assistant";
  content: string;
};

type ChatMode = "idle" | "buyer" | "seller";

export default function ExplorePage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("idle");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatOpen = messages.length > 0;

  useEffect(() => {
    const stored = localStorage.getItem("am_user_id");
    if (stored) setUserId(stored);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "28px";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function ensureUser(): Promise<string> {
    if (userId) return userId;
    const user = await createUser("Ignacio", "ignacio@agentmarket.app", "both");
    localStorage.setItem("am_user_id", user.id);
    setUserId(user.id);
    return user.id;
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
      const uid = await ensureUser();
      let convId = conversationId;
      let mode = chatMode;

      if (!convId) {
        mode = detectMode(text);
        setChatMode(mode);
        const conv =
          mode === "seller"
            ? await startSellerConversation(uid)
            : await startBuyerConversation(uid);
        convId = conv.id;
        setConversationId(conv.id);
      }

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      await streamMessage(
        mode === "seller" ? "seller" : "buyer",
        convId,
        text,
        (chunk) => appendToLastAssistant(chunk),
        () => {},
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
        <div className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center cursor-pointer">
          <span className="text-background text-xs font-medium">IR</span>
        </div>
      </header>

      <div className="p-4 columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3 pb-28">
        {LISTINGS.map((item) => (
          <div key={item.id} className="mb-3 break-inside-avoid cursor-pointer group">
            <div
              className="rounded-xl overflow-hidden"
              style={{ height: item.h, backgroundColor: item.color }}
            />
            <p className="text-xs text-muted-foreground mt-1.5 px-0.5 group-hover:text-foreground transition-colors">
              {item.title}
            </p>
          </div>
        ))}
      </div>

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
