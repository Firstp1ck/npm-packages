import type { Message } from "@earendil-works/pi-ai";

export type SideThread = {
  messages: Message[];
  tail: Promise<void>;
  cancelled: boolean;
  controllers: Set<AbortController>;
};

export function createSideThread(): SideThread {
  return {
    messages: [],
    tail: Promise.resolve(),
    cancelled: false,
    controllers: new Set(),
  };
}

function abortError(): Error {
  const error = new Error("Side question aborted.");
  error.name = "AbortError";
  return error;
}

/** Cancel both active and queued work. A new extension factory gets a new thread. */
export function cancelSideThread(sideThread: SideThread): void {
  if (sideThread.cancelled) return;
  sideThread.cancelled = true;
  for (const controller of sideThread.controllers) controller.abort();
}

export function buildSideQuestionMessages(
  transcript: string,
  question: string,
  previousMessages: readonly Message[],
): Message[] {
  const text = previousMessages.length === 0
    ? `Current session transcript:\n\n${transcript}\n\n---\n\n/btw side question:\n${question}`
    : `/btw follow-up question:\n${question}`;
  const userMessage: Message = {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
  return [...previousMessages, userMessage];
}

export function commitSideQuestion(
  sideThread: SideThread,
  requestMessages: readonly Message[],
  assistantMessage: Message,
): void {
  sideThread.messages = [...requestMessages, assistantMessage];
}

export function enqueueSideThreadRun<T>(
  sideThread: SideThread,
  run: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  sideThread.controllers.add(controller);
  const invoke = async (): Promise<T> => {
    if (sideThread.cancelled || controller.signal.aborted) throw abortError();
    const value = await run(controller.signal);
    if (sideThread.cancelled || controller.signal.aborted) throw abortError();
    return value;
  };
  const queued = sideThread.tail.then(invoke, invoke);
  sideThread.tail = queued.then(() => undefined, () => undefined);
  void queued.finally(() => {
    signal?.removeEventListener("abort", forwardAbort);
    sideThread.controllers.delete(controller);
  }).catch(() => undefined);
  return queued;
}
