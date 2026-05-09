const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function createUser(name: string, email: string, role: "buyer" | "seller" | "both") {
  const res = await fetch(`${API_URL}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, role }),
  });
  return res.json();
}

export async function startBuyerConversation(buyerId: string) {
  const res = await fetch(`${API_URL}/buyers/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ buyerId }),
  });
  return res.json();
}

export async function startSellerConversation(sellerId: string) {
  const res = await fetch(`${API_URL}/sellers/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sellerId }),
  });
  return res.json();
}

export async function streamMessage(
  type: "buyer" | "seller",
  conversationId: string,
  content: string,
  onChunk: (text: string) => void,
  onDone: (data: { state: unknown; searchId?: string; listingId?: string }) => void,
  onError: (error: string) => void,
) {
  const endpoint = type === "buyer" ? "buyers" : "sellers";
  const res = await fetch(
    `${API_URL}/${endpoint}/conversations/${conversationId}/messages/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );

  if (!res.ok || !res.body) {
    onError("Error conectando con el agente");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.error) {
          onError(data.error);
          return;
        }
        if (data.chunk) {
          onChunk(data.chunk);
        }
        if (data.done) {
          onDone(data);
        }
      } catch {
        // skip malformed lines
      }
    }
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

export async function listListings(limit = 40): Promise<Listing[]> {
  const res = await fetch(`${API_URL}/listings?status=active`);
  if (!res.ok) return [];
  const all = (await res.json()) as Listing[];
  return all.slice(0, limit);
}

export async function getSearch(id: string): Promise<SearchDetail> {
  const res = await fetch(`${API_URL}/searches/${id}`);
  if (!res.ok) throw new Error(`getSearch ${id} failed: ${res.status}`);
  return res.json();
}

export async function getNegotiation(id: string): Promise<NegotiationDetail> {
  const res = await fetch(`${API_URL}/negotiations/${id}`);
  if (!res.ok) throw new Error(`getNegotiation ${id} failed: ${res.status}`);
  return res.json();
}

export async function getJob(id: string): Promise<JobDetail> {
  const res = await fetch(`${API_URL}/jobs/${id}`);
  if (!res.ok) throw new Error(`getJob ${id} failed: ${res.status}`);
  return res.json();
}
