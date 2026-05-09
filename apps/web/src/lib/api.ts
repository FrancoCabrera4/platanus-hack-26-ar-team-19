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
  role: "buyer" | "seller" | "both";
  emailVerified: boolean;
  emailVerifiedAt: string | null;
};

export type AuthResponse = {
  user: AuthUser;
  verificationUrl?: string;
  verificationToken?: string;
};

export async function signup(input: {
  name: string;
  email: string;
  password: string;
  role: "buyer" | "seller" | "both";
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

export async function requestEmailVerification(): Promise<{
  verificationUrl?: string;
  verificationToken?: string;
}> {
  return apiFetch("/auth/request-email-verification", { method: "POST" });
}

export async function verifyEmail(token: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function requestPasswordReset(email: string): Promise<{
  ok: boolean;
  resetUrl?: string;
  resetToken?: string;
}> {
  return apiFetch("/auth/request-password-reset", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export async function createUser(name: string, email: string, role: "buyer" | "seller" | "both") {
  return apiFetch<AuthUser>("/users", {
    method: "POST",
    body: JSON.stringify({ name, email, role }),
  });
}

export async function startBuyerConversation() {
  return apiFetch<{ id: string; messages: { role: string; content: string }[] }>("/buyers/conversations", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function startSellerConversation() {
  return apiFetch<{ id: string; messages: { role: string; content: string }[] }>("/sellers/conversations", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function streamMessage(
  type: "buyer" | "seller",
  conversationId: string,
  content: string,
  onChunk: (text: string) => void,
  onDone: (data: { state: unknown; searchId?: string; listingId?: string; jobId?: string }) => void,
  onError: (error: string) => void,
) {
  const endpoint = type === "buyer" ? "buyers" : "sellers";
  const res = await fetch(
    `${API_URL}/${endpoint}/conversations/${conversationId}/messages/stream`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
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

export type Listing = {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  category: string | null;
  condition: string | null;
  askPrice: number;
  maxPrice: number | null;
  imageUrl: string | null;
  status: string;
  createdAt: string;
};

export type NegotiationSummary = {
  id: string;
  status: string;
  finalPrice: number | null;
  reason: string | null;
  listing: { id: string; title: string; askPrice: number };
};

export type DealSummary = {
  id: string;
  listingId: string;
  finalPrice: number;
  createdAt: string;
};

export type SearchDetail = {
  id: string;
  query: string;
  category: string | null;
  minPrice: number | null;
  maxPrice: number;
  status: "collecting" | "ready" | "running" | "completed" | "failed";
  negotiations: NegotiationSummary[];
  deals: DealSummary[];
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
  finalPrice: number | null;
  reason: string | null;
  listing: { id: string; title: string; askPrice: number };
  messages: NegotiationMessage[];
  deal: { id: string; finalPrice: number } | null;
};

export type JobDetail = {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error: string | null;
  result: unknown;
};

export async function listListings(): Promise<Listing[]> {
  const res = await fetch(`${API_URL}/listings?status=active`);
  if (!res.ok) return [];
  return (await res.json()) as Listing[];
}

export async function getSearch(id: string): Promise<SearchDetail> {
  return apiFetch<SearchDetail>(`/searches/${id}`);
}

export async function getNegotiation(id: string): Promise<NegotiationDetail> {
  return apiFetch<NegotiationDetail>(`/negotiations/${id}`);
}

export async function getJob(id: string): Promise<JobDetail> {
  return apiFetch<JobDetail>(`/jobs/${id}`);
}
