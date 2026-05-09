import { generateJSON, generateStreamJSON, type ChatTurn } from "../llm/gemini";

export interface BuyerSearchDraft {
  query?: string;
  requirements?: string;
  category?: string;
  maxPrice?: number;
  negotiationStrategy?: string;
  timeBudgetSeconds?: number;
}

export interface BuyerOnboardingTurn {
  reply: string;
  state: BuyerSearchDraft;
  done: boolean;
}

const SYSTEM = `You are an onboarding agent for a marketplace. The user is a BUYER looking to purchase something.
Your goal is to interview them efficiently and extract:
  - query: short description of what they want (e.g. "iPhone 13", "wooden dining table")
  - requirements: free-text constraints (color, size, condition, brand, etc.)
  - category: e.g. electronics, furniture, vehicles, etc.
  - maxPrice: the MAXIMUM they are comfortable paying (number, in the local currency, default ARS)
  - negotiationStrategy: how strict they are about budget, how quickly they want to buy, and any negotiation guidance
  - timeBudgetSeconds: how long they're willing to spend negotiating (default 120)

Rules:
  - Ask ONE focused question per turn. Do not dump a long list of questions.
  - Be friendly, concise, and natural. Match the user's language (English/Spanish).
  - Update the state with every new fact. Never invent values; only fill in what the user told you.
  - Once you have at minimum: query, maxPrice, and negotiationStrategy, mark done=true.
  - If done=true, your reply should briefly summarize the search and confirm we'll start scouting.
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
      },
    },
    done: { type: "boolean" },
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
