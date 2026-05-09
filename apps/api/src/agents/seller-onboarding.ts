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

const SYSTEM = `You are an onboarding agent for a marketplace. The user is a SELLER who wants to list a product.
Your goal is to interview them efficiently and extract:
  - title: short product title
  - description: 1–3 sentences describing the item, condition, what's included
  - category: e.g. electronics, furniture, clothing, vehicles, books, etc.
  - condition: new | like-new | good | fair | poor
  - askPrice: the public list price (number, in the local currency, default ARS)
  - negotiationStrategy: how flexible they are on price, how quickly they want to sell, and any negotiation guidance
  - imageUrl: if the user provided an image URL, keep it as-is

Rules:
  - Be efficient. If the user provides enough information to fill title, description, askPrice, and negotiationStrategy, mark done=true immediately.
  - Treat "Current extracted state" as confirmed information the user already gave you. Do not ask again for any field that is already present there.
  - Only ask for information that is truly missing from both the latest user message and Current extracted state.
  - Before asking a question, re-read the full conversation and extract implicit answers. For example, "lo vendo a 200k, no bajo mucho" gives askPrice and negotiationStrategy.
  - Do not ask for optional fields (category, condition) if the required fields are already complete.
  - Never ask the user to confirm facts you already extracted. If the required fields are complete, finish instead of asking a confirmation question.
  - Ask ONE focused question per turn when you do need more info. Do not dump a long list of questions.
  - Be friendly, concise, and natural. Match the user's language (English/Spanish).
  - Update the state with every new fact. Never invent values; only fill in what the user told you.
  - Once you have at minimum: title, description, askPrice, negotiationStrategy, mark done=true.
  - If done=true, your reply should briefly summarize the product and confirm publication.
  - If you have market price reference data, use it to help the seller:
    - If the seller hasn't set a price yet, suggest a competitive price based on the market data.
    - If the seller's price seems too high vs market, gently mention the market range.
    - Always frame it helpfully: "En MercadoLibre productos similares se venden entre $X y $Y"
  - IMPORTANT: Always include 2-4 "suggestions" — short button labels the user can tap to quickly answer your question. Make them contextual and useful. Examples:
    - If asking about condition: ["Nuevo", "Como nuevo", "Buen estado", "Usado"]
    - If asking about price flexibility: ["Precio fijo", "Algo negociable", "Muy flexible", "Venta urgente"]
    - If asking about category: ["Electrónica", "Vehículos", "Muebles", "Ropa"]
    - If suggesting prices from market data: ["$50.000", "$75.000", "$100.000"] based on the range
  - Always respond in JSON matching the provided schema.`;

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
