import * as imported from "@firstpick/pi-utils";

type UtilityName = "resolveUserPath" | "runCommand";
function utility<T>(name: UtilityName): T {
  const namespace = imported as unknown as Record<string, unknown>;
  const nested = namespace.default && typeof namespace.default === "object" ? namespace.default as Record<string, unknown> : undefined;
  const value = namespace[name] ?? nested?.[name];
  if (typeof value !== "function") throw new Error(`@firstpick/pi-utils does not expose ${name}.`);
  return value as T;
}
export const resolveUserPath = utility<typeof import("@firstpick/pi-utils").resolveUserPath>("resolveUserPath");
export const runCommand = utility<typeof import("@firstpick/pi-utils").runCommand>("runCommand");
