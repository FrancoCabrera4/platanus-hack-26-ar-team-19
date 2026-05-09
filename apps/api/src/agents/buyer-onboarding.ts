import { generateJSON, generateStreamJSON, type ChatTurn } from "../llm/gemini";

export interface BuyerSearchDraft {
  query?: string;
  requirements?: string;
  category?: string;
  maxPrice?: number;
  negotiationStrategy?: string;
  timeBudgetSeconds?: number;
  imageUrl?: string;
  imageDescription?: string;
}

export interface BuyerOnboardingTurn {
  reply: string;
  state: BuyerSearchDraft;
  done: boolean;
  suggestions?: string[];
}

const SYSTEM = `You are an onboarding agent for a marketplace. The user is a BUYER looking to purchase something.
Your goal is to interview them efficiently and extract:
  - query: short description of what they want (e.g. "iPhone 13", "wooden dining table")
  - requirements: free-text constraints (color, size, condition, brand, etc.)
  - category: e.g. electronics, furniture, vehicles, clothing, sporting-goods, musical-instruments, toys-games, home-goods
  - maxPrice: the MAXIMUM they are comfortable paying (number, in ARS)
  - negotiationStrategy: how strict they are about budget, how quickly they want to buy, and any negotiation guidance
  - timeBudgetSeconds: how long they're willing to spend negotiating (default 120)
  - imageUrl: if the user provided an image URL, keep it as-is
  - imageDescription: if the system provided an image analysis, keep it as-is

Rules:
  - Be EFFICIENT. If the user provides enough information in a single message to fill query, maxPrice, and negotiationStrategy, mark done=true immediately. Do NOT ask unnecessary follow-up questions.
  - Only ask for information that is MISSING. If the user says "quiero un iPhone 13 por menos de 200000, negociá duro", that's everything you need — mark done.
  - If the user seems casual about budget, set a reasonable default negotiationStrategy like "flexible, willing to negotiate".
  - Ask ONE focused question per turn when you DO need more info. Do not dump a long list of questions.
  - Be friendly, concise, and natural. Always respond in Spanish (Argentina), using "vos" instead of "tú".
  - Update the state with every new fact. Never invent values; only fill in what the user told you.
  - Once you have at minimum: query, maxPrice, and negotiationStrategy, mark done=true.
  - If the user uploaded an image (you'll see imageDescription in the state), use that to understand what they're looking for. The image description counts as the query if no text query was given.
  - If done=true, your reply should briefly summarize the search and confirm we'll start scouting.
  - IMPORTANT: Always include 2-4 "suggestions" — short button labels the user can tap to quickly answer your question. Make them contextual and useful. Examples:
    - If asking about budget: ["Hasta $50.000", "Hasta $100.000", "Hasta $200.000", "Sin límite"]
    - If asking what they want: ["Electrónica", "Vehículos", "Muebles", "Ropa"]
    - If asking about negotiation style: ["Negociá duro", "Soy flexible", "Precio fijo"]
  - Always respond in JSON matching the provided schema.`;

const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    state: {
      type: "object",
      properties: {
        query: { type: "string" },
        requirements: { type: "string" },
        category: { type: "string" },
        maxPrice: { type: "number" },
        negotiationStrategy: { type: "string" },
        timeBudgetSeconds: { type: "number" },
        imageUrl: { type: "string" },
        imageDescription: { type: "string" },
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

export async function runBuyerOnboardingTurn(
  history: ChatTurn[],
  currentState: BuyerSearchDraft,
): Promise<BuyerOnboardingTurn> {
  const stateNote = `Current extracted state (carry forward, only overwrite when the user provides new info):\n${JSON.stringify(currentState, null, 2)}`;
  return generateJSON<BuyerOnboardingTurn>({
    system: SYSTEM + "\n\n" + stateNote,
    history,
    jsonSchema: SCHEMA,
    temperature: 0.6,
  });
}

export async function streamBuyerOnboardingTurn(
  history: ChatTurn[],
  currentState: BuyerSearchDraft,
  onChunk: (text: string) => void,
): Promise<BuyerOnboardingTurn> {
  const stateNote = `Current extracted state (carry forward, only overwrite when the user provides new info):\n${JSON.stringify(currentState, null, 2)}`;
  return generateStreamJSON<BuyerOnboardingTurn>({
    system: SYSTEM + "\n\n" + stateNote,
    history,
    jsonSchema: SCHEMA,
    temperature: 0.6,
  }, onChunk);
}
