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
  - Be efficient. If the user provides enough information to fill query, maxPrice, and negotiationStrategy, mark done=true immediately.
  - Treat "Current extracted state" as confirmed information the user already gave you. Do not ask again for any field that is already present there.
  - Only ask for information that is truly missing from both the latest user message and Current extracted state.
  - Before asking a question, re-read the full conversation and extract implicit answers. For example, "busco un iPhone 13 hasta 200k, negociá duro" gives query, maxPrice, and negotiationStrategy.
  - If the user says they have no budget limit, sets an open-ended budget, or seems casual about budget, set a practical high maxPrice and a flexible negotiationStrategy instead of asking again.
  - Do not ask for optional fields (requirements, category, timeBudgetSeconds) if the required fields are already complete.
  - Never ask the user to confirm facts you already extracted. If the required fields are complete, finish instead of asking a confirmation question.
  - Ask ONE focused question per turn when you do need more info. Do not dump a long list of questions.
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
  const stateNote = `Current extracted state (confirmed facts the user already provided; carry forward, only overwrite when the user provides new info):\n${JSON.stringify(currentState, null, 2)}`;
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
  const stateNote = `Current extracted state (confirmed facts the user already provided; carry forward, only overwrite when the user provides new info):\n${JSON.stringify(currentState, null, 2)}`;
  return generateStreamJSON<BuyerOnboardingTurn>({
    system: SYSTEM + "\n\n" + stateNote,
    history,
    jsonSchema: SCHEMA,
    temperature: 0.6,
  }, onChunk);
}
