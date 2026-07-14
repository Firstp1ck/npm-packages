import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OoxmlPackage } from "../src/ooxml/package.ts";
import { semanticSnapshot, readSemantic } from "../src/ooxml/semantic.ts";
import { DocxError } from "../src/errors.ts";
import { fixtureBytes, encryptedMemberFixture } from "./fixture-builder.mjs";

test("bounded intake inventories relationships and cross-run semantic text", () => { const pkg = OoxmlPackage.fromBytes(fixtureBytes({ external: true })), manifest = pkg.manifest(), snapshot = semanticSnapshot(pkg), read = readSemantic(snapshot, { path: "unused", query: "Hello world", exact: true }); assert.equal(manifest.externalRelationships.length, 1); assert.equal(snapshot.inventory.paragraphs, 3); assert.equal(read.totalMatches, 1); assert.equal(read.blocks[0].text, "Hello world"); assert.equal(read.blocks[0].selector.kind, "paragraphId"); });

test("no-op ZIP rebuild preserves every uncompressed part", () => { const before = OoxmlPackage.fromBytes(fixtureBytes()), after = OoxmlPackage.fromBytes(before.archive.toBytes()), comparison = before.compareIntegrity(after, new Set()); assert.equal(comparison.ok, true); assert.deepEqual(comparison.changedParts, []); });

test("macro and signed packages fail closed for mutation", () => { for (const options of [{ macro: true }, { signed: true }]) { const pkg = OoxmlPackage.fromBytes(fixtureBytes(options)); assert.throws(() => pkg.assertMutationAllowed(), (error) => error instanceof DocxError && ["ACTIVE_CONTENT_BLOCKED", "SIGNED_DOCUMENT"].includes(error.code)); } });

test("encrypted members, DTDs, and tight limits are rejected", () => { assert.throws(() => OoxmlPackage.fromBytes(encryptedMemberFixture()), (error) => error.code === "ENCRYPTED_PACKAGE"); assert.throws(() => semanticSnapshot(OoxmlPackage.fromBytes(fixtureBytes({ dtd: true }))), (error) => error.code === "INVALID_PACKAGE"); assert.throws(() => OoxmlPackage.fromBytes(fixtureBytes(), { maxArchiveBytes: 100 }), (error) => error.code === "LIMIT_EXCEEDED"); });
