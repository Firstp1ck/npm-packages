# Grill Me Results

Generated: 2026-08-30T15:55:51.962Z

## Plan

Create a Pi-local, manually invoked skill that organizes image collections through safe, reviewable parallel symlink views while preserving originals.

## Shared Understanding

Design a Pi-local, manually invoked image-sorter skill for Linux. It will use deterministic Python scripts managed by uv to scan JPEG, PNG, WebP, and paired XMP files; preserve existing originals; copy inbox imports into managed Originals storage; and create parallel symlink views by date, event, location, person, and topic. Every mutating operation begins with a Markdown report and hash-bound JSON manifest, requires explicit approval, rejects drift, and supports idempotent resume.

## Questions and Answers

### 1. What recurring image workflow should the skill handle?

**Recommended answer:** No separate recommendation was given during the preliminary questionnaire.

**User answer:** Handle both imports and existing libraries.

**Status:** resolved

**Notes:** Baseline discovery decision.

### 2. Which properties should determine where an image belongs?

**Recommended answer:** No separate recommendation was given during the preliminary questionnaire.

**User answer:** Capture date, event or trip, location, people or faces, and visual subject or topic.

**Status:** resolved

**Notes:** Baseline discovery decision.

### 3. What should the approved run do to source files?

**Recommended answer:** No separate recommendation was given during the preliminary questionnaire.

**User answer:** Create symbolic links for the organized views.

**Status:** resolved

**Notes:** Later clarified that existing originals remain untouched and inbox imports are copied into a managed Originals store before links are created.

### 4. Which information may the skill inspect?

**Recommended answer:** No separate recommendation was given during the preliminary questionnaire.

**User answer:** EXIF and embedded metadata, filesystem timestamps, filenames and current paths, local vision models, cloud vision APIs only through explicit per-run opt-in, and XMP or other sidecar files.

**Status:** resolved

**Notes:** Cloud use was narrowed later to explicit per-run opt-in; local processing remains the default.

### 5. How should exact or near-duplicate images be handled?

**Recommended answer:** No separate recommendation was given during the preliminary questionnaire.

**User answer:** Deduplicate exact byte matches only.

**Status:** resolved

**Notes:** Baseline discovery decision; the hash algorithm and treatment of near-duplicates still need clarification.

### 6. What approval boundary should the workflow enforce?

**Recommended answer:** Use a dry run, review the proposed changes, and require explicit confirmation before any copy or link creation.

**User answer:** Dry run, review, then explicit confirmation.

**Status:** resolved

**Notes:** Baseline safety decision.

### 7. Where may image content and metadata be processed?

**Recommended answer:** Keep processing local by default and require explicit per-run opt-in before any cloud vision request.

**User answer:** Local machine only by default; cloud vision is allowed only through explicit per-run opt-in.

**Status:** resolved

**Notes:** Resolved during the first focused grill question.

### 8. Which file families must stay together and be supported?

**Recommended answer:** No separate recommendation was given during the preliminary questionnaire.

**User answer:** JPEG, PNG, and WebP.

**Status:** resolved

**Notes:** Baseline scope decision.

### 9. What is the usual size of one run?

**Recommended answer:** No separate recommendation was given during the preliminary questionnaire.

**User answer:** 1,000 to 10,000 files.

**Status:** resolved

**Notes:** Baseline scale decision.

### 10. How should this skill be packaged and invoked?

**Recommended answer:** Use a Pi-local, manually invoked skill because this is a personal workflow that can change files.

**User answer:** Pi-local and manually invoked.

**Status:** resolved

**Notes:** The generated draft must remain disabled until reviewed and explicitly enabled.

### 11. Should cloud vision be excluded completely, or allowed only through explicit per-run opt-in?

**Recommended answer:** Make local-only processing the hard default and exclude cloud APIs unless the user deliberately enables them for that run.

**User answer:** Cloud vision is allowed only through explicit per-run opt-in.

**Status:** resolved

**Notes:** Focused grill decision resolving the preliminary privacy conflict.

### 12. Do you want parallel views, or one primary folder hierarchy?

**Recommended answer:** Create parallel symlink views such as by-date, by-event, by-location, by-person, and by-topic so one image can appear in multiple useful organizations without moving the original.

**User answer:** Use parallel views.

**Status:** resolved

**Notes:** Focused grill decision.

### 13. Should inbox imports use a managed-originals copy step?

**Recommended answer:** Keep existing originals untouched, but copy new inbox files into a stable managed Originals store before creating symlinks so links do not break when an inbox is deleted or unmounted.

**User answer:** Keep existing originals untouched, but copy new inbox files into a stable, managed Originals/ store before creating symlinks.

**Status:** resolved

**Notes:** Focused grill decision.

### 14. Should the managed originals use this date-plus-hash layout: Originals/YYYY/YYYY-MM/<original-name>__<short-hash>.<ext>?

**Recommended answer:** Use the date-plus-hash layout because it stays human-readable, prevents filename collisions, and supports exact deduplication.

**User answer:** Use the recommended date-plus-hash layout.

**Status:** resolved

**Notes:** Focused grill decision. The exact hash length still needs specification.

### 15. How should uncertain event, person, location, or topic classifications be handled?

**Recommended answer:** Auto-link high-confidence results, send uncertain results to a review queue, and omit low-confidence guesses.

**User answer:** Create links automatically for every prediction.

**Status:** resolved

**Notes:** The user selected option A, differing from the recommendation. Later questions should bound how many predictions may create links and provide correction or undo controls.

### 16. How many inferred labels may create symlinks in each parallel view for one image?

**Recommended answer:** Configure limits separately for each view, defaulting to one event, one location, every detected person, and up to three topics.

**User answer:** Create up to three inferred-label symlinks per view.

**Status:** resolved

**Notes:** The user selected option B. This caps inferred event, location, person, and topic links at three per view.

### 17. What should happen when an image has no usable value for one parallel view?

**Recommended answer:** Link it into that view's Unknown/ folder so missing classifications remain visible without inventing labels.

**User answer:** Link it into that view's Unknown/ folder.

**Status:** resolved

**Notes:** The user selected option B.

### 18. How should the skill determine event groups?

**Recommended answer:** Combine time and location clustering with source-folder and visual context, using capture time and GPS as the base and improving event names with source-folder context and local vision results.

**User answer:** Combine time and location clustering with source-folder and visual context.

**Status:** resolved

**Notes:** The user selected option D.

### 19. What time gap should normally split images into separate events?

**Recommended answer:** Make the threshold configurable with a 6-hour default, while allowing GPS distance and date boundaries to force a split.

**User answer:** Use a configurable threshold with a 6-hour default.

**Status:** resolved

**Notes:** The user selected option D.

### 20. How should GPS coordinates become human-readable location folders?

**Recommended answer:** Use offline reverse geocoding by default, with optional online refinement after explicit per-run approval.

**User answer:** Use offline reverse geocoding by default, with optional online refinement after per-run approval.

**Status:** resolved

**Notes:** The user selected option D.

### 21. How should the by-location/ view be structured?

**Recommended answer:** Use configurable levels, defaulting to Country/City/Place, and omit unavailable levels rather than creating empty folders.

**User answer:** Use configurable levels, defaulting to Country/City/Place.

**Status:** resolved

**Notes:** The user selected option D.

### 22. How should the skill identify people in photos?

**Recommended answer:** Match faces against named reference photos and place unmatched faces in anonymous clusters so known people are automated without assigning false identities.

**User answer:** Match against named reference photos and place unmatched faces in anonymous clusters.

**Status:** resolved

**Notes:** The user selected option D.

### 23. How should local face embeddings and the classification index be stored?

**Recommended answer:** Store an unencrypted local index beside the managed library in a hidden state directory with owner-only permissions, exclude it from cloud processing, and support full deletion and rebuilding.

**User answer:** Store an unencrypted local index with owner-only permissions.

**Status:** resolved

**Notes:** The user selected option B. Treat face embeddings as sensitive local data.

### 24. When identical files exist in several source locations, which file should become the symlink target?

**Recommended answer:** Make precedence configurable, defaulting to managed Originals and then the oldest existing copy, for deterministic behavior and stable targets.

**User answer:** Use configurable precedence, defaulting to managed Originals and then the oldest existing copy.

**Status:** resolved

**Notes:** The user selected option D.

### 25. What kind of symlink should each view create?

**Recommended answer:** Use relative links for managed Originals and absolute links for external originals so managed libraries remain portable while external targets remain reliable.

**User answer:** Use relative symlinks for managed Originals and absolute symlinks for external originals.

**Status:** resolved

**Notes:** The user selected option C.

### 26. How should symlink filenames be generated inside each view folder?

**Recommended answer:** Use the capture timestamp, original filename, and a short hash suffix so names stay readable, sort chronologically, and avoid collisions.

**User answer:** Use the capture timestamp, original filename, and a short hash suffix.

**Status:** resolved

**Notes:** The user selected option D.

### 27. Which source should determine an image's capture date when values disagree?

**Recommended answer:** Use configurable precedence, defaulting to EXIF DateTimeOriginal, XMP, filename parsing, and then filesystem time.

**User answer:** Use configurable precedence, defaulting to EXIF, XMP, filename parsing, then filesystem time.

**Status:** resolved

**Notes:** The user selected option D.

### 28. How should the skill assign a timezone when capture metadata has none?

**Recommended answer:** Use GPS inference first, then a source-specific timezone setting, and finally the computer timezone.

**User answer:** Use the computer's current timezone.

**Status:** resolved

**Notes:** The user selected option A, differing from the recommendation.

### 29. When cloud vision is explicitly enabled, what may be uploaded?

**Recommended answer:** Upload bounded resized image pixels with metadata stripped so visual classification works without exposing full-resolution files, GPS data, or camera metadata.

**User answer:** Upload resized image pixels with metadata stripped.

**Status:** resolved

**Notes:** The user selected option B.

### 30. How should each cloud-vision opt-in be confirmed?

**Recommended answer:** Require one confirmation per run that shows the provider, image count, and exact data to be uploaded.

**User answer:** Use one confirmation per run showing provider, image count, and uploaded data.

**Status:** resolved

**Notes:** The user selected option C.

### 31. What should the dry run produce for review before execution?

**Recommended answer:** Produce a Markdown report plus a machine-readable JSON manifest so the user can review the plan and approval can bind to the exact copies, links, hashes, and classifications.

**User answer:** Produce a Markdown report plus a machine-readable JSON manifest.

**Status:** resolved

**Notes:** The user selected option C.

### 32. What should happen if source files change after the dry run but before approval?

**Recommended answer:** Reject stale approval and require a new dry run so approval remains bound to the exact manifest and source fingerprints.

**User answer:** Reject stale approval and require a new dry run.

**Status:** resolved

**Notes:** The user selected option C.

### 33. If execution fails partway through, how should the skill handle completed operations from that run?

**Recommended answer:** Roll back every new copy and link created by the failed run using a transaction journal, while never modifying files that existed before the run.

**User answer:** Keep all completed copies and links.

**Status:** resolved

**Notes:** The user selected option A, differing from the recommendation. The workflow must be idempotent and track partial completion so a later run does not duplicate work.

### 34. How should the next run handle a previous partially completed execution?

**Recommended answer:** Detect completed operations, verify them, and resume the remainder after confirmation so the workflow remains idempotent and does not duplicate work.

**User answer:** Detect completed operations, verify them, and resume the remainder after confirmation.

**Status:** resolved

**Notes:** The user selected option B.

### 35. When classifications change or source files disappear, how should existing view links be reconciled?

**Recommended answer:** Propose additions, updates, and removals in the dry run, then apply them after approval so views stay accurate without bypassing the review boundary.

**User answer:** Propose additions, updates, and removals in the dry run, then apply them after approval.

**Status:** resolved

**Notes:** The user selected option C.

### 36. How should XMP sidecar files be handled?

**Recommended answer:** Copy sidecars with inbox imports and create matching links beside their images so ratings and edits remain paired with each image.

**User answer:** Copy sidecars with inbox imports and create matching links beside their images.

**Status:** resolved

**Notes:** The user selected option B. Sidecars are now in scope despite the preliminary media-family selection listing only JPEG, PNG, and WebP.

### 37. How should source paths, library paths, thresholds, and view settings be configured?

**Recommended answer:** Use a per-library configuration file with command-line overrides so defaults are reproducible and one-off changes do not require editing the file.

**User answer:** Use a per-library configuration file with command-line overrides.

**Status:** resolved

**Notes:** The user selected option D.

### 38. What should perform the actual scanning, classification, planning, and execution?

**Recommended answer:** Use a bundled Python command-line application because Python has strong image, metadata, SQLite, clustering, and local-model libraries and supports deterministic manifests at the target scale.

**User answer:** Use skill instructions with deterministic Python scripts.

**Status:** resolved

**Notes:** Custom answer combining a concise SKILL.md workflow with bundled deterministic Python helpers rather than a monolithic application.

### 39. How should Python dependencies and model versions be controlled?

**Recommended answer:** Use an isolated virtual environment with pinned dependencies and model checksums so system Python remains untouched and exact versions can be verified.

**User answer:** Use uv with a committed lockfile.

**Status:** resolved

**Notes:** The user selected option C. The plan should include an isolated uv-managed environment, pinned dependencies, and model artifact verification.

### 40. Which format should the per-library configuration use?

**Recommended answer:** Use TOML because it is readable, supports comments, and Python 3.11+ can parse it without another runtime dependency.

**User answer:** Use TOML.

**Status:** resolved

**Notes:** The user selected option A.

### 41. How should local vision and face-recognition models be obtained?

**Recommended answer:** Use a separate setup command that shows model sizes, licenses, and checksums before downloading so normal runs stay offline and artifacts remain verifiable.

**User answer:** Use a separate setup command that shows sizes, licenses, and checksums before downloading.

**Status:** resolved

**Notes:** The user selected option B.

### 42. What cloud-vision support should the first version include?

**Recommended answer:** Support one configurable OpenAI-compatible vision endpoint to keep the first version small while allowing compatible services through configuration.

**User answer:** Support one configurable OpenAI-compatible vision endpoint.

**Status:** resolved

**Notes:** The user selected option B.

### 43. How should the cloud API credential be supplied?

**Recommended answer:** Support environment variables and the system keyring, but never store credentials in plaintext configuration.

**User answer:** Support environment variables and the system keyring, but never plaintext configuration.

**Status:** resolved

**Notes:** The user selected option D. Secrets must not appear in TOML, manifests, reports, logs, fixtures, or skill memory.

### 44. What should store hashes, metadata, classifications, symlink state, and run journals?

**Recommended answer:** Use one local SQLite database per library because it supports indexed incremental scans, transactions, and recovery without a separate service.

**User answer:** Use one local SQLite database per library.

**Status:** resolved

**Notes:** The user selected option B. The database belongs in the owner-only hidden state directory.

### 45. How should the deterministic Python scripts be exposed?

**Recommended answer:** Use one CLI with explicit init, setup, plan, apply, status, and repair subcommands so side effects, recovery, testing, and documentation remain predictable.

**User answer:** Use one CLI with init, setup, plan, apply, status, and repair subcommands.

**Status:** resolved

**Notes:** The user selected option B.

### 46. What should bind an apply operation to the reviewed dry run?

**Recommended answer:** Require the manifest path plus its exact SHA-256 plan hash so approval cannot accidentally apply a changed or different manifest.

**User answer:** Require the manifest path plus its exact SHA-256 plan hash.

**Status:** resolved

**Notes:** The user selected option C.

### 47. What should the manually invoked skill be named?

**Recommended answer:** Use image-library-sorter because it describes both source-library management and generated parallel views without sounding like a one-off file sorter.

**User answer:** Name the skill image-sorter.

**Status:** resolved

**Notes:** The user selected option A. The invocation will be /skill:image-sorter after review and explicit enablement.

### 48. Which operating systems must the first version support?

**Recommended answer:** Support Linux distributions generally while keeping Arch-specific setup guidance in an optional adapter.

**User answer:** Support Linux distributions generally.

**Status:** resolved

**Notes:** The user selected option B. The skill remains Pi-local but its scripts should avoid distro-specific assumptions.

### 49. What data should automated tests use?

**Recommended answer:** Use generated synthetic images, synthetic metadata, and mocked model responses so image workflows can be tested without storing personal photos.

**User answer:** Use no image fixtures, only unit tests for isolated functions.

**Status:** resolved

**Notes:** The user selected option D, differing from the recommendation. End-to-end image behavior will need a separate manual or runtime-generated verification strategy.

### 50. What verification should complement the fixture-free unit tests?

**Recommended answer:** Use both runtime-generated integration tests and a manual disposable-folder acceptance test to verify real filesystem behavior without committing image fixtures.

**User answer:** Use integration tests that create temporary files and metadata at runtime.

**Status:** resolved

**Notes:** The user selected option B. No committed image fixtures and no mandatory manual acceptance test.

### 51. May the skill ever delete an original image or sidecar?

**Recommended answer:** Never delete originals; manage copies, indexes, and symlink views only.

**User answer:** Delete exact duplicates only after separate approval.

**Status:** resolved

**Notes:** The user selected option B, differing from the recommendation. Duplicate deletion must be a separate plan and approval from ordinary apply operations.

### 52. After separate duplicate-removal approval, what should happen to redundant originals?

**Recommended answer:** Move redundant originals into a library quarantine folder with a recovery manifest so recovery remains deterministic across Linux environments.

**User answer:** Delete redundant originals permanently.

**Status:** resolved

**Notes:** The user selected option A, differing from the recommendation. Permanent deletion is irreversible and must remain isolated behind a separate exact-manifest approval.

### 53. What proof should be required before permanently deleting an exact duplicate?

**Recommended answer:** Require matching size and SHA-256, a final byte-for-byte comparison, and verification that the retained canonical file is readable before irreversible deletion.

**User answer:** Require matching size and SHA-256, a final byte-for-byte comparison, and verification that the retained canonical file is readable.

**Status:** resolved

**Notes:** The user selected option D. Duplicate deletion remains a separately planned and hash-bound operation.

### 54. Which features should the first version explicitly exclude?

**Recommended answer:** Exclude RAW files and companion videos, near-duplicate or perceptual deduplication, and automatic enrollment of newly detected people so version one stays focused on JPEG, PNG, WebP, XMP sidecars, exact duplicates, and user-provided person references.

**User answer:** Exclude all of the above.

**Status:** resolved

**Notes:** The user selected option D. This closes the first-version scope.

## Agreed Decisions

- Use parallel by-date, by-event, by-location, by-person, and by-topic symlink views.
- Keep existing originals untouched; copy inbox imports into managed Originals storage before linking.
- Store managed originals under Originals/YYYY/YYYY-MM/<original-name>__<short-hash>.<ext>.
- Create up to three inferred links per view and place missing values under Unknown/.
- Build events from time and location clustering plus source-folder and visual context; use a configurable six-hour default split.
- Use offline reverse geocoding by default with optional per-run online refinement; default location layout is Country/City/Place.
- Match faces against named reference photos; keep unknown people in anonymous clusters.
- Store owner-only face embeddings and classification state in a per-library SQLite database.
- Deduplicate exact matches with configurable canonical precedence: managed Originals first, then the oldest existing copy.
- Use relative symlinks for managed originals and absolute symlinks for external originals.
- Use timestamp, original filename, and short hash in view link names.
- Use configurable capture-date precedence: EXIF, XMP, filename parsing, then filesystem time; missing timezone uses the computer timezone.
- Cloud vision requires explicit per-run opt-in, sends metadata-stripped resized pixels, and shows provider, count, and upload details.
- Use a configurable OpenAI-compatible vision endpoint; credentials come from environment variables or the system keyring, never plaintext configuration.
- Use a per-library TOML configuration with command-line overrides.
- Implement concise skill instructions plus deterministic Python scripts, managed by uv with a committed lockfile.
- Expose init, setup, plan, apply, status, and repair subcommands.
- Dry runs produce Markdown plus JSON; apply requires the exact manifest SHA-256 and rejects source drift.
- Keep completed operations after partial failures; verify and resume remaining operations after confirmation.
- Reconcile additions, changes, and removals through reviewed dry runs.
- Copy XMP sidecars and create matching view links.
- Permanent exact-duplicate deletion requires a separate hash-bound approval, matching size and SHA-256, byte-for-byte comparison, and readable canonical file verification.
- Name the user-invoked skill image-sorter and support Linux distributions generally.
- Use fixture-free unit tests plus integration tests that generate temporary files and metadata at runtime.
- Exclude RAW, companion videos, perceptual deduplication, and automatic enrollment of newly detected people from version one.

## Open Risks

- The user chose automatic link creation for every prediction rather than confidence-gated review; the three-links-per-view cap limits but does not remove misclassification risk.
- Permanent duplicate deletion is irreversible despite separate approval and independent verification.
- Using the computer timezone for metadata without timezone information may misfile images captured elsewhere.
- The exact local vision, face-recognition, reverse-geocoding, and OpenAI-compatible client libraries still require technical selection and license review.
- No committed image fixtures or mandatory manual acceptance test will be used; runtime-generated integration coverage must carry filesystem verification.

## Next Decision Needed

No blocking product decision remains. Technical library selection and implementation sequencing belong in the plan.
