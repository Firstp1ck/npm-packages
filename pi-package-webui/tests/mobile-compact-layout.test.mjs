import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [html, css, app, readme, technical] = await Promise.all([
  readFile(join(root, "public", "index.html"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "README.md"), "utf8"),
  readFile(join(root, "TECHNICAL.md"), "utf8"),
]);

assert.match(html, /id="terminalTabsToggleButton"[^>]*aria-controls="terminalTabsDrawerContent"[^>]*aria-expanded="false"/, "terminal summary should control the collapsed drawer");
assert.match(html, /id="terminalTabsDrawerContent"[^>]*aria-label="Terminal navigation"[\s\S]*id="tabBar"[\s\S]*class="terminal-sidebar-actions"[^>]*aria-label="Tab and workspace actions"[\s\S]*id="closeAllTabsButton"/, "drawer should reuse canonical tabs and workspace actions");
assert.match(html, /id="terminalTabsBackdrop"[^>]*aria-label="Close terminal navigation"[^>]*hidden/, "drawer should expose an accessible backdrop close target");
assert.match(css, /body\.mobile-tabs-expanded \.terminal-tabs-shell \{[\s\S]*?position:\s*fixed;[\s\S]*?left:\s*0\.45rem;[\s\S]*?width:\s*min\(22rem, calc\(100vw - 3rem\)\);[\s\S]*?flex-direction:\s*column/, "expanded terminal navigation should be a bounded left drawer");
assert.match(css, /body\.mobile-tabs-expanded \.terminal-tabs \{[\s\S]*?position:\s*static;[\s\S]*?flex-direction:\s*column;[\s\S]*?overflow-y:\s*auto/, "drawer tabs should follow the vertical left-sidebar model");
assert.match(app, /function setMobileTabsExpanded\(expanded, \{ restoreFocus = false \} = \{\}\)[\s\S]*?setComposerActionsOpen\(false\)[\s\S]*?terminalTabsBackdrop\.hidden = !mobileTabsExpanded[\s\S]*?focusReturn\.focus/, "drawer state should coordinate competing surfaces and restore focus");
assert.match(app, /node\.addEventListener\("pointerenter", \(event\) => \{\n\s+if \(event\.pointerType === "touch"\) return;\n\s+scheduleFooterTooltip\(node\);/, "touch pointers should not schedule floating hover tooltips");
assert.match(app, /node\.addEventListener\("focus", \(\) => \{\n\s+if \(!node\.matches\(":focus-visible"\)\) return;\n\s+showFooterTooltip\(node\);/, "touch focus should not open a floating tooltip while keyboard focus remains supported");
assert.match(css, /@media \(hover: none\) and \(pointer: coarse\) \{[\s\S]*?\[data-tooltip\]:not\(:focus-visible\):not\(\.tooltip-open\)::before,[\s\S]*?::after \{[\s\S]*?display:\s*none !important;[\s\S]*?opacity:\s*0 !important;/, "coarse touch layouts should suppress hover-only pseudo tooltips");

assert.match(html, /id="composerActionsButton"[^>]*aria-controls="composerActionsPanel"[^>]*aria-expanded="false"[^>]*>More<\/button>/, "composer should expose one labelled secondary-action trigger");
assert.match(html, /id="composerActionsPanel"[^>]*aria-label="More composer actions"[\s\S]*Session &amp; workspace[\s\S]*Tools &amp; commands[\s\S]*Context &amp; modes/, "secondary actions should be grouped in task order");
assert.match(app, /function syncMobileComposerDisclosureLayout\(\)[\s\S]*?isMobileView\(\) && !isMobileShellV2Active\(\)[\s\S]*?composerActionsPanel\.append\(node\)/, "legacy mobile should reuse canonical secondary controls in the panel");
assert.match(css, /body\.mobile-composer-disclosure \.composer-input-row \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 44px/, "collapsed composer should keep the prompt and attachment control in the input row");
assert.match(css, /body\.mobile-composer-disclosure\.pi-run-active:not\(\.mobile-keyboard-open\) \.composer-row > #abortButton \{ order:\s*1; \}[\s\S]*?#steerButton \{ order:\s*2; \}[\s\S]*?#followUpButton \{ order:\s*3; \}[\s\S]*?\.composer-actions-button \{ order:\s*4; \}[\s\S]*?#sendButton \{ order:\s*5; \}/, "active primary controls should remain on one predictable row");
assert.match(css, /body\.mobile-composer-disclosure\.composer-actions-open \.composer-actions-panel \{ display:\s*grid; \}/, "secondary actions should appear only after disclosure");
assert.match(css, /body\.mobile-composer-disclosure\.mobile-keyboard-open \.composer-row \{[\s\S]*?repeat\(4,[\s\S]*?body\.mobile-composer-disclosure\.mobile-keyboard-open \.composer-actions-button,[\s\S]*?display:\s*none !important/, "keyboard-open mode should retain primary controls and suppress secondary chrome");

assert.match(readme, /On a phone, tap the current terminal name[\s\S]*tap \*\*More\*\*[\s\S]*Hover-only tooltips stay hidden on touch controls[\s\S]*\*\*Control Deck\*\* keeps its existing expandable menu/, "README should explain the first-use mobile path and touch tooltip behavior");
assert.match(technical, /## Mobile layout[\s\S]*left-side drawer[\s\S]*compact composer[\s\S]*Touch pointers do not schedule hover-only tooltips[\s\S]*Control Deck, tablet layout, desktop tab placement/, "technical reference should document behavior and isolation");

console.log("mobile compact layout contracts passed");
