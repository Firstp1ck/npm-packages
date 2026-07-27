# Cloudflare provisioning runbook for the Pi WebUI issue bot

**Audience:** Cloudflare/GitHub/OpenAI operator  
**Scope:** staging-first provisioning of the public intake Worker, private Queue consumer, D1 database, main Queue, dead-letter Queue (DLQ), intake cron trigger, and Turnstile widget  
**Source configuration:** [`wrangler.toml.example`](./wrangler.toml.example)  
**Safety state:** both launch switches must remain `false` until the staged enablement procedure explicitly changes them

This runbook is intentionally explicit. It separates resource creation, configuration, deployment, secret installation, verification, staged enablement, and rollback so that a partially completed setup cannot accidentally create public GitHub issues.

## 1. Understand the deployment boundary

The system has two Workers with different trust levels:

| Component | Invocation | Credentials | Network exposure | Responsibility |
|---|---|---|---|---|
| Intake Worker | HTTPS and cron | Turnstile secret, keyed IP-hash key, status-capability key | Public HTTPS | Validate browser requests, enforce deterministic policy/quotas, persist status/outbox data, enqueue messages, run cleanup |
| Consumer Worker | Cloudflare Queue only | OpenAI key and GitHub App credentials | No route and no `fetch` handler | Revalidate messages, moderate once, reconcile ambiguous mutations, create at most one GitHub issue |
| D1 | Worker binding | No credential exposed to application code | Internal binding | Idempotency, quotas, status, leases, mutation barriers, temporary outbox |
| Main Queue | Worker binding | No browser access | Internal binding | Move validated canonical submissions from intake to consumer |
| DLQ | Queue binding | No browser access | Internal binding | Terminally handle messages that exhaust Queue retries |
| Turnstile | Browser sitekey + intake secret | Sitekey public; secret intake-only | Public widget and Siteverify API | Issue a short-lived, single-use bot-verification token |

Hard rules:

1. Never put OpenAI or GitHub credentials in the intake Worker.
2. Never put any secret in a tracked TOML, Markdown, JavaScript, HTML, shell-history snippet, or WebUI runtime configuration.
3. Never add a route, Custom Domain, `workers.dev` exposure, or `fetch` handler to the consumer.
4. Keep `ISSUE_BOT_ADMISSION_ENABLED = "false"` and `ISSUE_BOT_CREATE_ENABLED = "false"` during provisioning.
5. Provision and verify staging before creating or enabling production resources.
6. Use different D1 databases, Queues, Turnstile widgets, hostnames, and Worker names for staging and production.
7. Treat a failed or ambiguous GitHub mutation as reconciliation-only; do not manually retry the submission blindly.

## 2. Decide names and ownership before running commands

Choose one environment for the current run. This guide uses staging first.

Recommended staging names:

| Setting | Staging example | Production example |
|---|---|---|
| Stack/resource prefix | `pi-webui-issue-bot-staging` | `pi-webui-issue-bot` |
| Intake Worker name | `pi-webui-issue-bot-intake-staging` | `pi-webui-issue-bot-intake` |
| Consumer environment | `consumer` in the environment-specific configuration | `consumer` in the environment-specific configuration |
| D1 database | `pi-webui-issue-bot-staging` | `pi-webui-issue-bot` |
| Main Queue | `pi-webui-issue-bot-staging` | `pi-webui-issue-bot` |
| DLQ | `pi-webui-issue-bot-staging-dlq` | `pi-webui-issue-bot-dlq` |
| Intake hostname | `issue-bot-staging.example.com` | `issue-bot.example.com` |
| WebUI hostname | `webui-staging.example.com` | `webui.example.com` |
| Turnstile widget | `Pi WebUI issue bot staging` | `Pi WebUI issue bot production` |
| Deployment config | `wrangler.staging.toml` | `wrangler.production.toml` |

Record, without secret values:

- Cloudflare account name and account ID.
- Resource owner and incident/rollback contact.
- Staging WebUI origin and hostname.
- Intake hostname and Cloudflare zone.
- D1 placement decision.
- Queue retention decision.
- GitHub staging repository and GitHub App identity.
- Approved OpenAI direct API model ID and billing owner.
- Expected monthly request and cost limits.

Do not continue if the resource owner, staging repository, or private vulnerability-report destination is unknown.

## 3. Prerequisites

Required locally:

- Node.js 22 or newer.
- npm.
- A browser for Cloudflare Turnstile setup.
- Access to the intended Cloudflare account.
- Permission to create Workers, D1 databases, Queues, Cron Triggers, Custom Domains, and Turnstile widgets.
- An active Cloudflare DNS zone if using a Custom Domain.
- GitHub App and OpenAI credentials for later consumer setup.

From the repository root:

```sh
cd services/issue-bot-gateway
node --version
npm --version
npm ci
npm run check
npx wrangler --version
```

Expected local gate:

- Node reports version 22 or later.
- `npm run check` exits zero.
- Wrangler is version 4.x. This runbook was verified with Wrangler `4.114.0`.

If local checks fail, stop. Provisioning does not repair application or test failures.

## 4. Authenticate Wrangler to the correct account

Interactive workstation login:

```sh
npx wrangler login
npx wrangler whoami
```

Confirm the displayed account is the intended staging account. If several accounts are available, record the selected account ID and use an account-specific Wrangler profile or CI API token rather than relying on memory.

For CI, create a narrowly scoped Cloudflare API token instead of using a Global API Key. Grant only the permissions required for the resources managed by that pipeline. Store the token in the CI secret store and avoid printing the environment.

Stop if `wrangler whoami` identifies the wrong account.

## 5. Create the staging D1 database

### 5.1 Choose placement

A location hint influences initial placement but is not a regulatory guarantee:

```sh
npx wrangler d1 create pi-webui-issue-bot-staging --location weur
```

Supported hints can be inspected with:

```sh
npx wrangler d1 create --help
```

If a legal data-residency requirement applies, use an approved jurisdiction rather than a performance hint, for example:

```sh
npx wrangler d1 create pi-webui-issue-bot-staging --jurisdiction eu
```

Make this decision before database creation. Do not guess at regulatory requirements.

### 5.2 Create and record the UUID

Without a placement option:

```sh
npx wrangler d1 create pi-webui-issue-bot-staging
```

Wrangler returns a configuration block containing a unique `database_id`. Record the UUID in the operator record. If Wrangler offers to modify a configuration automatically, decline for this project and edit the deployment-specific configuration manually: the same UUID must be present under both intake and consumer D1 bindings.

Verify the database exists in the Cloudflare dashboard under **Workers & Pages → D1 SQL databases**, or with a read-only Wrangler listing command available in the installed version.

D1 will hold content-free status metadata and a temporary outbox. The outbox can temporarily contain canonical issue prose until enqueue succeeds or cleanup removes it, so the cron and retention steps later in this runbook are mandatory.

## 6. Create the main Queue and DLQ

Create both explicitly, even though Cloudflare can automatically create a named DLQ. Explicit creation makes retention and ownership reviewable before deployment.

A one-day retention works on the free Queue tier and minimizes raw-prose retention:

```sh
npx wrangler queues create pi-webui-issue-bot-staging \
  --message-retention-period-secs 86400

npx wrangler queues create pi-webui-issue-bot-staging-dlq \
  --message-retention-period-secs 86400
```

List and verify exact names:

```sh
npx wrangler queues list
```

If operations require more than one day of outage tolerance, choose a supported retention for the Cloudflare plan, but keep it within the approved issue-bot privacy bound. The main Queue and DLQ messages can contain canonical issue prose.

Expected behavior after consumer deployment:

- Main Queue batch size: 10.
- Main Queue batch timeout: 5 seconds.
- Main Queue retry limit: 3.
- Exhausted main messages move to `pi-webui-issue-bot-staging-dlq`.
- The same private consumer consumes the DLQ.
- DLQ delivery never invokes OpenAI or GitHub; it marks a valid submission unavailable.

Cloudflare allows only one push-based consumer Worker per Queue. Stop if either Queue is already attached to an unrelated consumer.

## 7. Create a deployment-specific Wrangler configuration

The repository's `.gitignore` does not currently ignore arbitrary deployment TOML files. Add local-only exclusions before creating one:

```sh
GIT_EXCLUDE="$(git rev-parse --git-dir)/info/exclude"
printf '%s\n' \
  '/services/issue-bot-gateway/wrangler.staging.toml' \
  '/services/issue-bot-gateway/wrangler.production.toml' \
  >> "$GIT_EXCLUDE"

cp wrangler.toml.example wrangler.staging.toml
git status --short -- wrangler.staging.toml
```

The final command should print nothing. If the file appears as untracked, fix the local exclusion before entering deployment identifiers.

### 7.1 Replace staging resource values

In `wrangler.staging.toml`:

1. Change the top-level Worker name:

   ```toml
   name = "pi-webui-issue-bot-intake-staging"
   ```

2. Replace both `REPLACE_WITH_D1_DATABASE_ID` values with the staging D1 UUID.
3. Change both `database_name` values to:

   ```toml
   database_name = "pi-webui-issue-bot-staging"
   ```

4. Change the producer Queue:

   ```toml
   [[queues.producers]]
   binding = "ISSUE_BOT_QUEUE"
   queue = "pi-webui-issue-bot-staging"
   ```

5. Change both consumer Queue names and deployment variables:

   ```toml
   ISSUE_BOT_MAIN_QUEUE_NAME = "pi-webui-issue-bot-staging"
   ISSUE_BOT_DLQ_NAME = "pi-webui-issue-bot-staging-dlq"
   ```

   ```toml
   [[env.consumer.queues.consumers]]
   queue = "pi-webui-issue-bot-staging"
   max_batch_size = 10
   max_batch_timeout = 5
   max_retries = 3
   dead_letter_queue = "pi-webui-issue-bot-staging-dlq"

   [[env.consumer.queues.consumers]]
   queue = "pi-webui-issue-bot-staging-dlq"
   max_batch_size = 10
   max_batch_timeout = 5
   ```

6. Set the exact staging GitHub owner, repository, and App slug. Keep labels empty until approved:

   ```toml
   ISSUE_BOT_GITHUB_OWNER = "APPROVED_STAGING_OWNER"
   ISSUE_BOT_GITHUB_REPOSITORY = "APPROVED_STAGING_REPOSITORY"
   ISSUE_BOT_GITHUB_APP_SLUG = "APPROVED_APP_SLUG"
   ISSUE_BOT_LABELS = ""
   ```

7. Keep both switches false:

   ```toml
   ISSUE_BOT_ADMISSION_ENABLED = "false"
   ISSUE_BOT_CREATE_ENABLED = "false"
   ```

### 7.2 Configure exact browser trust values

For a WebUI served from `https://webui-staging.example.com`:

```toml
ISSUE_BOT_ALLOWED_ORIGINS = "https://webui-staging.example.com"
TURNSTILE_ALLOWED_HOSTNAMES = "webui-staging.example.com"
TURNSTILE_EXPECTED_ACTION = "issue_bot_submit"
```

The formats deliberately differ:

- Allowed origin includes `https://` and an explicit port if non-default.
- Turnstile hostname excludes scheme, path, and port.
- Neither value is the intake hostname.
- Values are comma-separated exact matches; wildcards are not supported by the application policy.
- Do not add a trailing slash to an origin.

For more than one approved staging origin:

```toml
ISSUE_BOT_ALLOWED_ORIGINS = "https://webui-staging.example.com,https://webui-review.example.com"
TURNSTILE_ALLOWED_HOSTNAMES = "webui-staging.example.com,webui-review.example.com"
```

Prefer one hostname per environment. Never add an origin merely to make a failing CORS test pass without confirming ownership.

### 7.3 Add the public intake Custom Domain

The example sets `workers_dev = false`, so the intake requires a route before the browser can reach it. Add this at the top level, before `[env.consumer]`:

```toml
[[routes]]
pattern = "issue-bot-staging.example.com"
custom_domain = true
```

A Custom Domain sends every path on that hostname to the intake Worker. The intake itself recognizes only `/health`, `/v1/submissions`, status paths, and CORS preflight; all other paths return not found.

The hostname must belong to an active Cloudflare zone in the selected account. Cloudflare creates the DNS record and certificate.

Do not place any route under `[env.consumer]`. Keep the consumer route-free and explicitly keep public development exposure disabled.

### 7.4 Preserve the cron

Do not remove:

```toml
[triggers]
crons = ["*/5 * * * *"]
```

This trigger is attached to the top-level intake Worker. It runs every five minutes in UTC and invokes the existing `scheduled()` handler for outbox recovery and cleanup.

After deployment, verify that the cron appears only on intake. If the consumer deployment unexpectedly shows any public route or cron trigger, disable the deployment and resolve the configuration before adding credentials.

## 8. Create the staging Turnstile widget

In the Cloudflare dashboard:

1. Open **Turnstile** in the selected account.
2. Select **Add widget**.
3. Name it `Pi WebUI issue bot staging`.
4. Add only the approved browser hostname, for example `webui-staging.example.com`.
5. Select **Invisible** widget mode; the shipped client renders an invisible explicit widget.
6. Leave pre-clearance disabled unless a separate reviewed design requires a `cf_clearance` cookie.
7. Create the widget.
8. Copy the sitekey into the non-secret operator record.
9. Put the secret key directly into a password manager pending `wrangler secret put`; do not paste it into the TOML.

The browser integration automatically requests a token with:

- Action: `issue_bot_submit`.
- `cData`: the submission UUID idempotency key.
- Invisible size.

The intake then validates the token with Cloudflare Siteverify and checks:

- `success === true`.
- Exact action when configured.
- Exact WebUI hostname when configured.
- Returned `cdata` equals the request UUID.
- The connecting IP is included in verification.
- Siteverify idempotency is bound to the same UUID.

Turnstile tokens are single-use and expire after five minutes. The WebUI obtains a fresh token for each new submission attempt.

Do not use Cloudflare's production secret with a testing sitekey, or a testing secret with the production sitekey.

## 9. Run pre-deployment checks

Run the application checks again immediately before deploying:

```sh
npm run check

npx wrangler deploy \
  --config wrangler.staging.toml \
  --dry-run

npx wrangler deploy \
  --config wrangler.staging.toml \
  --env consumer \
  --dry-run
```

Inspect the dry-run output and configuration. Confirm:

- Intake entrypoint is `intake/index.ts`.
- Consumer entrypoint is `consumer/index.ts`.
- Intake binds `ISSUE_BOT_DB` and producer `ISSUE_BOT_QUEUE`.
- Consumer binds the same D1 UUID.
- Consumer consumes the exact main Queue and DLQ.
- The consumer source exports a Queue handler and no `fetch` handler.
- Both kill switches are still `false`.
- No secret appears in the TOML or dry-run output.

Run a repository scan before proceeding:

```sh
git status --short
```

Stop if `wrangler.staging.toml`, a `.dev.vars` file, private key, OpenAI key, Turnstile secret, or generated secret file appears as untracked or modified content.

## 10. Apply the D1 migration remotely

List pending migrations first:

```sh
npx wrangler d1 migrations list \
  pi-webui-issue-bot-staging \
  --remote \
  --config wrangler.staging.toml
```

For a fresh database, expect `0001_initial.sql` to be pending.

Apply it:

```sh
npx wrangler d1 migrations apply \
  pi-webui-issue-bot-staging \
  --remote \
  --config wrangler.staging.toml
```

Review the confirmation prompt. Apply only the expected repository migration. Wrangler captures a backup before the migration and rolls back a failed migration.

List pending migrations again:

```sh
npx wrangler d1 migrations list \
  pi-webui-issue-bot-staging \
  --remote \
  --config wrangler.staging.toml
```

Expect no unapplied migrations.

Verify tables with a read-only query:

```sh
npx wrangler d1 execute \
  pi-webui-issue-bot-staging \
  --remote \
  --config wrangler.staging.toml \
  --command "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name;"
```

Do not manually add columns, paste issue content into the D1 console, or edit `0001_initial.sql` after it has been applied to any shared environment.

## 11. Deploy the disabled Workers

Deploy the private consumer first so the Queue has a consumer before intake exists:

```sh
npx wrangler deploy \
  --config wrangler.staging.toml \
  --env consumer \
  --message "Initial staging consumer deployment; creation disabled"
```

Record the exact Worker name and version ID printed by Wrangler. Do not infer the generated environment-specific Worker name.

Deploy intake second:

```sh
npx wrangler deploy \
  --config wrangler.staging.toml \
  --message "Initial staging intake deployment; admission disabled"
```

At this point:

- Intake health can be public.
- Submission admission remains unavailable.
- Consumer creation remains disabled.
- No GitHub issue should be creatable.
- The intake deployment installs the five-minute cron.

If deploy output shows an unexpected route, Queue, database, account, or Worker name, stop and roll back before installing secrets.

## 12. Install intake-only secrets

Generate two independent random 256-bit keys. Keep each command's output out of shared terminals and screen recordings:

```sh
openssl rand -hex 32
openssl rand -hex 32
```

Assign one value to `IP_HASH_KEY` and the other to `STATUS_TOKEN_KEY`. Do not reuse them across staging and production.

Install secrets interactively into the top-level intake Worker:

```sh
npx wrangler secret put TURNSTILE_SECRET_KEY \
  --config wrangler.staging.toml

npx wrangler secret put IP_HASH_KEY \
  --config wrangler.staging.toml

npx wrangler secret put STATUS_TOKEN_KEY \
  --config wrangler.staging.toml
```

List secret names without values:

```sh
npx wrangler secret list \
  --config wrangler.staging.toml
```

Expected intake-only names:

- `TURNSTILE_SECRET_KEY`
- `IP_HASH_KEY`
- `STATUS_TOKEN_KEY`

The intake list must not contain any `OPENAI_*` or `GITHUB_*` secret.

## 13. Install consumer-only secrets

Before installing these, complete the separate GitHub App setup and run the account-level OpenAI model canary described in [`README.md`](./README.md). The GitHub App should be installed only on the approved staging repository with only Issues read/write capability.

Install the consumer secrets with `--env consumer`:

```sh
npx wrangler secret put OPENAI_API_KEY \
  --config wrangler.staging.toml \
  --env consumer

npx wrangler secret put GITHUB_APP_ID \
  --config wrangler.staging.toml \
  --env consumer

npx wrangler secret put GITHUB_APP_INSTALLATION_ID \
  --config wrangler.staging.toml \
  --env consumer

npx wrangler secret put GITHUB_APP_PRIVATE_KEY \
  --config wrangler.staging.toml \
  --env consumer
```

Paste the complete GitHub App PEM when Wrangler prompts. The implementation accepts GitHub's PKCS#1 `BEGIN RSA PRIVATE KEY` form and PKCS#8 `BEGIN PRIVATE KEY` form.

List secret names:

```sh
npx wrangler secret list \
  --config wrangler.staging.toml \
  --env consumer
```

Expected consumer-only names:

- `OPENAI_API_KEY`
- `GITHUB_APP_ID`
- `GITHUB_APP_INSTALLATION_ID`
- `GITHUB_APP_PRIVATE_KEY`

The consumer list must not contain `TURNSTILE_SECRET_KEY`, `IP_HASH_KEY`, or `STATUS_TOKEN_KEY`.

## 14. Verify Cloudflare bindings and exposure

Use both Wrangler output and the Cloudflare dashboard. Do not rely on configuration text alone.

### 14.1 Intake Worker

Under **Workers & Pages → intake Worker → Settings**, confirm:

- Custom Domain is exactly the staging intake hostname.
- D1 binding name is `ISSUE_BOT_DB` and points to the staging database UUID.
- Queue producer binding is `ISSUE_BOT_QUEUE` and points to the staging main Queue.
- Cron trigger is exactly `*/5 * * * *`.
- Intake has exactly the three expected secret names.
- `ISSUE_BOT_ADMISSION_ENABLED` is `false`.
- Allowed origins and Turnstile hostnames are exact staging values.

### 14.2 Consumer Worker

Confirm:

- No Custom Domain.
- No route.
- No enabled public `workers.dev` route.
- No HTTP `fetch` endpoint in the deployed source.
- D1 binding `ISSUE_BOT_DB` points to the same staging database UUID.
- Main Queue and DLQ both identify this Worker as their only push consumer.
- Consumer has exactly the four expected secret names.
- `ISSUE_BOT_CREATE_ENABLED` is `false`.
- GitHub owner, repository, App slug, and Queue names are exact staging values.

If the consumer is publicly reachable, remove its route/`workers.dev` exposure immediately. The missing `fetch` handler is defense in depth, not permission to leave a public route attached.

### 14.3 Main Queue

Confirm:

- Name matches `ISSUE_BOT_MAIN_QUEUE_NAME` byte-for-byte.
- Consumer is the intended private consumer Worker.
- Batch size is 10.
- Batch timeout is 5 seconds.
- Retries are 3.
- Dead-letter Queue is the exact staging DLQ.

### 14.4 DLQ

Confirm:

- It has the same private consumer Worker.
- It does not dead-letter back to itself.
- It has no HTTP pull consumer unless separately reviewed and approved.

### 14.5 Cron

Under **intake Worker → Settings → Triggers → Cron Triggers**, confirm the five-minute trigger. Cloudflare cron expressions use UTC. Deployment propagation can take several minutes.

After the first invocation, inspect **Cron Events** and expect an `ok` outcome. Cron history contains the most recent events. Do not enable prose logging to troubleshoot cron execution.

## 15. Verify intake health while admission is disabled

Call the public Custom Domain:

```sh
curl --fail-with-body \
  https://issue-bot-staging.example.com/health
```

Expected body:

```json
{"ok":true,"status":"ready"}
```

Also verify unknown routes fail closed:

```sh
curl -i https://issue-bot-staging.example.com/not-a-route
```

Expected result: HTTP 404 with a small content-free JSON error.

Health means the intake code is reachable; it does not prove D1, Queue, Turnstile, OpenAI, or GitHub behavior.

## 16. Tail only content-free operational events

For temporary staging diagnosis:

```sh
npx wrangler tail \
  --config wrangler.staging.toml \
  --format pretty
```

Consumer tailing:

```sh
npx wrangler tail \
  --config wrangler.staging.toml \
  --env consumer \
  --format pretty
```

Expected consumer terminal events contain only submission IDs, terminal status, and reason codes. Stop if logs contain raw titles, issue bodies, prompts, model output, Turnstile tokens, GitHub tokens, PEM material, or source IP addresses.

Do not leave an operator tail running unnecessarily.

## 17. Configure the staging WebUI only after gateway verification

The WebUI needs only public values:

```js
window.__PI_WEBUI_ISSUE_BOT_CONFIG__ = Object.freeze({
  enabled: true,
  gatewayBaseUrl: "https://issue-bot-staging.example.com",
  turnstileSiteKey: "STAGING_PUBLIC_SITEKEY",
  privateSecurityReportUrl: "https://github.com/APPROVED_OWNER/APPROVED_REPOSITORY/security/advisories/new",
});
```

The object must exist before `app.js` loads. It must never contain the Turnstile secret, OpenAI key, GitHub App values, D1 UUID, Queue names, or status-token key.

Adding `enabled: true` exposes the automatic-submission UI, but intake still rejects admission while `ISSUE_BOT_ADMISSION_ENABLED` remains false. The Copy fallback remains available.

If the WebUI CSP is enforced, explicitly allow the approved intake origin and Cloudflare Turnstile script/frame/connect endpoints. Use the narrowest directives compatible with the final deployment.

## 18. Staged enablement sequence

Do not switch both gates simultaneously.

### Stage A: fully disabled infrastructure

Required state:

```toml
ISSUE_BOT_ADMISSION_ENABLED = "false"
ISSUE_BOT_CREATE_ENABLED = "false"
```

Validate health, bindings, Queue/DLQ ownership, cron, D1 migration, secret separation, and consumer non-reachability.

### Stage B: admission shadow mode

Change only intake:

```toml
ISSUE_BOT_ADMISSION_ENABLED = "true"
```

Keep consumer creation false:

```toml
ISSUE_BOT_CREATE_ENABLED = "false"
```

Deploy only intake:

```sh
npx wrangler deploy \
  --config wrangler.staging.toml \
  --message "Enable staging intake admission; GitHub creation remains disabled"
```

Use synthetic, non-sensitive submissions to verify:

- Exact CORS origin succeeds; unapproved origins fail.
- Valid Turnstile action/hostname/`cData` succeeds.
- Invalid, expired, replayed, or mismatched Turnstile tokens fail.
- Duplicate content and idempotency conflicts fail deterministically.
- Queue messages reach the consumer.
- Status polling requires the in-memory bearer capability.
- No GitHub issue is created while the create gate is false.
- D1 and logs contain no unexpected prose outside the temporary outbox.
- Cron removes/retries temporary outbox data as designed.

### Stage C: controlled staging creation

Before enabling:

1. Run the authenticated OpenAI canary with the approved direct API model ID.
2. Confirm the GitHub App installation is restricted to the staging repository.
3. Confirm fixed labels are empty or pre-created and approved.
4. Lower initial quotas/concurrency if operational review requires it.
5. Start monitoring Queue depth, DLQ deliveries, unknown outcomes, model decisions, and cost.

Change only:

```toml
ISSUE_BOT_CREATE_ENABLED = "true"
```

Deploy the consumer:

```sh
npx wrangler deploy \
  --config wrangler.staging.toml \
  --env consumer \
  --message "Enable controlled staging GitHub issue creation"
```

Run synthetic tests for:

- Exact acceptable verdict creates one issue.
- Rejection, refusal, malformed output, risky flags, and incomplete output create zero issues.
- Forced redelivery creates exactly one issue.
- Ambiguous GitHub mutation enters reconciliation-only and is never blindly posted again.
- Exhausted retries reach the DLQ and become unavailable without OpenAI/GitHub calls.
- Created issue author matches the exact configured App bot identity.
- Created title/body are byte-compatible with the canonical WebUI issue.

Production remains blocked until these results are independently reviewed.

## 19. Production promotion

Production is a new provisioning run, not a rename of staging resources.

Repeat this runbook with:

- New production D1 database.
- New production main Queue and DLQ.
- New production Turnstile widget and secret.
- Production-only Worker names and Custom Domain.
- Production WebUI hostname and exact origin.
- Production GitHub App installation scope.
- Independent random `IP_HASH_KEY` and `STATUS_TOKEN_KEY`.
- Both production gates initially false.

Do not copy staging D1 rows or Queue messages into production. Promote reviewed configuration values and application code, not runtime data or secrets.

## 20. Rollback and emergency shutdown

### 20.1 Normal feature rollback

1. Set consumer creation false and deploy consumer:

   ```toml
   ISSUE_BOT_CREATE_ENABLED = "false"
   ```

   ```sh
   npx wrangler deploy \
     --config wrangler.staging.toml \
     --env consumer \
     --message "Emergency disable GitHub creation"
   ```

2. Set intake admission false and deploy intake:

   ```toml
   ISSUE_BOT_ADMISSION_ENABLED = "false"
   ```

   ```sh
   npx wrangler deploy \
     --config wrangler.staging.toml \
     --message "Emergency disable issue-bot admission"
   ```

3. Set the WebUI runtime configuration to `enabled: false` and redeploy the WebUI. The Copy fallback should remain available.
4. Preserve Queue, DLQ, D1, and content-free logs for investigation. Do not automatically delete created GitHub issues.

Disable creation before admission because already queued messages may still reach the consumer.

### 20.2 Consumer exposure incident

If the consumer acquires a public route:

1. Disable creation immediately.
2. Remove Custom Domains/routes and disable `workers.dev` exposure from the consumer.
3. Confirm deployed source still has no `fetch` handler.
4. Review access logs.
5. Rotate consumer secrets if there is any credible exposure path.

### 20.3 Credential exposure

If a secret is pasted into Git, logs, a ticket, or browser configuration:

- Turnstile secret: rotate it in Turnstile and update intake.
- `IP_HASH_KEY`: replace it; understand that rate-limit bucket continuity will reset.
- `STATUS_TOKEN_KEY`: replace it; outstanding status capabilities may stop working.
- OpenAI key: revoke and replace it in the consumer.
- GitHub App private key: revoke the key, generate another, and update the consumer.
- GitHub installation compromise: suspend or uninstall the App while investigating.

Do not merely delete the leaked text; rotate the credential.

### 20.4 Bad migration

Stop admission and creation. Do not improvise destructive SQL. Use the D1 backup created before migration, inspect migration state, and prepare a reviewed forward migration or documented restore procedure. Preserve Queue/DLQ data until schema compatibility is restored or messages are deliberately terminalized.

## 21. Common failure modes

### `origin_not_allowed`

Check the browser's exact `Origin` header. It must exactly equal an entry in `ISSUE_BOT_ALLOWED_ORIGINS`, including scheme and port, with no trailing slash.

### `verification_failed`

Check, without logging the token:

- Browser sitekey belongs to the same Turnstile widget as the intake secret.
- Widget permits the WebUI hostname.
- `TURNSTILE_ALLOWED_HOSTNAMES` has hostname only.
- `TURNSTILE_EXPECTED_ACTION` is `issue_bot_submit`.
- The token is less than five minutes old and has not been reused.
- Production and test sitekeys/secrets are not mixed.

### Intake returns `unavailable`

Expected while admission is false. Otherwise check policy version, required secrets, D1 binding, Queue binding, quota state, and scheduled cleanup status.

### Queue deployment says another consumer exists

Each Queue permits only one push consumer. Identify the existing attachment before changing anything. Do not delete it unless ownership is confirmed.

### Messages appear in the DLQ

Do not replay blindly. First inspect content-free terminal reason/state, consumer secret names, model availability, GitHub App installation, D1 lease/mutation state, and recent provider failures. The implementation consumes DLQ messages as unavailable without OpenAI/GitHub calls.

### Cron does not appear immediately

Confirm `[triggers]` is top-level in the intake configuration and redeploy intake. Allow several minutes for propagation. Check the intake Worker's **Settings → Triggers** and Cron Events.

### D1 binding works for intake but not consumer

Wrangler environment bindings are configured separately. Verify both top-level `[[d1_databases]]` and `[[env.consumer.d1_databases]]` use binding `ISSUE_BOT_DB` and the identical database UUID.

### Consumer appears public

Treat this as a security failure even though the code has no `fetch` handler. Remove routes and `workers.dev` exposure, keep creation disabled, and verify the deployed environment.

## 22. Final operator sign-off checklist

Do not enable production until every item has an owner and evidence:

- [ ] Correct Cloudflare account and zone recorded.
- [ ] Staging and production resources are separate.
- [ ] D1 UUID matches both Worker bindings.
- [ ] Exact migration applied and no migration remains pending.
- [ ] Main Queue and DLQ names match configuration exactly.
- [ ] Main Queue has the expected retry and DLQ policy.
- [ ] Only the private consumer consumes each Queue.
- [ ] Intake has a public Custom Domain and expected TLS certificate.
- [ ] Consumer has no Custom Domain, route, public `workers.dev` endpoint, or `fetch` handler.
- [ ] Cron runs every five minutes on intake only and has a successful event.
- [ ] Turnstile widget permits only approved browser hostnames.
- [ ] Origin, hostname, action, and UUID `cData` checks pass in staging.
- [ ] Intake and consumer secret-name lists are disjoint and correct.
- [ ] No deployment configuration or secret is tracked by Git.
- [ ] OpenAI model canary passes with an explicitly approved direct API model ID.
- [ ] GitHub App is installed only on the approved repository with only Issues access.
- [ ] Synthetic non-accept paths create zero issues.
- [ ] Redelivery creates exactly one issue.
- [ ] Ambiguous mutations never cause a blind second POST.
- [ ] DLQ processing calls neither OpenAI nor GitHub.
- [ ] D1/log review finds no unexpected raw prose, tokens, source IPs, prompts, or model output.
- [ ] Quotas, cost alerts, Queue/DLQ monitoring, and incident ownership are approved.
- [ ] Rollback has been rehearsed in staging.
- [ ] An explicit human approval exists for production admission.
- [ ] A separate explicit human approval exists for production GitHub creation.

## 23. Official references

- [Cloudflare D1 getting started](https://developers.cloudflare.com/d1/get-started/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare Queues getting started](https://developers.cloudflare.com/queues/get-started/)
- [Queue configuration, retries, and DLQs](https://developers.cloudflare.com/queues/configuration/configure-queues/)
- [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Create a Turnstile widget](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/)
- [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

Repository references:

- [`README.md`](./README.md)
- [`wrangler.toml.example`](./wrangler.toml.example)
- [`migrations/0001_initial.sql`](./migrations/0001_initial.sql)
- [`intake/index.ts`](./intake/index.ts)
- [`intake/turnstile.ts`](./intake/turnstile.ts)
- [`consumer/index.ts`](./consumer/index.ts)
- [`../../reports/issue-bot.html`](../../reports/issue-bot.html)
