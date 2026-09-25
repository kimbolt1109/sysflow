import type { ChatMessage, DriverKind, QuotaInfo, TokenUsage } from "@/domain/models.js";

export interface SendResult {
  text: string;
  usage: TokenUsage;
}

/** Per-call hints. API drivers ignore them; CLI agents that run their own
 * tools map them onto their own permission flags. */
export interface SendOptions {
  /** the call must not change files or run commands (planning, critique, grading) */
  readOnly?: boolean;
}

export interface Driver {
  readonly id: string;
  readonly kind: DriverKind;
  sendMessage(messages: ChatMessage[], opts?: SendOptions): Promise<SendResult>;
  streamMessage(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    opts?: SendOptions,
  ): Promise<SendResult>;
  countTokens(text: string): number;
  getQuota(): Promise<QuotaInfo>;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}
