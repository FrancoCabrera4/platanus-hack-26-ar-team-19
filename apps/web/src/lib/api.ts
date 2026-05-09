const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const code = data?.error ? (typeof data.error === "string" ? data.error : "validation_error") : `http_${res.status}`;
    throw new ApiError(res.status, code);
  }
  return data as T;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return parseJson<T>(res);
}

export type AuthUser = {
  id: string;
  name: string;
  email: string;
};

export type AuthResponse = {
  user: AuthUser;
};

export async function signup(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function getMe(): Promise<AuthUser | null> {
  try {
    const data = await apiFetch<{ user: AuthUser }>("/auth/me");
    return data.user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function createUser(name: string, email: string) {
  return apiFetch<AuthUser>("/users", {
    method: "POST",
    body: JSON.stringify({ name, email }),
  });
}

export type ConversationMode = "buying" | "posting_product";

export type ConversationSummary = {
  id: string;
  mode: ConversationMode;
  status: string;
  searchId: string | null;
  productId: string | null;
  createdAt: string;
  preview: string;
};

export async function listConversations(mode?: ConversationMode): Promise<ConversationSummary[]> {
  const query = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  return apiFetch<ConversationSummary[]>(`/conversations${query}`);
}

export async function getConversation(id: string) {
  return apiFetch<{
    id: string;
    mode: ConversationMode;
    status: string;
    messages: { role: string; content: string }[];
    searchId?: string | null;
    productId?: string | null;
    search?: { id: string } | null;
    product?: { id: string } | null;
  }>(`/conversations/${id}`);
}

export async function startConversation(mode: ConversationMode) {
  return apiFetch<{ id: string; mode: ConversationMode; messages: { role: string; content: string }[] }>("/conversations", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export async function streamMessage(
  conversationId: string,
  content: string,
  onChunk: (text: string) => void,
  onDone: (data: { state: unknown; searchId?: string; productId?: string; jobId?: string; suggestions?: string[] }) => void,
  onError: (error: string) => void,
  signal?: AbortSignal,
  imageUrl?: string,
) {
  const res = await fetch(
    `${API_URL}/conversations/${conversationId}/messages/stream`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, ...(imageUrl ? { imageUrl } : {}) }),
      signal,
    },
  );

  if (!res.ok || !res.body) {
    let code = "Error conectando con el agente";
    try {
      const data = await res.json();
      if (data?.error) code = data.error;
    } catch {
      // keep fallback
    }
    onError(code);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function processLines(lines: string[]) {
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.error) {
          onError(data.error);
          return;
        }
        if (data.chunk) onChunk(data.chunk);
        if (data.done) onDone(data);
      } catch {
        // skip malformed lines
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    processLines(lines);
  }

  // Process any remaining data left in the buffer after the stream closes.
  // The server sends the final "done" event and calls res.end() immediately,
  // so the last SSE event can arrive in the same chunk that closes the stream.
  if (buffer.trim()) {
    processLines(buffer.split("\n"));
  }
}

export type Product = {
  id: string;
  userId: string;
  title: string;
  description: string;
  category: string | null;
  condition: string | null;
  imageUrl: string | null;
  askPrice: number;
  maxPrice: number | null;
  status: string;
  createdAt: string;
};

export type NegotiationSummary = {
  id: string;
  status: string;
  successful: boolean;
  finalPrice: number | null;
  reason: string | null;
  product: { id: string; title: string; askPrice: number; imageUrl: string | null };
};

export type SearchDetail = {
  id: string;
  query: string;
  category: string | null;
  maxPrice: number;
  negotiationStrategy: string | null;
  status: "collecting" | "ready" | "running" | "completed" | "failed";
  negotiations: NegotiationSummary[];
  jobs: { id: string; status: string; error: string | null; createdAt: string }[];
};

export type NegotiationMessage = {
  id: string;
  side: "seller" | "buyer";
  action: "offer" | "counter" | "accept" | "reject" | "open";
  proposedPrice: number | null;
  content: string;
  createdAt: string;
};

export type NegotiationDetail = {
  id: string;
  status: string;
  successful: boolean;
  finalPrice: number | null;
  reason: string | null;
  product: { id: string; title: string; askPrice: number };
  messages: NegotiationMessage[];
};

export type JobDetail = {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error: string | null;
  result: unknown;
};

export async function listProducts(): Promise<Product[]> {
  const res = await fetch(`${API_URL}/products?status=active`);
  if (!res.ok) return [];
  return (await res.json()) as Product[];
}

export async function getSearch(id: string): Promise<SearchDetail> {
  return apiFetch<SearchDetail>(`/searches/${id}`);
}

export async function getProduct(id: string): Promise<Product> {
  return apiFetch<Product>(`/products/${id}`);
}

export async function getNegotiation(id: string): Promise<NegotiationDetail> {
  return apiFetch<NegotiationDetail>(`/negotiations/${id}`);
}

<<<<<<< HEAD
export async function acceptNegotiation(id: string): Promise<NegotiationDetail> {
  return apiFetch<NegotiationDetail>(`/negotiations/${id}/accept`, {
    method: "POST",
  });
=======
export async function acceptNegotiation(id: string): Promise<NegotiationSummary> {
  return apiFetch<NegotiationSummary>(`/negotiations/${id}/accept`, { method: "POST" });
>>>>>>> UriGandel
}

export async function rejectNegotiation(id: string): Promise<NegotiationSummary> {
  return apiFetch<NegotiationSummary>(`/negotiations/${id}/reject`, { method: "POST" });
}

export async function getJob(id: string): Promise<JobDetail> {
  return apiFetch<JobDetail>(`/jobs/${id}`);
}

// --- Image upload ---
// Backend endpoint: POST /uploads/image (requireAuth, multipart/form-data)
// Expected: FormData with field "image" (File)
// Returns: { url: string } — the public URL of the uploaded image.
// TODO: backend needs to add this endpoint. Example handler:
//   1. Accept multipart via multer
//   2. Save file to /public/uploads/ or an S3 bucket
//   3. Return { url: "/uploads/<filename>" } or full S3 URL
export async function uploadImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append("image", file);
  const res = await fetch(`${API_URL}/uploads/image`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

// --- Audio transcription (Whisper) ---
export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const form = new FormData();
  form.append("file", audioBlob, "audio.webm");
  form.append("model", "whisper-1");
  form.append("language", "es");

  const key = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!key) throw new Error("Missing NEXT_PUBLIC_OPENAI_API_KEY");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error("Transcription failed");
  const data = await res.json();
  return data.text;
}
