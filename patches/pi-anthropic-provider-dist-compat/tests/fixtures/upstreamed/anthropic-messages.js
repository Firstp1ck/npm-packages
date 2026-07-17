const upstreamBillingIdentity = "x-anthropic-billing-header: cc_version=upstream;";
function createClient(model, apiKey, sessionId) {
  return {
    headers: {
      "x-claude-code-session-id": sessionId,
      "x-anthropic-billing-header": "public-upstream-shape"
    },
    system: "You are a Claude agent, built on Anthropic's Claude Agent SDK."
  };
}
export function stream() {}
