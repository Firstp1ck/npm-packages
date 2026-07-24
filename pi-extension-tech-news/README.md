# pi-extension-tech-news

Pi extension that adds a generic `news_feed` tool backed by Hacker News, Socket.dev Blog, Reddit tech subreddits, X/Twitter, and optional authenticated sources like daily.dev. By default it fetches up to 10 total entries across all configured sources, split evenly per enabled source.

## Tools

- `news_feed` — fetch entries from `hackernews`, `socket`, `dailydev`, `reddit`, `twitter`, or `all`.
- `news_sec` — agent-callable security/CVE-focused feed, equivalent to `/news-sec [limit] [redditSort]`. Prioritizes confirmed HIGH/CRITICAL CVEs from NVD, deduped by CVE ID and enriched with CISA KEV, CVE.org, FIRST EPSS, OSV, and GitHub Advisory signals.
  - Hacker News feeds: `top`, `new`, `best`, `ask`, `show`, `job`.
  - Socket source uses `https://socket.dev/api/blog/feed.json`.
  - daily.dev source uses `https://api.daily.dev/public/v1/feeds/popular` with `DAILY_DEV_TOKEN` when configured. Without an API token, it can use opt-in browser session headers (`DAILY_DEV_COOKIE` / optional `DAILY_DEV_AUTHORIZATION`) for authenticated internal GraphQL feeds (`recent` or `upvoted`), otherwise it falls back to the unauthenticated internal GraphQL endpoint.
  - Reddit source fetches subreddit JSON feeds directly from `www.reddit.com` using `REDDIT_SESSION` and optional `TOKEN_V2` cookies when configured.
  - X/Twitter source uses the official X API v2 recent-search endpoint with `X_BEARER_TOKEN` as the primary source. If the API token is missing or the request fails, it falls back to Nitter RSS. Nitter uses built-in defaults unless overridden with `NITTER_BASE_URL` + `NITTER_ACCOUNTS`.
  - Default Reddit subreddits include general tech/dev plus security/CVE-relevant communities: `cybersecurity`, `netsec`, `InfoSecNews`, `blueteamsec`, `AskNetsec`, `ReverseEngineering`, `malware`, `exploitdev`, `pwned`, `sysadmin`, and `devops`.
  - Reddit parameters: `subreddits?: string[]`, `redditSort?: "hot" | "new" | "top" | "rising"`.
  - Twitter parameters: `twitterQuery?: string`, `twitterAccounts?: string[]`, `twitterRank?: "engagement" | "recent"` (official X API only; default `engagement`).
  - daily.dev parameters: `dailyDevRank?: "upvoted" | "recent"` (default `upvoted`; uses daily.dev's internal GraphQL `mostUpvotedFeed`).
- `news_sec` — agent-callable security/CVE-focused feed, equivalent to `/news-sec [limit] [redditSort]`.
  - Parameters: `limit?: number`, `redditSort?: "hot" | "new" | "top" | "rising"`.
  - Prioritizes confirmed `HIGH`/`CRITICAL` CVEs from NVD, deduped by CVE ID and enriched with CISA KEV, CVE.org, FIRST EPSS, OSV, and GitHub Advisory signals.
  - CVEs appearing in more sources are ranked higher; rejected/denied/reserved CVE states are filtered out when available.

## Commands

```text
/news [hackernews|socket|dailydev|reddit|twitter|all] [limit] [top|new|best|ask|show|job|hot|new|top|rising|engagement|recent|upvoted|popular] [subreddits=programming,rust] [accounts=OpenAI,github] [query=from:OpenAI]
/news-save [same args as /news]              # show once per session and save to ~/.pi/NEWS/GENERAL/
/news-sec [limit] [hot|new|top|rising]
/news-sec-save [limit] [hot|new|top|rising] # show once per session and save to ~/.pi/NEWS/SECURITY/
/news-setup
```

Examples:

```text
/news                                  # all enabled sources, max 10 total
/news socket 10
/news dailydev 10                      # most-upvoted daily.dev feed from the past 7 days
/news dailydev 10 recent               # recent personalized daily.dev session feed
/news reddit 20 hot
/news reddit 20 rising subreddits=programming,rust,selfhosted
/news twitter 20 engagement accounts=CISAgov,TheHackersNews
/news twitter 20 recent accounts=CISAgov,TheHackersNews
/news twitter 20 query=(from:CISAgov OR from:TheHackersNews) -is:retweet
/news all 20 new
/news hackernews 20 new
/news-sec 25 hot                       # confirmed high/critical CVEs, enriched and deduped by CVE ID
/news-sec 25 new                       # same CVE feed; falls back to Reddit/Socket if CVE APIs return no entries
/news-save all 20 new                  # show once and save general news to ~/.pi/NEWS/GENERAL/
/news-sec-save 25 hot                  # show once and save security news to ~/.pi/NEWS/SECURITY/
/news-setup                            # configure daily.dev, Reddit, or Twitter/X auth
```

## daily.dev setup

Run `/news-setup`, choose `daily.dev`, then configure one of the available auth modes.

### Recommended: official API token

Paste a Personal Access Token from:

```text
https://app.daily.dev/settings/api
```

If configured, the token is saved to Pi's global env file and is used unless browser session headers are also configured:

```text
~/.pi/agent/.env
```

as:

```bash
DAILY_DEV_TOKEN="..."
```

### Advanced: browser session headers

This is an opt-in fallback for mimicking the authenticated daily.dev web app feed through daily.dev's internal GraphQL API. It is unofficial and can break when daily.dev changes private app operations.

How to get the header values:

1. Open `https://app.daily.dev` in a browser and log in.
2. Open DevTools (`F12`) → **Network**.
3. Refresh the daily.dev feed while DevTools is open.
4. In the DevTools **Network request list**, filter by **Fetch/XHR** or search for `graphql`.
5. Select a **POST** request whose URL is `https://api.daily.dev/graphql` inside DevTools.
   - Do **not** open that URL in the browser tab.
   - If opened directly, it sends the wrong request and returns `{"errors":[{"message":"Unknown query"}]}`.
6. With the Network request selected, open **Headers** → **Request Headers**.
7. Copy the full request `Cookie` header.
8. Optional: copy the request `Authorization` header if present.
9. Paste them into `/news-setup` → `daily.dev` → `Enter session headers`.

The values are saved to:

```bash
DAILY_DEV_COOKIE="..."                 # full Cookie request header
DAILY_DEV_AUTHORIZATION="Bearer ..."   # optional; full header or token-only value accepted
```

Auth precedence for `/news dailydev` is:

1. `DAILY_DEV_COOKIE` / `DAILY_DEV_AUTHORIZATION` → authenticated internal GraphQL `mostUpvotedFeed(..., period: 7)` by default, or `feed(..., ranking: TIME)` when `recent` is requested
2. `DAILY_DEV_TOKEN` → official REST API for `recent`; `upvoted` still uses internal GraphQL `mostUpvotedFeed(..., period: 7)`
3. no auth → internal GraphQL `mostUpvotedFeed(..., period: 7)` by default, or anonymous `latest(...)` when `recent` is requested

Treat session headers like passwords. They authenticate your browser session and may expire.

## Twitter/X + Nitter setup

Run `/news-setup`, choose `Twitter/X + Nitter`, then configure one or both:

- `X_BEARER_TOKEN` — official X API Bearer Token for API v2 recent search. This is the primary source and enables engagement-based ranking.
- `NITTER_BASE_URL` — optional fallback Nitter-compatible instance base URL. Default: `https://nitter.net`.
- `NITTER_ACCOUNTS` — optional comma-separated handles for fallback RSS feeds. Default focuses on cybersecurity and developer trendsetters: `CISAgov,TheHackersNews,BleepinComputer,vxunderground,SwiftOnSecurity,SocketSecurity,GitHubSecurity,t3dotgg,rauchg,swyx,addyosmani,dan_abramov,github,HackerNewsYC`.

Saved config uses Pi's global env file:

```bash
X_BEARER_TOKEN="..."
NITTER_BASE_URL="https://nitter.net"
NITTER_ACCOUNTS="OpenAI,github,SocketSecurity"
```

If `twitterQuery` / `query=` is not provided, the extension builds an X recent-search query from `twitterAccounts` / `accounts=`, `NITTER_ACCOUNTS`, or the built-in default accounts:

```text
(from:CISAgov OR from:TheHackersNews OR from:BleepinComputer OR from:vxunderground OR from:SwiftOnSecurity OR from:SocketSecurity OR from:GitHubSecurity OR from:t3dotgg OR from:rauchg OR from:swyx OR from:addyosmani OR from:dan_abramov OR from:github OR from:HackerNewsYC) -is:retweet
```

Nitter fallback is best-effort. Public instances often rate-limit, block RSS bots, or disappear.

## Reddit setup

Run `/news-setup`, choose `Reddit cookies`, then follow the prompt.

How to get the cookie values:

1. Open `https://www.reddit.com` in a browser and log in.
2. Open DevTools (`F12`).
3. Go to **Application** / **Storage** → **Cookies** → `https://www.reddit.com`.
4. Copy the value of the `reddit_session` cookie.
5. Optional: copy the value of the `token_v2` cookie.
6. Paste them into `/news-setup`.

The values are saved to:

```text
~/.pi/agent/.env
```

as:

```bash
REDDIT_SESSION="..."
TOKEN_V2="..." # optional
```

Treat these cookie values like passwords. They authenticate your Reddit browser session.

## Install locally

Symlink `index.ts` into Pi's extension directory:

```bash
ln -s "$HOME/pi-coding-agent-forge/pi-extension-tech-news/index.ts" "$HOME/.pi/agent/extensions/tech-news.ts"
```

Then run `/reload` in Pi.
