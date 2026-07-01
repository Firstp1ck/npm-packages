export declare const DEFAULT_ALLOWED_TOOLS: readonly string[];
export declare const CONVERSATION_STATUS_KEY = "natural-conversation";
export declare const CONVERSATION_SYSTEM_PROMPT: string;

export type ConversationUiState =
  | "off"
  | "listening"
  | "transcribing"
  | "answering"
  | "speaking"
  | "interrupting"
  | "silence"
  | "paused"
  | "error";

export type ConversationModeState = {
  enabled: boolean;
  previousThinkingLevel?: string;
  previousActiveTools?: string[];
  allowedTools: string[];
  startedAt?: string;
  uiState?: ConversationUiState;
  bargeInEnabled?: boolean;
  silenceTimeoutMs?: number;
};

export declare function normalizeAllowedTools(value?: readonly string[]): string[];

export declare function createConversationController(
  pi: any,
  options?: { allowedTools?: string[] },
): {
  enable(ctx?: any, overrides?: Partial<ConversationModeState>): { changed: boolean; state: ConversationModeState };
  disable(ctx?: any, options?: { notify?: boolean }): { changed: boolean; state: ConversationModeState };
  shutdown(ctx?: any): { changed: boolean; state: ConversationModeState };
  ensureConversationConstraints(ctx?: any): boolean;
  updateStatus(ctx?: any): void;
  isEnabled(): boolean;
  getState(): ConversationModeState;
  statusText(): string;
  buildSystemPrompt(systemPrompt?: string): string;
  handleToolCall(event: { toolName?: string }): { block: true; reason: string } | undefined;
  handleUserBash(): { result: { output: string; exitCode: number; cancelled: boolean; truncated: boolean } } | undefined;
  setUiState(uiState: ConversationUiState, ctx?: any): ConversationModeState;
  handleConversationInterrupt(
    transcript: string,
    options?: { toolPhaseActive?: boolean },
  ): { action: "ignored" | "queue-after-tool" | "new-turn"; transcript: string };
};
