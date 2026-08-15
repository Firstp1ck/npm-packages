import { createHash } from "node:crypto";

export const INTERCOM_CONVERSATION_LIMITS = Object.freeze({
  conversations: 32,
  messagesPerConversation: 200,
  messageTextBytes: 64 * 1024,
  responseBytes: 2 * 1024 * 1024,
  sourceEntries: 50_000,
  acceptedEvents: 8_000,
  acceptedTextBytes: 16 * 1024 * 1024,
});

const SYNTHETIC_PEERS = new Set(["subagent-control", "subagent-result"]);
const NATIVE_REPLY_MARKER = "\n\nReply with: subagent_supervisor(";

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function boundedString(value, maxLength = 240) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text ? text.slice(0, maxLength) : "";
}

function normalizedIdentity(value) {
  return boundedString(value, 240).toLocaleLowerCase();
}

function isSyntheticPeer(id, name) {
  return SYNTHETIC_PEERS.has(normalizedIdentity(id)) || SYNTHETIC_PEERS.has(normalizedIdentity(name));
}

function boundedLimit(value, fallback, minimum = 1) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < minimum) return fallback;
  return Math.min(numeric, fallback);
}

function textWithinBytes(value, maxBytes) {
  if (typeof value !== "string" || !value.trim() || maxBytes < 1) return undefined;
  const candidate = value.length > maxBytes ? value.slice(0, maxBytes) : value;
  const candidateBytes = Buffer.byteLength(candidate, "utf8");
  if (candidate.length === value.length && candidateBytes <= maxBytes) return { text: candidate, truncated: false };
  let low = 0;
  let high = candidate.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(candidate.slice(0, middle), "utf8") <= maxBytes) low = middle;
    else high = middle - 1;
  }
  let text = candidate.slice(0, low);
  const finalCode = text.charCodeAt(text.length - 1);
  if (finalCode >= 0xd800 && finalCode <= 0xdbff) text = text.slice(0, -1);
  return { text, truncated: true };
}

function timestampData(primary, fallback, order) {
  for (const candidate of [primary, fallback]) {
    if (candidate === undefined || candidate === null || candidate === "") continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return { ms: date.getTime(), iso: date.toISOString(), order };
  }
  return { ms: 0, iso: null, order };
}

function opaqueId(prefix, value) {
  return `${prefix}_${createHash("sha256").update(String(value)).digest("base64url").slice(0, 24)}`;
}

function positiveTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function fullSessionId(value) {
  const id = boundedString(value, 240);
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id : "";
}

function sessionIdAlias(value) {
  const id = normalizedIdentity(value);
  const match = id.match(/^([0-9a-f]{8})(?:-|$)/i);
  return match?.[1] || "";
}

function labelMatchesSessionId(label, id) {
  const normalizedLabel = normalizedIdentity(label);
  const normalizedId = normalizedIdentity(id);
  if (!normalizedLabel || !normalizedId) return false;
  if (normalizedLabel === normalizedId) return true;
  const alias = sessionIdAlias(normalizedId);
  return Boolean(alias) && normalizedLabel.split(/[^a-z0-9]+/).includes(alias);
}

function peerIdentity(value) {
  const peer = objectValue(value);
  if (peer) {
    return {
      id: boundedString(peer.id, 240),
      name: boundedString(peer.name, 160),
      startedAt: positiveTimestamp(peer.startedAt),
    };
  }
  const name = boundedString(value, 160);
  return { id: fullSessionId(name), name, startedAt: 0 };
}

function genericInbound(entry, order, maxTextBytes) {
  if (entry?.type !== "custom_message" || entry.customType !== "intercom_message") return undefined;
  const details = objectValue(entry.details);
  const from = peerIdentity(details?.from);
  const message = objectValue(details?.message);
  const content = objectValue(message?.content);
  const messageId = boundedString(message?.id, 240);
  const boundedText = textWithinBytes(content?.text, maxTextBytes);
  if (!messageId || !boundedText || (!from.id && !from.name) || isSyntheticPeer(from.id, from.name)) return undefined;
  return {
    eventKey: `generic:${messageId}`,
    messageId,
    precedence: 3,
    direction: "peer",
    peerId: from.id,
    peerName: from.name || from.id,
    peerStartedAt: from.startedAt,
    replyTo: boundedString(message?.replyTo, 240),
    text: boundedText.text,
    truncatedText: boundedText.truncated,
    time: timestampData(message?.timestamp, entry.timestamp, order),
  };
}

function genericCustom(entry, order, maxTextBytes) {
  if (entry?.type !== "custom" || (entry.customType !== "intercom_sent" && entry.customType !== "intercom_received")) return undefined;
  const data = objectValue(entry.data);
  const message = objectValue(data?.message);
  const messageId = boundedString(data?.messageId, 240);
  const boundedText = textWithinBytes(message?.text, maxTextBytes);
  const outbound = entry.customType === "intercom_sent";
  const peer = peerIdentity(outbound ? data?.to : data?.from);
  if (!messageId || !boundedText || (!peer.id && !peer.name) || isSyntheticPeer(peer.id, peer.name)) return undefined;
  return {
    eventKey: `generic:${messageId}`,
    messageId,
    precedence: outbound ? 1 : 2,
    direction: outbound ? "local" : "peer",
    peerId: peer.id,
    peerName: peer.name || peer.id,
    replyTo: boundedString(message?.replyTo, 240),
    text: boundedText.text,
    truncatedText: boundedText.truncated,
    time: timestampData(data?.timestamp, entry.timestamp, order),
  };
}

function nativeRequestText(entry, maxTextBytes) {
  if (typeof entry?.content !== "string") return undefined;
  const markerIndex = entry.content.indexOf(NATIVE_REPLY_MARKER);
  const visibleText = (markerIndex >= 0 ? entry.content.slice(0, markerIndex) : entry.content).trimEnd();
  return textWithinBytes(visibleText, maxTextBytes);
}

function nativeRequest(entry, order, maxTextBytes) {
  if (entry?.type !== "custom_message" || entry.customType !== "subagent_supervisor_request") return undefined;
  const details = objectValue(entry.details);
  const requestId = boundedString(details?.id, 240);
  const runId = boundedString(details?.runId, 240);
  const agent = boundedString(details?.agent, 160);
  const childIndex = Number(details?.childIndex);
  const boundedText = nativeRequestText(entry, maxTextBytes);
  if (!requestId || !runId || !agent || !Number.isInteger(childIndex) || childIndex < 0 || !boundedText) return undefined;
  return {
    requestId,
    runId,
    agent,
    childIndex,
    eventKey: `native:${requestId}:request`,
    direction: "peer",
    text: boundedText.text,
    truncatedText: boundedText.truncated,
    time: timestampData(undefined, entry.timestamp, order),
  };
}

function nativeReplyCall(entry, order, maxTextBytes) {
  if (entry?.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) return [];
  const calls = [];
  for (const part of entry.message.content) {
    if (part?.type !== "toolCall" || part.toolName !== "subagent_supervisor") continue;
    const args = objectValue(part.arguments) || objectValue(part.args);
    const toolCallId = boundedString(part.id || part.toolCallId, 512);
    const requestId = boundedString(args?.replyTo, 240);
    const boundedText = textWithinBytes(args?.message, maxTextBytes);
    if (!toolCallId || args?.action !== "reply" || !requestId || !boundedText) continue;
    calls.push({ toolCallId, requestId, text: boundedText.text, truncatedText: boundedText.truncated, time: timestampData(entry.message.timestamp, entry.timestamp, order) });
  }
  return calls;
}

function successfulNativeReplyResult(entry) {
  if (entry?.type !== "message" || entry.message?.role !== "toolResult" || entry.message.toolName !== "subagent_supervisor" || entry.message.isError === true) return undefined;
  const details = objectValue(entry.message.details);
  const toolCallId = boundedString(entry.message.toolCallId, 512);
  const requestId = boundedString(details?.replyTo, 240);
  if (!toolCallId || !requestId) return undefined;
  return {
    toolCallId,
    requestId,
    runId: boundedString(details?.runId, 240),
    agent: boundedString(details?.agent, 160),
    time: timestampData(entry.message.timestamp, entry.timestamp, 0),
  };
}

function compareEvents(left, right) {
  return left.time.ms - right.time.ms || left.time.order - right.time.order || left.eventKey.localeCompare(right.eventKey);
}

function resolveGenericPeers(events) {
  const parent = new Map(events.map((event) => [event.messageId, event.messageId]));
  const rank = new Map(events.map((event) => [event.messageId, 0]));
  const find = (messageId) => {
    let root = messageId;
    while (parent.get(root) !== root) root = parent.get(root);
    let current = messageId;
    while (current !== root) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (left, right) => {
    let leftRoot = find(left);
    let rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const leftRank = rank.get(leftRoot) || 0;
    const rightRank = rank.get(rightRoot) || 0;
    if (leftRank < rightRank) [leftRoot, rightRoot] = [rightRoot, leftRoot];
    parent.set(rightRoot, leftRoot);
    if (leftRank === rightRank) rank.set(leftRoot, leftRank + 1);
  };

  for (const event of events) {
    if (event.replyTo && parent.has(event.replyTo)) union(event.messageId, event.replyTo);
  }

  const components = new Map();
  const stablePeers = new Map();
  for (const event of events) {
    const root = find(event.messageId);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(event);
    if (!event.peerId) continue;
    if (!stablePeers.has(event.peerId)) {
      stablePeers.set(event.peerId, { id: event.peerId, names: new Set(), startedAt: 0, canonicalName: "", canonicalOrder: -1 });
    }
    const peer = stablePeers.get(event.peerId);
    const name = normalizedIdentity(event.peerName);
    if (name) peer.names.add(name);
    const startedAt = positiveTimestamp(event.peerStartedAt);
    if (startedAt && (!peer.startedAt || startedAt < peer.startedAt)) peer.startedAt = startedAt;
    if (event.peerName && event.time.order >= peer.canonicalOrder) {
      peer.canonicalName = event.peerName;
      peer.canonicalOrder = event.time.order;
    }
  }

  const assignPeer = (component, peerId) => {
    const canonicalName = stablePeers.get(peerId)?.canonicalName || "";
    for (const event of component) {
      if (!event.peerId) event.peerId = peerId;
      if (canonicalName) event.peerName = canonicalName;
    }
  };

  for (const component of components.values()) {
    const existingIds = new Set(component.map((event) => event.peerId).filter(Boolean));
    if (existingIds.size === 1) {
      assignPeer(component, existingIds.values().next().value);
      continue;
    }
    if (existingIds.size > 1) continue;

    const aliasMatches = new Set();
    for (const event of component) {
      for (const peer of stablePeers.values()) {
        if (labelMatchesSessionId(event.peerName, peer.id)) aliasMatches.add(peer.id);
      }
    }
    if (aliasMatches.size === 1) {
      assignPeer(component, aliasMatches.values().next().value);
      continue;
    }
    if (aliasMatches.size > 1) continue;

    const nameMatches = new Set();
    for (const event of component) {
      const name = normalizedIdentity(event.peerName);
      if (!name || !event.time.ms) continue;
      for (const peer of stablePeers.values()) {
        if (peer.startedAt && peer.startedAt <= event.time.ms && peer.names.has(name)) nameMatches.add(peer.id);
      }
    }
    if (nameMatches.size === 1) assignPeer(component, nameMatches.values().next().value);
  }

  for (const event of events) {
    const canonicalName = stablePeers.get(event.peerId)?.canonicalName;
    if (canonicalName) event.peerName = canonicalName;
  }
}

function publicParticipant(id, name, fallback) {
  const safeId = boundedString(id, 240);
  const safeName = boundedString(name, 160) || safeId || fallback;
  return { id: safeId || null, name: safeName };
}

function summaryForConversation(conversation) {
  return {
    id: conversation.id,
    participants: conversation.participants,
    messageCount: conversation.totalMessages,
    lastMessageAt: conversation.lastMessageAt,
    truncatedBefore: conversation.truncatedBefore,
  };
}

function detailForConversation(conversation) {
  return {
    ...summaryForConversation(conversation),
    messages: conversation.messages.map((message) => ({
      id: opaqueId("msg", message.eventKey),
      direction: message.direction,
      sender: message.direction === "local" ? conversation.participants.local : conversation.participants.peer,
      text: message.text,
      timestamp: message.time.iso,
      truncatedText: message.truncatedText,
    })),
  };
}

/**
 * Project whitelisted active-branch Pi session entries into browser-safe agent conversations.
 * The caller owns active-branch selection; pass SessionManager#getBranch(), never raw file entries.
 */
export function projectIntercomConversations(entries, options = {}) {
  const limits = {
    conversations: boundedLimit(options.maxConversations, INTERCOM_CONVERSATION_LIMITS.conversations),
    messages: boundedLimit(options.maxMessagesPerConversation, INTERCOM_CONVERSATION_LIMITS.messagesPerConversation),
    textBytes: boundedLimit(options.maxMessageTextBytes, INTERCOM_CONVERSATION_LIMITS.messageTextBytes),
    responseBytes: boundedLimit(options.maxResponseBytes, INTERCOM_CONVERSATION_LIMITS.responseBytes, 256),
    sourceEntries: boundedLimit(options.maxSourceEntries, INTERCOM_CONVERSATION_LIMITS.sourceEntries),
    acceptedEvents: boundedLimit(options.maxAcceptedEvents, INTERCOM_CONVERSATION_LIMITS.acceptedEvents),
    acceptedTextBytes: boundedLimit(options.maxAcceptedTextBytes, INTERCOM_CONVERSATION_LIMITS.acceptedTextBytes),
  };
  const localId = boundedString(options.localSessionId, 240) || "local";
  const localName = boundedString(options.localName, 160) || localId;
  const requestedConversationId = boundedString(options.conversationId, 128);
  const sourceEntries = Array.isArray(entries) ? entries : [];
  const sourceStart = Math.max(0, sourceEntries.length - limits.sourceEntries);
  let sourceTruncated = sourceStart > 0;
  let acceptedEvents = 0;
  let acceptedTextBytes = 0;

  const genericByKey = new Map();
  const requests = new Map();
  const replyCalls = new Map();
  const replyResults = [];
  const acceptEvent = (event) => {
    if (!event) return false;
    const textBytes = typeof event.text === "string" ? Buffer.byteLength(event.text, "utf8") : 0;
    if (acceptedEvents >= limits.acceptedEvents || acceptedTextBytes + textBytes > limits.acceptedTextBytes) {
      sourceTruncated = true;
      return false;
    }
    acceptedEvents += 1;
    acceptedTextBytes += textBytes;
    return true;
  };

  entryLoop: for (let order = sourceEntries.length - 1; order >= sourceStart; order--) {
    if (acceptedEvents >= limits.acceptedEvents || acceptedTextBytes >= limits.acceptedTextBytes) {
      sourceTruncated = true;
      break;
    }
    const entry = sourceEntries[order];
    const textLimit = Math.min(limits.textBytes, limits.acceptedTextBytes - acceptedTextBytes);
    const generic = genericInbound(entry, order, textLimit) || genericCustom(entry, order, textLimit);
    if (generic) {
      if (!acceptEvent(generic)) break;
      const current = genericByKey.get(generic.eventKey);
      if (!current || generic.precedence > current.precedence) genericByKey.set(generic.eventKey, generic);
    }
    const request = nativeRequest(entry, order, textLimit);
    if (request) {
      if (!acceptEvent(request)) break;
      if (!requests.has(request.requestId)) requests.set(request.requestId, request);
    }
    for (const call of nativeReplyCall(entry, order, textLimit)) {
      if (!acceptEvent(call)) break entryLoop;
      if (!replyCalls.has(call.toolCallId)) replyCalls.set(call.toolCallId, call);
    }
    const result = successfulNativeReplyResult(entry);
    if (result) {
      if (!acceptEvent(result)) break;
      result.time.order = order;
      replyResults.push(result);
    }
  }

  const genericEvents = [...genericByKey.values()].sort(compareEvents);
  resolveGenericPeers(genericEvents);
  const groups = new Map();
  const ensureGroup = (key, peerId, peerName) => {
    if (!groups.has(key)) groups.set(key, { key, peerId, peerName, messagesByKey: new Map() });
    const group = groups.get(key);
    if (peerName) group.peerName = peerName;
    if (peerId) group.peerId = peerId;
    return group;
  };
  const appendGroupEvent = (group, event) => {
    if (!group.messagesByKey.has(event.eventKey)) group.messagesByKey.set(event.eventKey, event);
  };

  for (const event of genericEvents) {
    if (isSyntheticPeer(event.peerId, event.peerName)) continue;
    const key = event.peerId ? `generic:id:${event.peerId}` : `generic:label:${normalizedIdentity(event.peerName)}`;
    if (!normalizedIdentity(event.peerName) && !event.peerId) continue;
    appendGroupEvent(ensureGroup(key, event.peerId, event.peerName), event);
  }

  for (const request of requests.values()) {
    const key = `native:${localId}:${request.runId}:${request.childIndex}:${request.agent}`;
    appendGroupEvent(ensureGroup(key, `${request.runId}:${request.childIndex}`, request.agent), request);
  }
  for (const result of replyResults) {
    const call = replyCalls.get(result.toolCallId);
    const request = requests.get(result.requestId);
    if (!call || !request || call.requestId !== result.requestId) continue;
    if ((result.runId && result.runId !== request.runId) || (result.agent && result.agent !== request.agent)) continue;
    const key = `native:${localId}:${request.runId}:${request.childIndex}:${request.agent}`;
    appendGroupEvent(ensureGroup(key, `${request.runId}:${request.childIndex}`, request.agent), {
      eventKey: `native:${request.requestId}:reply`,
      direction: "local",
      text: call.text,
      truncatedText: call.truncatedText,
      time: { ...result.time, iso: result.time.iso || call.time.iso, ms: result.time.ms || call.time.ms },
    });
  }

  const conversations = [...groups.values()].map((group) => {
    const allMessages = [...group.messagesByKey.values()].sort(compareEvents);
    const totalMessages = allMessages.length;
    const messages = allMessages.slice(-limits.messages);
    const lastMessage = allMessages.at(-1);
    return {
      id: opaqueId("conv", `${localId}\0${group.key}`),
      participants: {
        local: publicParticipant(localId, localName, "Local agent"),
        peer: publicParticipant(group.peerId, group.peerName, "Peer agent"),
      },
      messages,
      totalMessages,
      lastMessageAt: lastMessage?.time.iso || null,
      lastMessageOrder: lastMessage?.time.order || 0,
      lastMessageMs: lastMessage?.time.ms || 0,
      truncatedBefore: sourceTruncated || totalMessages > messages.length,
      key: group.key,
    };
  });
  conversations.sort((left, right) => right.lastMessageMs - left.lastMessageMs || right.lastMessageOrder - left.lastMessageOrder || left.key.localeCompare(right.key));

  const visible = conversations.slice(0, limits.conversations);
  const selected = requestedConversationId ? visible.find((conversation) => conversation.id === requestedConversationId) : undefined;
  const result = {
    version: 1,
    conversations: requestedConversationId ? [] : visible.map(summaryForConversation),
    conversation: selected ? detailForConversation(selected) : null,
    truncatedConversations: requestedConversationId ? 0 : Math.max(0, conversations.length - visible.length),
  };
  while (result.conversation?.messages.length && Buffer.byteLength(JSON.stringify(result), "utf8") > limits.responseBytes) {
    result.conversation.messages.shift();
    result.conversation.truncatedBefore = true;
  }
  return result;
}
