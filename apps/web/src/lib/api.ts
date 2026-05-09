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
