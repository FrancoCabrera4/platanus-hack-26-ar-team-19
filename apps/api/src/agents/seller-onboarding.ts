import { generateJSON, generateStreamJSON, type ChatTurn } from "../llm/gemini";

export interface SellerProductDraft {
  title?: string;
  description?: string;
  category?: string;
  condition?: string;
  askPrice?: number;
  negotiationStrategy?: string;
}

export interface SellerOnboardingTurn {
  reply: string;
  state: SellerProductDraft;
  done: boolean;
}

const SYSTEM = `You are an onboarding agent for a marketplace. The user is a SELLER who wants to list a product.
Your goal is to interview them efficiently and extract:
  - title: short product title
  - description: 1–3 sentences describing the item, condition, what's included
  - category: e.g. electronics, furniture, clothing, vehicles, books, etc.
  - condition: new | like-new | good | fair | poor
  - askPrice: the public list price (number, in the local currency, default ARS)
  - negotiationStrategy: how flexible they are on price, how quickly they want to sell, and any negotiation guidance

Rules:
  - Ask ONE focused question per turn. Do not dump a long list of questions.
  - Be friendly, concise, and natural. Match the user's language (English/Spanish).
  - Update the state with every new fact. Never invent values; only fill in what the user told you.
  - Once you have at minimum: title, description, askPrice, negotiationStrategy, mark done=true.
  - If done=true, your reply should briefly summarize the product and confirm publication.
  - Always respond in JSON matching the provided schema.`;

const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "Assistant message shown to the seller" },
    state: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        condition: { type: "string" },
        askPrice: { type: "number" },
        negotiationStrategy: { type: "string" },
      },
    },
    done: { type: "boolean" },
  },
  required: ["reply", "state", "done"],
} as const;

export async function runSellerOnboardingTurn(
  history: ChatTurn[],
  currentState: SellerProductDraft,
): Promise<SellerOnboardingTurn> {
  const stateNote: ChatTurn = {
    role: "system",
    content: `Current extracted state (carry forward, only overwrite when the user provides new info):\n${JSON.stringify(currentState, null, 2)}`,
  };

  return generateJSON<SellerOnboardingTurn>({
    system: SYSTEM + "\n\n" + stateNote.content,
    history,
    jsonSchema: SCHEMA,
    temperature: 0.6,
  });
}

export async function streamSellerOnboardingTurn(
  history: ChatTurn[],
  currentState: SellerProductDraft,
  onChunk: (text: string) => void,
): Promise<SellerOnboardingTurn> {
  const stateNote = `Current extracted state (carry forward, only overwrite when the user provides new info):\n${JSON.stringify(currentState, null, 2)}`;
  return generateStreamJSON<SellerOnboardingTurn>({
    system: SYSTEM + "\n\n" + stateNote,
    history,
    jsonSchema: SCHEMA,
    temperature: 0.6,
  }, onChunk);
}
