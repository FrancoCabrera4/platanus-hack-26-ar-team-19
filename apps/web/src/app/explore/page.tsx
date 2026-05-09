"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  acceptNegotiation,
  getMe,
  getConversation,
  getNegotiation,
  getSearch,
  listConversations,
  listProducts,
  logout,
  rejectNegotiation,
  startConversation,
  streamMessage,
  transcribeAudio,
  uploadImage,
  type AuthUser,
  type ConversationSummary,
  type NegotiationDetail,
  type Product,
} from "@/lib/api";

type NegStatus = "accepted" | "rejected" | "running" | "pending" | "awaiting_buyer" | "timed_out" | "error" | null;

type Tile = {
  id: string;
  title: string;
  askPrice?: number;
  imageUrl?: string;
  finalPrice?: number;
  negStatus: NegStatus;
  negId?: string;
  h: number;
  color: string;
};

const SKELETON_TILES = [
  { id: "s1", h: 280 }, { id: "s2", h: 340 }, { id: "s3", h: 240 },
  { id: "s4", h: 320 }, { id: "s5", h: 360 }, { id: "s6", h: 260 },
  { id: "s7", h: 300 }, { id: "s8", h: 220 }, { id: "s9", h: 290 },
  { id: "s10", h: 330 }, { id: "s11", h: 250 }, { id: "s12", h: 270 },
];

const TILE_HEIGHTS = [200, 220, 240, 260, 280, 300, 320, 340, 360];
const TILE_COLORS = [
  "hsl(220 14% 84%)",
  "hsl(220 14% 86%)",
  "hsl(220 14% 88%)",
  "hsl(220 14% 90%)",
  "hsl(220 14% 92%)",
];
const PRODUCTS_PAGE_SIZE = 10000;

function productsToTiles(products: Product[]): Tile[] {
  return products.map((product, i) => ({
    id: product.id,
    title: product.title,
    askPrice: product.askPrice,
    imageUrl: product.imageUrl ?? undefined,
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
  imageUrl?: string;
};

type ChatMode = "idle" | "buying" | "posting_product";

export default function ExplorePage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("idle");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [visibleProductCount, setVisibleProductCount] = useState(PRODUCTS_PAGE_SIZE);
  const [searchTiles, setSearchTiles] = useState<Tile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchStatus, setSearchStatus] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [chatHistory, setChatHistory] = useState<ConversationSummary[]>([]);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [activeNeg, setActiveNeg] = useState<NegotiationDetail | null>(null);
  const [pendingDealNegId, setPendingDealNegId] = useState<string | null>(null);
  const [dismissedDeals, setDismissedDeals] = useState<Set<string>>(new Set());
  const [successDeal, setSuccessDeal] = useState<{ title: string; finalPrice: number; imageUrl?: string } | null>(null);
  const chatOpen = messages.length > 0;
  const visibleProducts = useMemo(
    () => products.slice(0, visibleProductCount),
    [products, visibleProductCount],
  );
  const browseTiles = products.length > 0 ? productsToTiles(visibleProducts) : [];
  const tiles = searchTiles.length > 0 || searching ? searchTiles : browseTiles;
  const isLoadingProducts = products.length === 0 && !authLoading;
  const hasMoreProducts = visibleProductCount < products.length;

  useEffect(() => {
    getMe()
      .then((me) => {
        if (!me) {
          router.replace("/login");
          return;
        }
        setUser(me);
      })
      .catch(() => {
        router.replace("/login");
      })
      .finally(() => setAuthLoading(false));
  }, [router]);

  const refreshProducts = useCallback(() => {
    listProducts()
      .then((nextProducts) => {
        setProducts(nextProducts);
        setVisibleProductCount(PRODUCTS_PAGE_SIZE);
      })
      .catch(() => {
        // keep fallback tiles
      });
  }, []);

  useEffect(() => {
    refreshProducts();
  }, [refreshProducts]);

  const loadSearchFromUrl = useCallback(async (searchId: string) => {
    try {
      const search = await getSearch(searchId);
      const newTiles: Tile[] = search.negotiations.map((neg, i) => ({
        id: neg.product.id,
        title: neg.product.title,
        askPrice: neg.product.askPrice,
        imageUrl: neg.product.imageUrl ?? undefined,
        finalPrice: neg.finalPrice ?? undefined,
        negStatus: neg.status as NegStatus,
        negId: neg.id,
        h: TILE_HEIGHTS[i % TILE_HEIGHTS.length]!,
        color: TILE_COLORS[i % TILE_COLORS.length]!,
      }));
      if (newTiles.length > 0) setSearchTiles(newTiles);
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
    setSearchStatus("Buscando productos...");
    if (resetTiles) setSearchTiles([]);
    const reportedNegotiationStates = new Map<string, string>();

    const poll = async () => {
      try {
        const search = await getSearch(searchId);

        if (search.negotiations.length === 0 && search.status !== "completed" && search.status !== "failed") {
          setSearchStatus("Analizando productos compatibles...");
        }

        for (let i = 0; i < search.negotiations.length; i++) {
          const neg = search.negotiations[i]!;
          const product = neg.product;
          const newTile: Tile = {
            id: product.id,
            title: product.title,
            askPrice: product.askPrice,
            imageUrl: product.imageUrl ?? undefined,
            finalPrice: neg.finalPrice ?? undefined,
            negStatus: neg.status as NegStatus,
            negId: neg.id,
            h: TILE_HEIGHTS[i % TILE_HEIGHTS.length]!,
            color: TILE_COLORS[i % TILE_COLORS.length]!,
          };
          setSearchTiles((prev) => {
            const existing = prev.findIndex((t) => t.id === product.id);
            if (existing >= 0) {
              const copy = [...prev];
              copy[existing] = {
                ...newTile,
                h: copy[existing]!.h,
                color: copy[existing]!.color,
              };
              return copy;
            }
            return [...prev, newTile];
          });

          const stateKey = `${neg.status}:${neg.finalPrice ?? ""}`;
          if (reportedNegotiationStates.get(neg.id) !== stateKey) {
            reportedNegotiationStates.set(neg.id, stateKey);
            if (neg.status === "accepted" && neg.finalPrice != null) {
<<<<<<< HEAD
              setSearchStatus(`Trato cerrado: "${product.title}" a ${formatARS(neg.finalPrice)}`);
            } else if (neg.status === "awaiting_buyer") {
              setSearchStatus(`Acuerdo pendiente: "${product.title}" a ${formatARS(neg.finalPrice ?? 0)}`);
=======
              const finalPrice = neg.finalPrice;
              setMessages((prev) => [...prev, { role: "assistant", content: `Encontré "${product.title}" y cerré la negociación a ${formatARS(finalPrice)}` }]);
            } else if (neg.status === "awaiting_buyer") {
              // El modal se abre automáticamente vía useEffect que observa searchTiles.
>>>>>>> UriGandel
            } else if (neg.status === "rejected" || neg.status === "timed_out" || neg.status === "error") {
              setSearchStatus(`"${product.title}" — sin acuerdo, buscando más...`);
            } else if (neg.status === "running") {
              setSearchStatus(`Negociando "${product.title}"...`);
            } else {
              setSearchStatus(`Encontré "${product.title}", preparando negociación...`);
            }
          }
        }

        if (search.status === "completed" || search.status === "failed") {
          setSearching(false);
          const accepted = search.negotiations.find((neg) => neg.status === "accepted");
          if (accepted?.finalPrice != null) {
            setSearchStatus(`Listo! Negociación cerrada a ${formatARS(accepted.finalPrice)}`);
          } else if (search.negotiations.length === 0) {
            setSearchStatus("No encontré productos. Probá otra búsqueda.");
          } else {
            setSearchStatus("Búsqueda finalizada");
          }
          setTimeout(() => setSearchStatus(""), 5000);
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

  const pendingDeals = useMemo(() => {
    const eligible = searchTiles.filter(
      (t) =>
        t.negStatus === "awaiting_buyer" &&
        t.negId != null &&
        t.finalPrice != null &&
        !dismissedDeals.has(t.negId),
    );
    return eligible.sort((a, b) => {
      const aDrop = a.askPrice && a.finalPrice ? (a.askPrice - a.finalPrice) / a.askPrice : 0;
      const bDrop = b.askPrice && b.finalPrice ? (b.askPrice - b.finalPrice) / b.askPrice : 0;
      return bDrop - aDrop;
    });
  }, [searchTiles, dismissedDeals]);

  useEffect(() => {
    if (pendingDealNegId) {
      // Si la selección actual ya no está pendiente, saltar al mejor.
      if (!pendingDeals.some((d) => d.negId === pendingDealNegId)) {
        setPendingDealNegId(pendingDeals[0]?.negId ?? null);
      }
      return;
    }
    if (pendingDeals.length > 0) {
      setPendingDealNegId(pendingDeals[0]!.negId!);
    }
  }, [pendingDeals, pendingDealNegId]);

  useEffect(() => {
    const marker = loadMoreRef.current;
    if (!marker || !hasMoreProducts) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisibleProductCount((count) => Math.min(count + PRODUCTS_PAGE_SIZE, products.length));
      },
      { rootMargin: "200px 0px" },
    );

    observer.observe(marker);
    return () => observer.disconnect();
  }, [hasMoreProducts, products.length]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  function detectMode(text: string): ChatMode {
    const lower = text.toLowerCase();
    if (SELL_KEYWORDS.some((kw) => lower.includes(kw))) return "posting_product";
    return "buying";
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

    const msgImagePreview = imagePreview ?? undefined;
    setMessages((prev) => [...prev, { role: "user", content: text, imageUrl: msgImagePreview }, { role: "assistant", content: "" }]);
    setInput("");
    setSuggestions([]);
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
        const conv = await startConversation(mode === "posting_product" ? "posting_product" : "buying");
        convId = conv.id;
        setConversationId(conv.id);
      }
      if (!convId) throw new Error("No se pudo iniciar la conversación.");

      await streamMessage(
        convId,
        text,
        (chunk) => appendToLastAssistant(chunk),
        (data) => {
          if (data.suggestions?.length) setSuggestions(data.suggestions);
          if (data.searchId) {
            setChatCollapsed(true);
            window.history.replaceState({}, "", `/explore?id=${data.searchId}`);
            pollSearch(data.searchId);
          } else if (data.productId) {
            appendToLastAssistant("\n\nTu publicación está lista.");
            refreshProducts();
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
        imageUrl,
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
    setSearchTiles([]);
    setShowHistory(false);
    setChatCollapsed(false);
    window.history.replaceState({}, "", "/explore");
    refreshProducts();
  }

  async function toggleHistory() {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    try {
      const convs = await listConversations();
      setChatHistory(convs);
    } catch { /* ignore */ }
    setShowHistory(true);
  }

  async function restoreChat(convId: string) {
    try {
      const conv = await getConversation(convId);
      setConversationId(conv.id);
      setChatMode(conv.mode);
      setMessages(conv.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
      setShowHistory(false);
      const searchId = conv.searchId ?? conv.search?.id;
      if (searchId) {
        window.history.replaceState({}, "", `/explore?id=${searchId}`);
        loadSearchFromUrl(searchId);
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

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          setPendingImage(file);
          setImagePreview(URL.createObjectURL(file));
        }
        return;
      }
    }
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
        <a href="/explore" onClick={(e) => { e.preventDefault(); handleNewChat(); }}>
          <img src="/logo.svg" alt="negocIA" className="h-10" />
        </a>
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

      {(authLoading || isLoadingProducts) && (
        <div className="relative">
          <div className="absolute inset-0 flex items-start justify-center pt-32 z-10 pointer-events-none">
            <img src="/logo-icon.svg" alt="" className="h-12 w-12 animate-pulse" />
          </div>
          <div className="p-4 columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3 pb-28">
            {SKELETON_TILES.map((s) => (
              <div key={s.id} className="mb-3 break-inside-avoid">
                <div className="rounded-xl bg-muted animate-pulse" style={{ height: s.h }} />
                <div className="mt-1.5 h-3 w-3/4 rounded bg-muted animate-pulse" />
                <div className="mt-1 h-2.5 w-1/2 rounded bg-muted animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`p-4 columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3 pb-28 ${authLoading || isLoadingProducts ? "hidden" : ""}`}>
        {tiles.map((item, i) => (
          <div
            key={item.id}
            onClick={() => {
              if (item.negStatus === "awaiting_buyer" && item.negId) {
                setDismissedDeals((prev) => {
                  const next = new Set(prev);
                  next.delete(item.negId!);
                  return next;
                });
                setPendingDealNegId(item.negId);
              }
            }}
            className="mb-3 break-inside-avoid cursor-pointer group animate-msg-in transition-transform duration-300 ease-out hover:scale-[1.03] hover:-translate-y-1"
            style={{ animationDelay: searching ? `${i * 0.15}s` : "0s" }}
          >
            <div
              className="rounded-xl overflow-hidden relative"
              style={{ backgroundColor: item.color, height: item.h }}
            >
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.title} loading="lazy" className="w-full h-full object-cover block transition-transform duration-500 ease-out group-hover:scale-110" />
              ) : (
                <div style={{ height: item.h }} />
              )}
              {item.negStatus === "accepted" && (
                <span className="absolute top-2 left-2 bg-accent text-accent-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                  Cerrado
                </span>
              )}
              {item.negStatus === "rejected" && (
                <span className="absolute top-2 left-2 bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                  Sin acuerdo
                </span>
              )}
              {item.negStatus === "awaiting_buyer" && (
                <span className="absolute top-2 left-2 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                  Tu confirmación
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
              {item.finalPrice != null ? (
                <span className="text-xs text-accent font-bold">{formatARS(item.finalPrice)}</span>
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

      {products.length > PRODUCTS_PAGE_SIZE && (
        <div ref={loadMoreRef} className="px-4 pb-32 pt-2 text-center text-xs text-muted-foreground">
          {hasMoreProducts ? `Mostrando ${visibleProducts.length} de ${products.length}` : "No hay más publicaciones"}
        </div>
      )}

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
                  <p className="text-xs font-medium text-foreground truncate flex-1">{activeNeg.product.title}</p>
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
                          {msg.imageUrl && (
                            <button type="button" onClick={() => setLightboxSrc(msg.imageUrl!)} className="block mb-2">
                              <img src={msg.imageUrl} alt="Imagen adjunta" className="max-h-40 rounded-xl object-cover hover:opacity-90 transition-opacity cursor-pointer" />
                            </button>
                          )}
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
                {suggestions.length > 0 && !streaming && (
                  <div className="flex flex-wrap gap-2 animate-msg-in">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setInput(s);
                          setSuggestions([]);
                          setTimeout(() => textareaRef.current?.focus(), 0);
                        }}
                        className="px-3 py-1.5 text-xs rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
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
                <div className={`flex items-end gap-1.5 ${chatOpen || showHistory ? "border border-black/10 rounded-3xl px-2 py-1.5" : "px-2"}`}>
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
                        onPaste={handlePaste}
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

      {/* Confirm deal modal */}
      {pendingDealNegId && pendingDeals.length > 0 && (
        <ConfirmDealModal
          deals={pendingDeals}
          currentNegId={pendingDealNegId}
          onSelect={(id) => setPendingDealNegId(id)}
          onAccept={async (acceptedId) => {
            const accepted = pendingDeals.find((d) => d.negId === acceptedId);
            const others = pendingDeals.filter((d) => d.negId !== acceptedId).map((d) => d.negId!);
            await acceptNegotiation(acceptedId);
            await Promise.allSettled(others.map((oid) => rejectNegotiation(oid)));
            setSearchTiles((prev) =>
              prev.map((t) => {
                if (t.negId === acceptedId) return { ...t, negStatus: "accepted" as NegStatus };
                if (t.negId && others.includes(t.negId)) return { ...t, negStatus: "rejected" as NegStatus };
                return t;
              }),
            );
            setPendingDealNegId(null);
            if (accepted?.finalPrice != null) {
              setSuccessDeal({
                title: accepted.title,
                finalPrice: accepted.finalPrice,
                imageUrl: accepted.imageUrl,
              });
            }
          }}
          onReject={async (rejectedId) => {
            const rejected = pendingDeals.find((d) => d.negId === rejectedId);
            await rejectNegotiation(rejectedId);
            setSearchTiles((prev) =>
              prev.map((t) =>
                t.negId === rejectedId ? { ...t, negStatus: "rejected" as NegStatus } : t,
              ),
            );
            setPendingDealNegId(null); // useEffect re-elige el siguiente mejor.
            if (rejected) {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: `Rechazaste el acuerdo de "${rejected.title}".` },
              ]);
            }
          }}
          onDismiss={() => {
            setDismissedDeals((prev) => new Set(prev).add(pendingDealNegId));
            setPendingDealNegId(null);
          }}
        />
      )}

      {/* Success overlay */}
      {successDeal && (
        <SuccessDealOverlay
          title={successDeal.title}
          finalPrice={successDeal.finalPrice}
          imageUrl={successDeal.imageUrl}
          onHome={() => {
            setSuccessDeal(null);
            handleNewChat();
          }}
        />
      )}

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

function ConfirmDealModal({
  deals,
  currentNegId,
  onSelect,
  onAccept,
  onReject,
  onDismiss,
}: {
  deals: Tile[];
  currentNegId: string;
  onSelect: (negId: string) => void;
  onAccept: (negId: string) => Promise<void>;
  onReject: (negId: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const [actionState, setActionState] = useState<"idle" | "accepting" | "rejecting">("idle");
  const [actionError, setActionError] = useState<string | null>(null);

  const idx = Math.max(0, deals.findIndex((d) => d.negId === currentNegId));
  const tile = deals[idx] ?? deals[0]!;
  const total = deals.length;
  const isBest = idx === 0;
  const busy = actionState !== "idle";

  const askPrice = tile.askPrice ?? 0;
  const finalPrice = tile.finalPrice ?? 0;
  const dropPct = askPrice > 0 ? Math.round(((askPrice - finalPrice) / askPrice) * 100) : 0;
  const savings = askPrice > 0 ? askPrice - finalPrice : 0;

  const handle = async (kind: "accepting" | "rejecting", fn: () => Promise<void>) => {
    setActionError(null);
    setActionState(kind);
    try {
      await fn();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionState("idle");
    }
  };

  const goPrev = () => {
    if (busy) return;
    const next = deals[(idx - 1 + total) % total];
    if (next?.negId) onSelect(next.negId);
  };
  const goNext = () => {
    if (busy) return;
    const next = deals[(idx + 1) % total];
    if (next?.negId) onSelect(next.negId);
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={() => { if (!busy) onDismiss(); }}
    >
      <div
        className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl animate-scale-in overflow-hidden border border-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full liquid-glass flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-50"
          aria-label="Cerrar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/70">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="relative">
          {tile.imageUrl ? (
            <img src={tile.imageUrl} alt={tile.title} className="w-full max-h-72 object-cover" />
          ) : (
            <div className="w-full h-56" style={{ backgroundColor: tile.color }} />
          )}
          {isBest && total > 1 && (
            <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-primary/95 text-primary-foreground text-[10px] font-bold px-2.5 py-1 shadow-md">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9" />
              </svg>
              Mejor acuerdo
            </span>
          )}
          {dropPct > 0 && (
            <span className="absolute bottom-3 left-3 inline-flex items-center rounded-full bg-accent text-accent-foreground text-xs font-bold px-2.5 py-1 shadow-md">
              -{dropPct}%
            </span>
          )}
        </div>

        <div className="p-5 space-y-4">
          {total > 1 && (
            <div className="flex items-center justify-between -mt-1">
              <button
                type="button"
                onClick={goPrev}
                disabled={busy}
                className="w-8 h-8 rounded-full hover:bg-black/5 flex items-center justify-center transition-colors disabled:opacity-40"
                aria-label="Anterior acuerdo"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/60">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Acuerdo {idx + 1} de {total}
              </p>
              <button
                type="button"
                onClick={goNext}
                disabled={busy}
                className="w-8 h-8 rounded-full hover:bg-black/5 flex items-center justify-center transition-colors disabled:opacity-40"
                aria-label="Siguiente acuerdo"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/60">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          )}

          <div>
            <p className="text-[10px] uppercase tracking-wider text-primary font-semibold">Tu agente cerró un acuerdo</p>
            <h2
              className="mt-1 text-2xl text-foreground leading-tight"
              style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
            >
              {tile.title}
            </h2>
          </div>

          <div className="rounded-2xl bg-muted/60 p-4 space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Precio acordado</span>
              <span
                className="text-3xl text-accent"
                style={{ fontFamily: "var(--font-heading)", fontStyle: "italic", fontWeight: 600 }}
              >
                {formatARS(finalPrice)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Pedido original</span>
              <span className="text-foreground/60 line-through">{formatARS(askPrice)}</span>
            </div>
            {savings > 0 && (
              <p className="pt-1 text-xs text-accent font-medium text-right">
                Ahorrás {formatARS(savings)}
              </p>
            )}
          </div>

          {total > 1 && (
            <p className="text-xs text-muted-foreground">
              Hay {total} acuerdos pendientes. Si aceptás éste, los demás se cancelan automáticamente.
            </p>
          )}

          {actionError && (
            <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2">
              No pudimos guardar tu respuesta: {actionError}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => handle("rejecting", () => onReject(tile.negId!))}
              disabled={busy}
              className="flex-1 rounded-2xl border border-border bg-white px-4 py-3 text-sm font-medium text-foreground/70 hover:bg-muted disabled:opacity-60 transition-colors"
            >
              {actionState === "rejecting" ? "Rechazando…" : "No aceptar"}
            </button>
            <button
              type="button"
              onClick={() => handle("accepting", () => onAccept(tile.negId!))}
              disabled={busy}
              className="flex-1 rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground hover:bg-accent/90 disabled:opacity-60 transition-colors shadow-md"
            >
              {actionState === "accepting" ? "Cerrando…" : "Aceptar trato"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SuccessDealOverlay({
  title,
  finalPrice,
  imageUrl,
  onHome,
}: {
  title: string;
  finalPrice: number;
  imageUrl?: string;
  onHome: () => void;
}) {
  const [countdown, setCountdown] = useState(6);

  useEffect(() => {
    if (countdown <= 0) {
      onHome();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, onHome]);

  // Confetti pieces — generated once.
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }).map((_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 2 + Math.random() * 2,
        rotate: Math.random() * 360,
        color: i % 3 === 0 ? "hsl(38 92% 50%)" : i % 3 === 1 ? "hsl(152 69% 40%)" : "hsl(45 93% 58%)",
        size: 6 + Math.random() * 8,
      })),
    [],
  );

  return (
    <div className="fixed inset-0 z-[110] bg-background/95 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in overflow-hidden">
      {/* Confetti */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {pieces.map((p, i) => (
          <span
            key={i}
            className="absolute -top-4 block rounded-sm"
            style={{
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 0.4,
              backgroundColor: p.color,
              transform: `rotate(${p.rotate}deg)`,
              animation: `confetti-fall ${p.duration}s ${p.delay}s ease-in forwards`,
            }}
          />
        ))}
      </div>

      <div className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl border border-black/5 overflow-hidden animate-scale-in">
        <div className="px-6 pt-8 pb-6 text-center">
          <div className="mx-auto w-20 h-20 rounded-full bg-accent text-accent-foreground flex items-center justify-center shadow-lg animate-scale-in">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="mt-5 text-[11px] uppercase tracking-wider text-accent font-semibold">¡Trato cerrado!</p>
          <h2
            className="mt-2 text-3xl text-foreground leading-tight"
            style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
          >
            ¡Felicitaciones!
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Compraste <span className="font-medium text-foreground">{title}</span> por
          </p>
          <p
            className="mt-1 text-4xl text-accent"
            style={{ fontFamily: "var(--font-heading)", fontStyle: "italic", fontWeight: 600 }}
          >
            {formatARS(finalPrice)}
          </p>
        </div>

        {imageUrl && (
          <div className="px-6 pb-4">
            <img src={imageUrl} alt={title} className="w-full max-h-44 object-cover rounded-2xl" />
          </div>
        )}

        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={onHome}
            className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-md"
          >
            Volver al inicio {countdown > 0 && <span className="opacity-70">· {countdown}s</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
