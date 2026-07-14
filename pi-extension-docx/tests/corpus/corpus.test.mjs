import assert from "node:assert/strict";
import { OoxmlPackage } from "../../src/ooxml/package.ts";
import { semanticSnapshot } from "../../src/ooxml/semantic.ts";
import { fixtureBytes, featureRichFixtureBytes, encryptedMemberFixture } from "../fixture-builder.mjs";

const cases = [
  ["basic styles/tables", fixtureBytes(), "ok"],
  ["external relationship", fixtureBytes({ external: true }), "ok"],
  ["macro active content", fixtureBytes({ macro: true }), "ACTIVE_CONTENT_BLOCKED"],
  ["digital signature", fixtureBytes({ signed: true }), "SIGNED_DOCUMENT"],
  ["feature-rich preservation corpus", featureRichFixtureBytes(), "ok"],
  ["feature-rich active-content corpus", featureRichFixtureBytes({ active: true }), "ACTIVE_CONTENT_BLOCKED"],
  ["encrypted member", encryptedMemberFixture(), "ENCRYPTED_PACKAGE"],
];
for (const [name, bytes, expected] of cases) { try { const pkg = OoxmlPackage.fromBytes(bytes); semanticSnapshot(pkg); if (expected !== "ok") { try { pkg.assertMutationAllowed(); assert.fail(`${name} unexpectedly allowed mutation`); } catch (error) { assert.equal(error.code, expected, name); } } } catch (error) { assert.equal(error.code, expected, name); } }
const rich = OoxmlPackage.fromBytes(featureRichFixtureBytes()), snapshot = semanticSnapshot(rich), manifest = rich.manifest();
assert.equal(snapshot.inventory.headers, 1);
assert.equal(snapshot.inventory.footers, 1);
assert.equal(snapshot.inventory.comments, 1);
assert.equal(snapshot.inventory.revisions, 1);
assert.equal(snapshot.inventory.contentControls, 1);
assert.equal(snapshot.inventory.textBoxes, 1);
assert.equal(snapshot.inventory.charts, 1);
assert.equal(snapshot.inventory.smartArt, 1);
assert.equal(snapshot.inventory.customXmlParts, 1);
assert.equal(snapshot.inventory.altChunks, 1);
assert.equal(snapshot.inventory.images, 1);
assert.ok(manifest.protectedParts.some((part) => part.includes("chart1.xml")));
assert.doesNotThrow(() => rich.assertMutationAllowed());
console.log(`Synthetic DOCX corpus passed ${cases.length} bounded intake/policy cases plus the feature-inventory matrix.`);
