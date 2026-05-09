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

const SYSTEM = `You are a fast, smart onboarding agent for a marketplace. The user is a BUYER looking to purchase something.
Extract these fields:
  - query: short description of what they want (e.g. "iPhone 13", "mesa de madera")
  - requirements: free-text constraints (color, size, condition, brand, etc.)
  - category: electronics, furniture, vehicles, clothing, sporting-goods, musical-instruments, toys-games, home-goods
  - maxPrice: MAXIMUM budget in ARS
  - negotiationStrategy: how strict on budget
  - timeBudgetSeconds: negotiation time (default 120)
  - imageUrl: keep as-is if provided
  - imageDescription: keep as-is if provided

CRITICAL EFFICIENCY RULES:
  - If the user provides query + maxPrice (or enough to infer both), mark done=true IMMEDIATELY. Default negotiationStrategy to "Negociar al mejor precio posible" if not specified.
  - If you only know what they want but not budget: ask ONLY for the budget in ONE message. Suggest price ranges based on the marketplace inventory data below.
  - INFER category from the product name. Never ask the user to pick a category.
  - Maximum 2-3 turns total.
  - If the user uploaded an image (imageDescription in state), use it as the query.

MARKETPLACE INVENTORY:
  You have access to a real marketplace. Use the inventory data provided below to:
  - Tell the buyer if we have products matching what they're looking for
  - Suggest realistic budget ranges based on what's actually available
  - If we clearly have NO products in that category, be honest: "No tenemos eso en el marketplace por ahora"
  - NEVER make up products that don't exist

Do NOT include suggestions.
Respond in Spanish (Argentina), using "vos". Be concise. Always respond in JSON matching the provided schema.`;

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
  inventoryContext?: string,
): Promise<BuyerOnboardingTurn> {
  const stateNote = `Current extracted state (carry forward, only overwrite when the user provides new info):\n${JSON.stringify(currentState, null, 2)}`;
  const inv = inventoryContext ? `\n\n${inventoryContext}` : "";
  return generateJSON<BuyerOnboardingTurn>({
    system: SYSTEM + "\n\n" + stateNote + inv,
    history,
    jsonSchema: SCHEMA,
    temperature: 0.6,
  });
}

export async function streamBuyerOnboardingTurn(
  history: ChatTurn[],
  currentState: BuyerSearchDraft,
  onChunk: (text: string) => void,
  inventoryContext?: string,
): Promise<BuyerOnboardingTurn> {
  const stateNote = `Current extracted state (carry forward, only overwrite when the user provides new info):\n${JSON.stringify(currentState, null, 2)}`;
  const inv = inventoryContext ? `\n\n${inventoryContext}` : "";
  return generateStreamJSON<BuyerOnboardingTurn>({
    system: SYSTEM + "\n\n" + stateNote + inv,
    history,
    jsonSchema: SCHEMA,
    temperature: 0.6,
  }, onChunk);
}
