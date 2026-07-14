import assert from "node:assert/strict";
import { OoxmlPackage } from "../../src/ooxml/package.ts";
import { semanticSnapshot } from "../../src/ooxml/semantic.ts";
import { fixtureBytes, encryptedMemberFixture } from "../fixture-builder.mjs";

const cases = [
  ["basic styles/tables", fixtureBytes(), "ok"],
  ["external relationship", fixtureBytes({ external: true }), "ok"],
  ["macro active content", fixtureBytes({ macro: true }), "ACTIVE_CONTENT_BLOCKED"],
  ["digital signature", fixtureBytes({ signed: true }), "SIGNED_DOCUMENT"],
  ["encrypted member", encryptedMemberFixture(), "ENCRYPTED_PACKAGE"],
];
for (const [name, bytes, expected] of cases) { try { const pkg = OoxmlPackage.fromBytes(bytes); semanticSnapshot(pkg); if (expected !== "ok") { try { pkg.assertMutationAllowed(); assert.fail(`${name} unexpectedly allowed mutation`); } catch (error) { assert.equal(error.code, expected, name); } } } catch (error) { assert.equal(error.code, expected, name); } }
console.log(`Synthetic DOCX corpus passed ${cases.length} bounded intake/policy cases.`);
