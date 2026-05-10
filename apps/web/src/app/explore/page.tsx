"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import confetti from "canvas-confetti";
import {
  getMe,
  getConversation,
  getNegotiation,
  getSearch,
  getAutoPaySettings,
  updateAutoPaySettings,
  getMpConnectUrl,
  disconnectMp,
  acceptNegotiation,
  listConversations,
  listProducts,
  logout,
  startConversation,
  streamMessage,
  transcribeAudio,
  uploadImage,
  type AuthUser,
  type AutoPaySettings,
  type ConversationSummary,
  type NegotiationDetail,
  type Product,
} from "@/lib/api";

type NegStatus = "accepted" | "rejected" | "running" | "pending" | "timed_out" | "error" | "awaiting_buyer" | null;

type Tile = {
  id: string;
  title: string;
  description?: string;
  askPrice?: number;
  imageUrl?: string;
  finalPrice?: number;
  negStatus: NegStatus;
  negId?: string;
  autoPaid?: boolean;
  verificationCode?: string | null;
  messages?: { side: string; action: string; proposedPrice: number | null; content: string }[];
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
  const [productsLoaded, setProductsLoaded] = useState(false);
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
  const [showAutoPayModal, setShowAutoPayModal] = useState(false);
  const [autoPayForm, setAutoPayForm] = useState({
    enabled: false,
    maxAmount: "",
    categories: [] as string[],
    maxPerSearch: 1,
  });
  const [autoPaySaving, setAutoPaySaving] = useState(false);
  const [autoPayLoaded, setAutoPayLoaded] = useState(false);
  const [showMpModal, setShowMpModal] = useState(false);
  const [mpConnecting, setMpConnecting] = useState(false);

  const [purchaseSuccess, setPurchaseSuccess] = useState<{ title: string; imageUrl?: string; price: number; autoPaid: boolean } | null>(null);
  const chatOpen = messages.length > 0;
  const visibleProducts = useMemo(
    () => products.slice(0, visibleProductCount),
    [products, visibleProductCount],
  );
  const browseTiles = products.length > 0 ? productsToTiles(visibleProducts) : [];
  const tiles = searchTiles.length > 0 || searching ? searchTiles : browseTiles;
  const isLoadingProducts = !productsLoaded && !authLoading;
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
      .catch(() => {})
      .finally(() => setProductsLoaded(true));
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
            description: product.description ?? undefined,
            askPrice: product.askPrice,
            imageUrl: product.imageUrl ?? undefined,
            finalPrice: neg.finalPrice ?? undefined,
            negStatus: neg.status as NegStatus,
            negId: neg.id,
            autoPaid: neg.autoPaid,
            verificationCode: neg.verificationCode,
            messages: neg.messages?.map((m: { side: string; action: string; proposedPrice: number | null; content: string }) => ({
              side: m.side,
              action: m.action,
              proposedPrice: m.proposedPrice,
              content: m.content,
            })),
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
              setSearchStatus(`Trato cerrado: "${product.title}" a ${formatARS(neg.finalPrice)}`);
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
            setSearchTiles([]);
            setChatCollapsed(false);
            setMessages((prev) => [...prev, { role: "assistant", content: "No encontré productos que coincidan con lo que buscás. Probá con otra búsqueda o cambiá los filtros." }]);
            window.history.replaceState({}, "", "/explore");
            setSearchStatus("");
            return;
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

  async function handleSend(e?: React.FormEvent, overrideText?: string) {
    e?.preventDefault();
    const text = (overrideText ?? input).trim();
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
          if (mode === "posting_product" && data.suggestions?.length) {
            setSuggestions(data.suggestions);
          }
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

  async function openAutoPayModal() {
    setShowAutoPayModal(true);
    if (!autoPayLoaded) {
      try {
        const settings = await getAutoPaySettings();
        setAutoPayForm({
          enabled: settings.autoPayEnabled,
          maxAmount: settings.autoPayMaxAmount?.toString() ?? "",
          categories: settings.autoPayCategories,
          maxPerSearch: settings.autoPayMaxPerSearch,
        });
        setAutoPayLoaded(true);
      } catch { /* ignore */ }
    }
  }

  async function saveAutoPay() {
    setAutoPaySaving(true);
    try {
      await updateAutoPaySettings({
        enabled: autoPayForm.enabled,
        maxAmount: autoPayForm.maxAmount ? Number(autoPayForm.maxAmount) : null,
        categories: autoPayForm.categories,
        maxPerSearch: autoPayForm.maxPerSearch,
      });
      setShowAutoPayModal(false);
    } catch { /* ignore */ }
    setAutoPaySaving(false);
  }

  function toggleCategory(cat: string) {
    setAutoPayForm((prev) => ({
      ...prev,
      categories: prev.categories.includes(cat)
        ? prev.categories.filter((c) => c !== cat)
        : [...prev.categories, cat],
    }));
  }

  function fireConfetti() {
    const duration = 2000;
    const end = Date.now() + duration;
    const frame = () => {
      confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 0.7 } });
      confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.7 } });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  }

  function showPurchaseSuccess(tile: Tile, autoPaid: boolean) {
    setPurchaseSuccess({
      title: tile.title,
      imageUrl: tile.imageUrl,
      price: tile.finalPrice ?? tile.askPrice ?? 0,
      autoPaid,
    });
    fireConfetti();
  }

  async function handleAcceptDeal(tile: Tile) {
    if (!tile.negId) return;
    try {
      await acceptNegotiation(tile.negId);
      showPurchaseSuccess(tile, false);
      setSearchTiles((prev) =>
        prev.map((t) => t.id === tile.id ? { ...t, negStatus: "accepted" as NegStatus } : t),
      );
    } catch { /* ignore */ }
  }

  function handleRejectDeal(tile: Tile) {
    setSearchTiles((prev) =>
      prev.map((t) => t.id === tile.id ? { ...t, negStatus: "rejected" as NegStatus } : t),
    );
  }

  // Detect auto-pay success and fire confetti
  const prevTilesRef = useRef<Tile[]>([]);
  useEffect(() => {
    if (!searching && searchTiles.length === 0) return;
    for (const tile of searchTiles) {
      const prev = prevTilesRef.current.find((t) => t.id === tile.id);
      if (tile.autoPaid && (!prev || !prev.autoPaid)) {
        showPurchaseSuccess(tile, true);
        break;
      }
      if (tile.negStatus === "awaiting_buyer" && prev?.negStatus !== "awaiting_buyer" && !tile.autoPaid) {
        // Deal closed, awaiting manual confirmation — scroll into view
      }
    }
    prevTilesRef.current = searchTiles;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTiles, searching]);

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
                  onClick={() => { setShowUserMenu(false); router.push("/dashboard"); }}
                  className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-black/5 transition-colors flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/50">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                  </svg>
                  Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => { setShowUserMenu(false); openAutoPayModal(); }}
                  className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-black/5 transition-colors flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/50">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Auto-Pay
                </button>
                <button
                  type="button"
                  onClick={() => { setShowUserMenu(false); setShowMpModal(true); }}
                  className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-black/5 transition-colors flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/50">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="8.5" cy="7" r="4" />
                    <line x1="20" y1="8" x2="20" y2="14" />
                    <line x1="23" y1="11" x2="17" y2="11" />
                  </svg>
                  Integraciones
                  {!user?.mpConnected && <span className="ml-auto w-2 h-2 rounded-full bg-destructive" />}
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

      <div className={`p-4 pb-28 ${authLoading || isLoadingProducts ? "hidden" : ""} ${searchTiles.length > 0 || searching ? "flex flex-col gap-4 max-w-2xl mx-auto" : "columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3"}`}>
        {tiles.map((item, i) => {
          const isSearchMode = searchTiles.length > 0 || searching;
          const borderColor = item.negStatus === "accepted" || item.negStatus === "awaiting_buyer"
            ? "ring-2 ring-green-500"
            : item.negStatus === "rejected" || item.negStatus === "timed_out" || item.negStatus === "error"
            ? "ring-2 ring-red-400"
            : item.negStatus === "running"
            ? "ring-2 ring-primary animate-pulse"
            : "";

          if (isSearchMode) {
            return (
              <div
                key={item.id}
                className={`rounded-2xl overflow-hidden bg-white shadow-lg border border-border animate-msg-in ${borderColor}`}
                style={{ animationDelay: `${i * 0.2}s` }}
              >
                <div className="flex gap-0">
                  <div className="w-40 h-40 shrink-0 bg-muted relative">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-3xl opacity-20">📦</span>
                      </div>
                    )}
                    {item.negStatus === "accepted" || item.negStatus === "awaiting_buyer" ? (
                      <span className="absolute top-2 left-2 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Cerrado</span>
                    ) : item.negStatus === "rejected" || item.negStatus === "timed_out" || item.negStatus === "error" ? (
                      <span className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Sin acuerdo</span>
                    ) : item.negStatus === "running" || item.negStatus === "pending" ? (
                      <span className="absolute top-2 left-2 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">Negociando...</span>
                    ) : null}
                  </div>
                  <div className="flex-1 p-3 flex flex-col min-w-0">
                    <p className="text-sm font-medium text-foreground line-clamp-1">{item.title}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{item.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      {item.askPrice != null && (
                        <span className="text-xs text-muted-foreground">{formatARS(item.askPrice)}</span>
                      )}
                      {item.finalPrice != null && (
                        <span className="text-xs font-bold text-green-600">{formatARS(item.finalPrice)}</span>
                      )}
                    </div>
                    {item.messages && item.messages.length > 0 && (
                      <div className="mt-2 flex-1 overflow-hidden space-y-1">
                        {item.messages.slice(-3).map((msg, mi) => (
                          <div key={mi} className={`flex ${msg.side === "buyer" ? "justify-end" : "justify-start"}`}>
                            <div className={`px-2 py-0.5 rounded-lg max-w-[85%] ${
                              msg.side === "buyer" ? "bg-primary/20 text-foreground" : "bg-muted text-foreground"
                            }`}>
                              <span className="text-[10px] opacity-60 mr-1">{msg.side === "buyer" ? "🤖" : "🏷️"}</span>
                              <span className="text-[11px]">{msg.content}</span>
                              {msg.proposedPrice != null && (
                                <span className="text-[10px] font-bold ml-1">{formatARS(msg.proposedPrice)}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {item.negStatus === "awaiting_buyer" && !item.autoPaid && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => handleAcceptDeal(item)}
                          className="flex-1 h-7 bg-green-500 text-white text-xs font-medium rounded-lg hover:bg-green-600 transition-colors"
                        >
                          Aceptar {item.finalPrice != null ? formatARS(item.finalPrice) : ""}
                        </button>
                        <button
                          onClick={() => handleRejectDeal(item)}
                          className="h-7 px-3 border border-red-300 text-red-500 text-xs font-medium rounded-lg hover:bg-red-50 transition-colors"
                        >
                          Rechazar
                        </button>
                      </div>
                    )}
                    {item.autoPaid && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Auto-pagado</span>
                        {item.verificationCode && (
                          <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full font-mono">{item.verificationCode}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={item.id}
              className="mb-3 break-inside-avoid cursor-pointer group animate-msg-in transition-transform duration-300 ease-out hover:scale-[1.03] hover:-translate-y-1"
              style={{ animationDelay: "0s" }}
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
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 px-0.5 group-hover:text-foreground transition-colors line-clamp-2">
                {item.title}
              </p>
              {item.askPrice != null && (
                <p className="text-xs text-foreground/80 font-medium px-0.5 mt-0.5">{formatARS(item.askPrice)}</p>
              )}
            </div>
          );
        })}
        {searching && tiles.length === 0 && (
          <div className={searchTiles.length > 0 || searching ? "" : "mb-3 break-inside-avoid"}>
            <div className="rounded-xl bg-border animate-pulse flex items-center justify-center animate-msg-in" style={{ height: 160 }}>
              <img src="/logo-icon.svg" alt="" className="h-8 w-8 grayscale opacity-20 animate-thinking" />
            </div>
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
        <div className="shrink-0 self-end mb-[5px]">
          <button
            type="button"
            onClick={toggleHistory}
            className="liquid-glass w-[44px] h-[44px] rounded-full flex items-center justify-center hover:scale-105 transition-transform"
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
                {suggestions.length > 0 && !streaming && chatMode === "posting_product" && (
                  <div className="flex flex-wrap gap-2 animate-msg-in pt-1">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setSuggestions([]);
                          handleSend(undefined, s);
                        }}
                        className="px-3 py-1.5 text-xs rounded-full bg-foreground/10 text-foreground hover:bg-foreground/20 transition-colors font-medium"
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
              {!user?.mpConnected ? (
                <div className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setShowMpModal(true)}
                    className="w-full flex items-center justify-center gap-2 h-10 rounded-full border border-[#009ee3]/30 bg-[#009ee3]/5 hover:bg-[#009ee3]/10 transition-colors"
                  >
                    <img src="/mp-handshake.svg" alt="" className="h-5" />
                    <span className="text-sm text-[#009ee3] font-medium">Conecta Mercado Pago para empezar</span>
                  </button>
                </div>
              ) : (
              <form onSubmit={handleSend} className={chatOpen || showHistory ? "px-3 py-3" : "px-3 py-2.5"}>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                <div className={`flex items-center gap-1.5 ${chatOpen || showHistory ? "border border-black/10 rounded-3xl px-2 py-1.5" : "px-2"}`}>
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
                        style={{ height: "32px", maxHeight: "160px", lineHeight: "32px", paddingTop: "0px", paddingBottom: "0px" }}
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
              )}
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

      {showMpModal && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowMpModal(false)}>
          <div className="bg-background rounded-2xl w-full max-w-sm shadow-2xl border border-border animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Integraciones</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Conecta tu cuenta para operar</p>
              </div>
              <button onClick={() => setShowMpModal(false)} className="text-muted-foreground hover:text-foreground">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="p-6">
              <div className="flex flex-col items-center gap-3">
                <img src="/mercado-pago.svg" alt="Mercado Pago" className="h-16 w-16" />
                <div className="text-center">
                  <p className="text-sm font-medium">Mercado Pago</p>
                  <p className="text-xs text-muted-foreground">
                    {user?.mpConnected ? "Cuenta conectada" : "Necesario para comprar y vender"}
                  </p>
                </div>
                {user?.mpConnected ? (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/10 text-accent text-xs font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    Activo
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/10 text-destructive text-xs font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
                    Inactivo
                  </span>
                )}
              </div>

              <div className="mt-6">
                {user?.mpConnected ? (
                  <button
                    onClick={async () => {
                      setMpConnecting(true);
                      try {
                        await disconnectMp();
                        setUser((u) => u ? { ...u, mpConnected: false } : u);
                      } catch { /* ignore */ }
                      setMpConnecting(false);
                    }}
                    disabled={mpConnecting}
                    className="w-full h-10 border border-destructive text-destructive rounded-lg text-sm font-medium hover:bg-destructive/5 transition-colors disabled:opacity-50"
                  >
                    {mpConnecting ? "Desconectando..." : "Desconectar cuenta"}
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      setMpConnecting(true);
                      try {
                        const { url } = await getMpConnectUrl();
                        window.location.href = url;
                      } catch {
                        setMpConnecting(false);
                      }
                    }}
                    disabled={mpConnecting}
                    className="w-full h-10 bg-[#009ee3] text-white rounded-lg text-sm font-medium hover:bg-[#007eb5] transition-colors disabled:opacity-50"
                  >
                    {mpConnecting ? "Conectando..." : "Conectar Mercado Pago"}
                  </button>
                )}
              </div>

              {!user?.mpConnected && (
                <p className="text-[10px] text-muted-foreground mt-3 text-center">
                  Sin Mercado Pago conectado no podes buscar ni publicar productos
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {purchaseSuccess && (
        <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4 animate-fade-in" onClick={() => setPurchaseSuccess(null)}>
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl animate-scale-in text-center p-8" onClick={(e) => e.stopPropagation()}>
            {purchaseSuccess.imageUrl && (
              <img src={purchaseSuccess.imageUrl} alt="" className="w-32 h-32 object-cover rounded-2xl mx-auto mb-4 shadow-lg" />
            )}
            <p className="text-2xl font-bold text-foreground mb-1">Compra exitosa!</p>
            <p className="text-sm text-muted-foreground mb-2">{purchaseSuccess.title}</p>
            <p className="text-xl font-bold text-green-600 mb-4">{formatARS(purchaseSuccess.price)}</p>
            {purchaseSuccess.autoPaid && (
              <span className="inline-block px-3 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium mb-4">Pagado automaticamente</span>
            )}
            <button
              onClick={() => setPurchaseSuccess(null)}
              className="w-full h-10 bg-foreground text-background rounded-xl text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {showAutoPayModal && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowAutoPayModal(false)}>
          <div className="bg-background rounded-2xl w-full max-w-md shadow-2xl border border-border animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Auto-Pay</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Tu agente paga cuando cierra un trato</p>
              </div>
              <button onClick={() => setShowAutoPayModal(false)} className="text-muted-foreground hover:text-foreground">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Activar Auto-Pay</p>
                  <p className="text-xs text-muted-foreground">El agente paga sin pedirte confirmacion</p>
                </div>
                <button
                  onClick={() => setAutoPayForm((p) => ({ ...p, enabled: !p.enabled }))}
                  className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${autoPayForm.enabled ? "bg-primary" : "bg-border"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${autoPayForm.enabled ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>

              <div className={autoPayForm.enabled ? "" : "opacity-40 pointer-events-none"}>
                <label className="text-xs text-muted-foreground mb-1.5 block">Monto maximo por compra (ARS)</label>
                <input
                  type="number"
                  placeholder="Sin limite"
                  value={autoPayForm.maxAmount}
                  onChange={(e) => setAutoPayForm((p) => ({ ...p, maxAmount: e.target.value }))}
                  className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Dejalo vacio para no poner limite</p>
              </div>

              <div className={autoPayForm.enabled ? "" : "opacity-40 pointer-events-none"}>
                <label className="text-xs text-muted-foreground mb-1.5 block">Categorias permitidas</label>
                <div className="flex flex-wrap gap-2">
                  {["electronics", "vehicles", "apparel", "furniture", "home-goods", "sporting-goods", "musical-instruments", "toys-games"].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      className={`px-3 py-1.5 rounded-full text-xs transition-colors border ${
                        autoPayForm.categories.includes(cat)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-foreground/30"
                      }`}
                    >
                      {cat === "electronics" ? "Electronica" :
                       cat === "vehicles" ? "Vehiculos" :
                       cat === "apparel" ? "Ropa" :
                       cat === "furniture" ? "Muebles" :
                       cat === "home-goods" ? "Hogar" :
                       cat === "sporting-goods" ? "Deportes" :
                       cat === "musical-instruments" ? "Instrumentos" :
                       "Juguetes"}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Sin seleccion = todas las categorias</p>
              </div>

              <div className={autoPayForm.enabled ? "" : "opacity-40 pointer-events-none"}>
                <label className="text-xs text-muted-foreground mb-1.5 block">Max compras por busqueda</label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setAutoPayForm((p) => ({ ...p, maxPerSearch: n }))}
                      className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors border ${
                        autoPayForm.maxPerSearch === n
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-foreground/30"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-border">
              <button
                onClick={saveAutoPay}
                disabled={autoPaySaving}
                className="w-full h-10 bg-foreground text-background rounded-lg text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50"
              >
                {autoPaySaving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
