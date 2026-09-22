import type { ChatMessage, DriverKind, QuotaInfo, TokenUsage } from "@/domain/models.js";

export interface SendResult {
  text: string;
  usage: TokenUsage;
}

export interface Driver {
  readonly id: string;
  readonly kind: DriverKind;
  sendMessage(messages: ChatMessage[]): Promise<SendResult>;
  streamMessage(messages: ChatMessage[], onToken: (token: string) => void): Promise<SendResult>;
  countTokens(text: string): number;
  getQuota(): Promise<QuotaInfo>;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}
