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
  getNegotiation,
  streamMessage,
  transcribeAudio,
  uploadImage,
  type AuthUser,
  type ConversationSummary,
  type Listing,
  type NegotiationDetail,
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
  const [searchStatus, setSearchStatus] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [chatHistory, setChatHistory] = useState<ConversationSummary[]>([]);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [activeNeg, setActiveNeg] = useState<NegotiationDetail | null>(null);
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
    const params = new URLSearchParams(window.location.search);
    if (!params.get("id")) refreshListings();
  }, [refreshListings]);

  const loadSearchFromUrl = useCallback(async (searchId: string) => {
    try {
      const search = await getSearch(searchId);
      const newTiles: Tile[] = search.negotiations.map((neg, i) => ({
        id: neg.listing.id,
        title: neg.listing.title,
        askPrice: neg.listing.askPrice,
        imageUrl: neg.listing.imageUrl ?? undefined,
        dealPrice: neg.finalPrice ?? undefined,
        negStatus: neg.status as NegStatus,
        negId: neg.id,
        h: TILE_HEIGHTS[i % TILE_HEIGHTS.length]!,
        color: TILE_COLORS[i % TILE_COLORS.length]!,
      }));
      if (newTiles.length > 0) setTiles(newTiles);
      if (search.status !== "completed" && search.status !== "failed") {
        pollSearch(searchId, false);
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id) loadSearchFromUrl(id);
  }, [loadSearchFromUrl]);

  function pollSearch(searchId: string, resetTiles = true) {
    setSearching(true);
    setChatCollapsed(true);
    setSearchStatus("Buscando productos...");
    if (resetTiles) setTiles([]);
    window.history.replaceState({}, "", `/explore?id=${searchId}`);
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
            setSearchStatus(`Deal cerrado: "${listing.title}" a ${formatARS(neg.finalPrice)}`);
          } else if (neg.status === "rejected") {
            setSearchStatus(`Sin acuerdo en "${listing.title}", siguiente...`);
          } else if (neg.status === "running") {
            setSearchStatus(`Negociando "${listing.title}"...`);
          } else {
            setSearchStatus(`Encontré "${listing.title}"`);
          }
        }

        if (search.status === "completed" || search.status === "failed") {
          setSearching(false);
          const deal = search.deals[0];
          if (deal) {
            setSearchStatus(`Listo! Deal a ${formatARS(deal.finalPrice)}`);
          } else if (seenNegotiations.size === 0) {
            setSearchStatus("");
            setMessages((prev) => [...prev, { role: "assistant", content: "No encontré productos que matcheen. Probá con otra búsqueda." }]);
            refreshListings();
          } else {
            setSearchStatus("");
          }
          setTimeout(() => setSearchStatus(""), 3000);
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
      textareaRef.current.style.height = "32px";
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

    const msgContent = pendingImage
      ? `${text}\n[Imagen adjunta: ${pendingImage.name}]`
      : text;
    setMessages((prev) => [...prev, { role: "user", content: msgContent }, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      if (!user) throw new Error("No hay sesión activa.");

      // Upload image if attached (TODO: connect backend POST /uploads/image)
      let imageUrl: string | undefined;
      if (pendingImage) {
        try {
          const upload = await uploadImage(pendingImage);
          imageUrl = upload.url;
        } catch {
          // Upload not available yet — continue without image
        }
        clearImage();
      }

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
        abort.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Error conectando con el agente." },
        ]);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }

  const smoothedRef = useRef<Float32Array | null>(null);

  function drawWaveform() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    const barCount = 40;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    smoothedRef.current = new Float32Array(barCount).fill(0);

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      const sm = smoothedRef.current!;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const barWidth = w / barCount;
      const gap = 2;
      const step = Math.max(1, Math.floor(dataArray.length / barCount));

      for (let i = 0; i < barCount; i++) {
        const raw = dataArray[i * step]! / 255;
        sm[i] = sm[i]! * 0.5 + raw * 0.5;
        const barH = Math.max(2, sm[i]! * h * 0.9);
        const x = i * barWidth + gap / 2;
        const y = (h - barH) / 2;

        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth - gap, barH, 1.5);
        ctx.fill();
      }
    };
    draw();
  }

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();

      setIsRecording(true);
      setTranscript("");
      setTimeout(drawWaveform, 50);
    } catch {
      // mic permission denied
    }
  }

  function stopMediaStream() {
    cancelAnimationFrame(animFrameRef.current);
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    setIsRecording(false);
  }

  function cancelRecording() {
    mediaRecorderRef.current?.stop();
    stopMediaStream();
    setTranscript("");
  }

  async function confirmRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: "audio/webm" }));
      };
      recorder.stop();
    });
    stopMediaStream();

    try {
      setTranscript("Transcribiendo...");
      const text = await transcribeAudio(blob);
      setTranscript("");
      if (text.trim()) {
        setInput(text.trim());
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    } catch {
      setTranscript("");
    }
  }

  function handleNewChat() {
    setMessages([]);
    setConversationId(null);
    setChatMode("idle");
    setShowHistory(false);
    setChatCollapsed(false);
    window.history.replaceState({}, "", "/explore");
    refreshListings();
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
      if (conv.searchId) {
        window.history.replaceState({}, "", `/explore?id=${conv.searchId}`);
        loadSearchFromUrl(conv.searchId);
      }
    } catch { /* ignore */ }
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingImage(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function clearImage() {
    setPendingImage(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const negPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function openNegotiation(negId: string) {
    if (negPollRef.current) clearTimeout(negPollRef.current);
    try {
      const neg = await getNegotiation(negId);
      setActiveNeg(neg);
      setChatCollapsed(false);
      if (neg.status === "running" || neg.status === "pending") {
        pollNegotiation(negId);
      }
    } catch { /* ignore */ }
  }

  function pollNegotiation(negId: string) {
    negPollRef.current = setTimeout(async () => {
      try {
        const neg = await getNegotiation(negId);
        setActiveNeg(neg);
        if (neg.status === "running" || neg.status === "pending") {
          pollNegotiation(negId);
        }
      } catch { /* ignore */ }
    }, 2000);
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
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowUserMenu((v) => !v)}
            className="w-8 h-8 rounded-full bg-primary flex items-center justify-center hover:scale-105 transition-transform"
          >
            <span className="text-primary-foreground text-xs font-medium">
              {(user?.name ?? "AM").slice(0, 2).toUpperCase()}
            </span>
          </button>
          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full mt-2 z-30 w-48 rounded-xl bg-white shadow-xl border border-black/10 py-1 animate-scale-in">
                <div className="px-3 py-2 border-b border-black/5">
                  <p className="text-sm font-medium text-foreground">{user?.name}</p>
                  <p className="text-[10px] text-foreground/40">{user?.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowUserMenu(false)}
                  className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-black/5 transition-colors flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/50">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Configuración
                </button>
                <button
                  type="button"
                  onClick={() => setShowUserMenu(false)}
                  className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-black/5 transition-colors flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/50">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="8.5" cy="7" r="4" />
                    <line x1="20" y1="8" x2="20" y2="14" />
                    <line x1="23" y1="11" x2="17" y2="11" />
                  </svg>
                  Integraciones
                </button>
                <div className="border-t border-black/5" />
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-black/5 transition-colors flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Cerrar sesión
                </button>
              </div>
            </>
          )}
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
              style={{ backgroundColor: item.color, minHeight: item.imageUrl ? undefined : item.h }}
            >
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.title} className="w-full h-auto block transition-transform duration-500 ease-out group-hover:scale-110" />
              ) : (
                <div style={{ height: item.h }} />
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
            <div className="flex items-center gap-1.5 px-0.5 mt-0.5">
              {item.dealPrice != null ? (
                <span className="text-xs text-accent font-bold">{formatARS(item.dealPrice)}</span>
              ) : item.askPrice != null ? (
                <span className="text-xs text-foreground/80 font-medium">{formatARS(item.askPrice)}</span>
              ) : null}
              {item.negId && (
                <button
                  onClick={() => openNegotiation(item.negId!)}
                  className="text-[10px] text-primary hover:underline"
                >
                  Ver negociación
                </button>
              )}
            </div>
          </div>
        ))}
        {searching && tiles.length === 0 && (
          <div className="mb-3 break-inside-avoid animate-msg-in">
            <div className="rounded-xl bg-border animate-pulse flex items-center justify-center" style={{ height: 280 }}>
              <img src="/logo-icon.svg" alt="" className="h-8 w-8 grayscale opacity-20 animate-thinking" />
            </div>
            <div className="mt-1.5 px-0.5 h-3 w-3/4 rounded bg-border animate-pulse" />
            <div className="mt-1 px-0.5 h-2.5 w-1/2 rounded bg-border animate-pulse" />
          </div>
        )}
      </div>

      {/* Chat container */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl px-4 flex items-end gap-2 transition-all duration-300 ease-out">
        {/* History button */}
        <div className="shrink-0 self-end mb-[7px]">
          <button
            type="button"
            onClick={toggleHistory}
            className="liquid-glass w-[45px] h-[45px] rounded-full flex items-center justify-center hover:scale-105 transition-transform"
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

          {/* Negotiation detail */}
          <div
            className="transition-all duration-300 ease-out overflow-hidden"
            style={{
              maxHeight: activeNeg && !showHistory ? "50vh" : "0px",
              opacity: activeNeg && !showHistory ? 1 : 0,
            }}
          >
            {activeNeg && (
              <>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-foreground/20">
                  <button
                    type="button"
                    onClick={() => { setActiveNeg(null); if (negPollRef.current) clearTimeout(negPollRef.current); }}
                    className="w-6 h-6 rounded-full hover:bg-black/5 flex items-center justify-center transition-colors shrink-0"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <p className="text-xs font-medium text-foreground truncate flex-1">{activeNeg.listing.title}</p>
                  {(activeNeg.status === "running" || activeNeg.status === "pending") && (
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                      <span className="text-[10px] text-accent font-medium">En vivo</span>
                    </span>
                  )}
                </div>
                <div className="max-h-[40vh] overflow-y-auto p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      activeNeg.status === "accepted" ? "bg-accent text-accent-foreground" :
                      activeNeg.status === "rejected" ? "bg-destructive text-destructive-foreground" :
                      "bg-primary text-primary-foreground"
                    }`}>
                      {activeNeg.status === "accepted" ? "Aceptada" : activeNeg.status === "rejected" ? "Rechazada" : "En curso"}
                    </span>
                    {activeNeg.finalPrice != null && (
                      <span className="text-xs font-bold text-accent">{formatARS(activeNeg.finalPrice)}</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {activeNeg.messages.map((msg) => (
                      <div key={msg.id} className={`flex ${msg.side === "buyer" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] px-3 py-1.5 rounded-2xl ${
                          msg.side === "buyer" ? "bg-primary/40 text-amber-950 rounded-br-md" : "bg-black/5 text-foreground rounded-bl-md"
                        }`}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[10px] font-medium opacity-60">{msg.side === "buyer" ? "Tu agente" : "Vendedor"}</span>
                            {msg.proposedPrice != null && (
                              <span className="text-[10px] font-bold">{formatARS(msg.proposedPrice)}</span>
                            )}
                          </div>
                          <p className="text-xs">{msg.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Messages (animated) */}
          <div
            className="transition-all duration-300 ease-out overflow-hidden"
            style={{
              maxHeight: chatOpen && !showHistory && !chatCollapsed && !activeNeg ? "50vh" : "0px",
              opacity: chatOpen && !showHistory && !chatCollapsed && !activeNeg ? 1 : 0,
            }}
          >
            {/* Mini header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
              <button
                type="button"
                onClick={() => setChatCollapsed(true)}
                className="w-6 h-6 rounded-full hover:bg-black/5 flex items-center justify-center transition-colors"
                title="Colapsar"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/50">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
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
                        <div className="bg-primary/40 text-amber-950 px-4 py-2 rounded-2xl rounded-br-md max-w-[75%]">
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

          {/* Image preview */}
          {imagePreview && (
            <div className="px-4 pt-2 pb-1 animate-scale-in">
              <div className="relative inline-block">
                <button type="button" onClick={() => setLightboxSrc(imagePreview)} className="block">
                  <img src={imagePreview} alt="Preview" className="h-16 w-16 object-cover rounded-xl border border-black/10 hover:scale-105 transition-transform cursor-pointer" />
                </button>
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-foreground text-background rounded-full flex items-center justify-center text-[10px] font-bold hover:scale-110 transition-transform"
                >
                  &times;
                </button>
              </div>
            </div>
          )}

          {/* Input / Search status */}
          {searching ? (
            <div className="px-5 py-2.5">
              <div className="flex items-center gap-3 h-[28px]">
                <img src="/logo-icon.svg" alt="" className="h-5 w-5 grayscale animate-thinking shrink-0" />
                <p className="text-sm text-foreground/70 truncate animate-status" key={searchStatus}>
                  {searchStatus || "Buscando..."}
                </p>
              </div>
            </div>
          ) : (
            <>
              {chatCollapsed && chatOpen && (
                <button
                  type="button"
                  onClick={() => setChatCollapsed(false)}
                  className="w-full flex justify-center py-1 hover:bg-black/5 transition-colors rounded-t-3xl"
                  title="Expandir chat"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/30">
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
              )}
              <form onSubmit={handleSend} className={chatOpen || showHistory ? "px-3 py-3" : "px-3 py-2.5"}>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                <div className={`flex items-end gap-1.5 ${chatOpen || showHistory ? "border border-black/10 rounded-3xl px-1.5 py-1.5" : "px-1.5"}`}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-8 w-8 rounded-full hover:bg-black/10 flex items-center justify-center transition-colors shrink-0"
                    title="Adjuntar imagen"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>

                  {isRecording ? (
                    <>
                      <div className="flex-1 flex items-center justify-center">
                        <canvas ref={canvasRef} width={300} height={32} className="w-full h-8" />
                      </div>
                      <button
                        type="button"
                        onClick={cancelRecording}
                        className="h-8 w-8 rounded-full hover:bg-black/10 flex items-center justify-center shrink-0 transition-colors"
                        title="Cancelar"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/50">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={confirmRecording}
                        className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:bg-primary/80 transition-colors"
                        title="Confirmar"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      <textarea
                        ref={textareaRef}
                        value={transcript || input}
                        onChange={(e) => { setInput(e.target.value); setTranscript(""); }}
                        onKeyDown={handleKeyDown}
                        placeholder={transcript || "Decile a tu agente qué querés comprar o vender..."}
                        rows={1}
                        disabled={streaming || !!transcript}
                        autoFocus
                        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none resize-none disabled:opacity-50"
                        style={{ height: "32px", maxHeight: "160px", lineHeight: "20px", paddingTop: "6px", paddingBottom: "6px" }}
                      />
                      {streaming ? (
                        <button
                          type="button"
                          onClick={handleStop}
                          className="h-8 w-8 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shrink-0 hover:bg-destructive/80 transition-colors"
                          title="Detener"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12" rx="2" />
                          </svg>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={startRecording}
                            className="h-8 w-8 rounded-full hover:bg-black/10 flex items-center justify-center shrink-0 transition-colors"
                            title="Grabar audio"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40">
                              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                              <line x1="12" y1="19" x2="12" y2="23" />
                              <line x1="8" y1="23" x2="16" y2="23" />
                            </svg>
                          </button>
                          <button
                            type="submit"
                            className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:bg-primary/80 transition-colors"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="12" y1="19" x2="12" y2="5" />
                              <polyline points="5 12 12 5 19 12" />
                            </svg>
                          </button>
                        </>
                      )}
                    </>
                  )}
              </div>
              </form>
            </>
          )}
        </div>

      </div>

      {/* Lightbox */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-8 animate-fade-in cursor-pointer"
          onClick={() => setLightboxSrc(null)}
        >
          <img
            src={lightboxSrc}
            alt="Imagen"
            className="max-h-[80vh] max-w-full rounded-2xl shadow-2xl object-contain animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
