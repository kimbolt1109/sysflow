export type DriverKind = "native" | "cli";

export type OrchestrationMode = "solo" | "council" | "relay" | "workers" | "auto";

export interface ModelInfo {
  id: string;
  provider: string;
  label: string;
  contextWindow: number;
  inputPricePerM: number;
  outputPricePerM: number;
  tags: string[];
  /** where this entry was discovered: registry, opencode, agy, grok, ollama, openrouter */
  source?: string;
  /** model id to pass to the underlying CLI (--model); defaults to the id without provider prefix */
  cliModel?: string;
}

export interface RoutingRule {
  match: string;
  driver: DriverKind;
  command?: string;
  args?: string[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  /** local image file paths (e.g. screenshots) for vision-capable drivers */
  images?: string[];
}

export interface TokenUsage {
  input: number;
  output: number;
}

export interface QuotaInfo {
  provider: string;
  requestsToday: number;
  tokensToday: number;
  costToday: number;
  limit?: number;
  resetAt?: string;
  estimated: boolean;
}
