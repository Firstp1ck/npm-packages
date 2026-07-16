import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export async function createAuthContext() {
  const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
  return { modelRuntime };
}

export async function listLoginProviderOptions(modelRuntime) {
  const storedProviderIds = new Set((await modelRuntime.listCredentials()).map((credential) => credential.providerId));
  return modelRuntime.getProviders().map((provider) => ({
    id: provider.id,
    name: provider.name || provider.id,
    authType: provider.auth?.oauth ? "oauth" : "api_key",
    removable: storedProviderIds.has(provider.id),
    status: modelRuntime.getProviderAuthStatus(provider.id),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

export async function listLogoutProviderOptions(modelRuntime) {
  const options = (await modelRuntime.listCredentials()).map((credential) => ({
    id: credential.providerId,
    name: modelRuntime.getProvider(credential.providerId)?.name || credential.providerId,
    authType: credential.type,
    status: modelRuntime.getProviderAuthStatus(credential.providerId),
  }));
  return options.sort((left, right) => left.name.localeCompare(right.name));
}

export async function authProvidersPayload(modelRuntime) {
  const [loginProviders, logoutProviders] = await Promise.all([
    listLoginProviderOptions(modelRuntime),
    listLogoutProviderOptions(modelRuntime),
  ]);
  return {
    loginProviders,
    logoutProviders,
    storedProviderCount: logoutProviders.length,
    browserLoginSupported: false,
    guidance: [
      "OAuth and API-key login flows still require the Pi TUI /login command.",
      "Web UI logout only removes credentials stored in auth.json by /login.",
      "Environment variables and models.json credentials are not removable from the Web UI.",
    ].join("\n"),
  };
}

export async function logoutStoredProvider(modelRuntime, providerId) {
  const id = String(providerId || "").trim();
  if (!id) throw new Error("provider is required");
  const credential = (await modelRuntime.listCredentials()).find((item) => item.providerId === id);
  if (!credential) {
    throw new Error(`No stored credentials found for provider: ${id}`);
  }
  const name = modelRuntime.getProvider(id)?.name || id;
  await modelRuntime.logout(id);
  const message = credential?.type === "oauth"
    ? `Logged out of ${name}.`
    : `Removed stored API key for ${name}. Environment variables and models.json config are unchanged.`;
  return { provider: id, providerName: name, authType: credential?.type, message };
}
