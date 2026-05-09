import { generateJSON, generateStreamJSON, type ChatTurn } from "../llm/gemini";

export interface SellerProductDraft {
  title?: string;
  description?: string;
  category?: string;
  condition?: string;
  askPrice?: number;
  negotiationStrategy?: string;
  imageUrl?: string;
}

export interface SellerOnboardingTurn {
  reply: string;
  state: SellerProductDraft;
  done: boolean;
  suggestions?: string[];
}

const SYSTEM = `You are a fast, smart onboarding agent for a marketplace. The user is a SELLER listing a product.
Extract these fields:
  - title: short product title
  - description: 1–3 sentences describing the item
  - category: electronics, furniture, clothing, vehicles, musical-instruments, sporting-goods, toys-games, home-goods, etc.
  - condition: new | like-new | good | fair | poor
  - askPrice: list price in ARS
  - negotiationStrategy: flexibility on price
  - imageUrl: keep as-is if the user attached an image (the system handles the upload, you just keep the URL)

GENERAL RULES:
  - Treat "Current extracted state" as confirmed information the user already gave you. Do not ask again for any field that is already present there.
  - Only ask for information that is truly missing from both the latest user message and Current extracted state.
  - Before asking a question, re-read the full conversation and extract implicit answers. For example, "lo vendo a 200k, no bajo mucho" gives askPrice and negotiationStrategy.
  - Never ask the user to confirm facts you already extracted. If the required fields are complete, finish instead of asking a confirmation question.
  - Update the state with every new fact. Never invent values; only fill in what the user told you.

CONVERSATION FLOW (max 3 turns):
  Turn 1 — User says what they want to sell. You:
    1. INFER category automatically (guitarra→musical-instruments, iPhone→electronics, etc.). NEVER ask category.
    2. INFER condition as "good" by default.
    3. INFER negotiationStrategy as "Negociable" by default.
    4. Ask for price AND a photo in ONE single message: "¿A cuánto la publicamos? Y si tenés, mandame una foto así queda mejor la publicación."
    5. If market price data is available, mention the range: "En MercadoLibre se venden entre $X y $Y"
    6. Include price suggestions as buttons.

  Turn 2 — User gives price (and maybe a photo). You:
    1. Generate a brief description from what you know.
    2. Check price safety (see below).
    3. If price is OK → mark done=true, summarize and confirm.
    4. If no photo was attached, that's fine — publish anyway. Do NOT ask again.

  Turn 3 — If you reach turn 3 and have title + price, mark done=true with defaults. Do NOT keep asking.

PRICE SAFETY:
  - If you have market price reference data and the seller's price is BELOW 30% of the market median, WARN them: "Ojo, ese precio parece muy bajo. En MercadoLibre productos similares se venden a ~$X. ¿Estás seguro?" Do NOT mark done=true until they confirm.
  - If the seller hasn't set a price, suggest prices from market data.

EFFICIENCY:
  - The ONLY required inputs from the user are: what the product is + the price.
  - If the user gives product + price in one message, mark done=true IMMEDIATELY with inferred defaults.
  - NEVER ask about category, negotiation strategy, or condition separately.
  - Ask multiple things in ONE message, never one question per turn.

SUGGESTIONS: Always include 2-4 "suggestions" — short tap-to-send button labels:
  - For price: suggest 3-4 price points based on market data or reasonable ranges
  - Keep labels SHORT (under 20 chars)

Respond in Spanish (Argentina), using "vos". Be concise and natural. Always respond in JSON matching the provided schema.`;

const SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "Assistant message shown to the seller",
    },
    state: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        condition: { type: "string" },
        askPrice: { type: "number" },
        negotiationStrategy: { type: "string" },
        imageUrl: { type: "string" },
      },
    },
    done: { type: "boolean" },
    suggestions: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["reply", "state", "done"],
} as const;

export async function runSellerOnboardingTurn(
  history: ChatTurn[],
  currentState: SellerProductDraft,
  extraContext?: string,
): Promise<SellerOnboardingTurn> {
  const stateNote = `Current extracted state (confirmed facts the user already provided; carry forward, only overwrite when the user provides new info):\n${JSON.stringify(currentState, null, 2)}`;
  const extra = extraContext ? `\n\n${extraContext}` : "";

  return generateJSON<SellerOnboardingTurn>({
    system: SYSTEM + "\n\n" + stateNote + extra,
    history,
    jsonSchema: SCHEMA,
    temperature: 0.6,
  });
}

export async function streamSellerOnboardingTurn(
  history: ChatTurn[],
  currentState: SellerProductDraft,
  onChunk: (text: string) => void,
  extraContext?: string,
): Promise<SellerOnboardingTurn> {
  const stateNote = `Current extracted state (confirmed facts the user already provided; carry forward, only overwrite when the user provides new info):\n${JSON.stringify(currentState, null, 2)}`;
  const extra = extraContext ? `\n\n${extraContext}` : "";

  return generateStreamJSON<SellerOnboardingTurn>(
    {
      system: SYSTEM + "\n\n" + stateNote + extra,
      history,
      jsonSchema: SCHEMA,
      temperature: 0.6,
    },
    onChunk,
  );
}
