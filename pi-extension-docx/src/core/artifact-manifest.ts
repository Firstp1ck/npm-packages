import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DocumentArtifact } from "../contracts.ts";
import { ARTIFACT_SCHEMA } from "../contracts.ts";

export type PublicDocumentArtifact = Omit<DocumentArtifact, "manifestPath" | "downloadPath">;
export function publicDocumentArtifact(artifact: DocumentArtifact): PublicDocumentArtifact { const { manifestPath: _manifestPath, downloadPath: _downloadPath, ...publicArtifact } = artifact; return publicArtifact; }
export async function createDocumentArtifact(input: { title: string; mimeType: string; manifest: Record<string, unknown>; downloadPath?: string; pageCount?: number; revisionId?: string; root: string; ttlMs?: number }): Promise<DocumentArtifact> {
  const id = randomUUID(), directory = path.join(input.root, id); await fs.mkdir(directory, { recursive: true, mode: 0o700 }); const manifestPath = path.join(directory, "manifest.json"), expiresAt = new Date(Date.now() + (input.ttlMs ?? 24 * 60 * 60 * 1000)).toISOString();
  let privateDownloadPath: string | undefined;
  if (input.downloadPath) { const extension = path.extname(input.title).toLowerCase(), destination = path.join(directory, `document${extension}`); await fs.copyFile(input.downloadPath, destination); await fs.chmod(destination, 0o600); privateDownloadPath = destination; }
  const artifact: DocumentArtifact = { schema: ARTIFACT_SCHEMA, kind: "document", id, revisionId: input.revisionId, title: path.basename(input.title), mimeType: input.mimeType, pageCount: input.pageCount, manifestPath, downloadPath: privateDownloadPath, expiresAt };
  await fs.writeFile(manifestPath, JSON.stringify({ artifact, ...input.manifest }, null, 2), { encoding: "utf8", mode: 0o600 }); return artifact;
}
