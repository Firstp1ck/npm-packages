function getCacheControl(model, cacheRetention) { return { cacheControl: { type: "ephemeral" } }; }
class Anthropic { constructor(options) { this.options = options; } }
function mergeHeaders(...values) { return Object.assign({}, ...values); }
function isOAuthToken(apiKey) { return apiKey.includes("sk-ant-oat"); }
const claudeCodeVersion = "2.1.75";
function createClient(model, apiKey, interleavedThinking, useFineGrainedToolStreamingBeta, optionsHeaders, dynamicHeaders, sessionId) {
    const betaFeatures = [];
    if (apiKey && isOAuthToken(apiKey)) {
        const client = new Anthropic({
            defaultHeaders: mergeHeaders({
                "anthropic-beta": ["claude-code-20250219", "oauth-2025-04-20", ...betaFeatures].join(","),
                "user-agent": `claude-cli/${claudeCodeVersion}`,
                "x-app": "cli",
            }, model.headers, optionsHeaders),
        });
        return { client, isOAuthToken: true };
    }
}
function buildParams(model, context, isOAuthToken, options) {
    const { cacheControl } = getCacheControl(model, options?.cacheRetention);
    const params = {};
    if (isOAuthToken) {
        params.system = [
            {
                type: "text",
                text: "You are Claude Code, Anthropic's official CLI for Claude.",
                ...(cacheControl ? { cache_control: cacheControl } : {}),
            },
        ];
    }
    return params;
}
export function streamAnthropic() {}
