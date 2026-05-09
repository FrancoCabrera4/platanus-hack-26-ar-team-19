import { generateJSON, type ChatTurn } from "../llm/gemini";

export interface BuyerSearchDraft {
  query?: string;
  requirements?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
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
  - minPrice: optional aspirational floor (cheapest they'd accept finding)
  - maxPrice: the MAXIMUM they will pay (kept private from sellers — this is their ceiling)
  - timeBudgetSeconds: how long they're willing to spend negotiating (default 120)

Rules:
  - Ask ONE focused question per turn. Do not dump a long list of questions.
  - Be friendly, concise, and natural. Match the user's language (English/Spanish).
  - Update the state with every new fact. Never invent values; only fill in what the user told you.
  - Once you have at minimum: query and maxPrice, mark done=true.
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
        minPrice: { type: "number" },
        maxPrice: { type: "number" },
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
