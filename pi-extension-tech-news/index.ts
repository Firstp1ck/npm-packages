import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { extractXmlTag as getXmlTag, getAgentEnvPath, resolveEnvValue, upsertEnvValue, withExtensionWorkingIndicator, type ExtensionWorkingIndicator } from "@firstpick/pi-utils";
import { Type } from "typebox";

const HN_BASE_URL = "https://hacker-news.firebaseio.com/v0";
const SOCKET_FEED_URL = "https://socket.dev/api/blog/feed.json";
const NVD_CVE_API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const CISA_KEV_JSON_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const FIRST_EPSS_API_URL = "https://api.first.org/data/v1/epss";
const GITHUB_ADVISORIES_API_URL = "https://api.github.com/advisories";
const OSV_API_URL = "https://api.osv.dev/v1/vulns";
const CVE_RECORD_API_URL = "https://cveawg.mitre.org/api/cve";
const DAILY_DEV_BASE_URL = "https://api.daily.dev/public/v1";
const DAILY_DEV_TOKEN_ENV = "DAILY_DEV_TOKEN";
const DAILY_DEV_COOKIE_ENV = "DAILY_DEV_COOKIE";
const DAILY_DEV_AUTHORIZATION_ENV = "DAILY_DEV_AUTHORIZATION";
const X_BEARER_TOKEN_ENV = "X_BEARER_TOKEN";
const NITTER_BASE_URL_ENV = "NITTER_BASE_URL";
const NITTER_ACCOUNTS_ENV = "NITTER_ACCOUNTS";
const DEFAULT_NITTER_BASE_URL = "https://nitter.net";
const NITTER_RSS_USER_AGENT = "FreshRSS/1.24";
const DEFAULT_TWITTER_ACCOUNTS = [
  // Cybersecurity / vulnerability intelligence
  "CISAgov",
  "TheHackersNews",
  "BleepinComputer",
  "vxunderground",
  "SwiftOnSecurity",
  "SocketSecurity",
  "GitHubSecurity",
  // Developer ecosystem / trendsetters
  "t3dotgg",
  "rauchg",
  "swyx",
  "addyosmani",
  "dan_abramov",
  "github",
  "HackerNewsYC",
] as const;
const REDDIT_SESSION_ENV = "REDDIT_SESSION";
const REDDIT_TOKEN_V2_ENV = "TOKEN_V2";
const REDDIT_USER_AGENT = "pi-news-feed/0.1 (+https://reddit.com)";
const SECURITY_REDDIT_SUBREDDITS = [
  "cybersecurity",
  "netsec",
  "InfoSecNews",
  "blueteamsec",
  "AskNetsec",
  "ReverseEngineering",
  "malware",
  "exploitdev",
  "pwned",
  "sysadmin",
  "devops",
] as const;

const DEFAULT_REDDIT_SUBREDDITS = [
  "programming",
  "technology",
  "MachineLearning",
  "LocalLLaMA",
  "selfhosted",
  "rust",
  "typescript",
  "javascript",
  "python",
  ...SECURITY_REDDIT_SUBREDDITS,
] as const;
const NEWS_MESSAGE_TYPE = "news-feed-result";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_DAILY_DEV_RANK: DailyDevRank = "upvoted";
const DAILY_DEV_SUPPORTED_TYPES = ["article", "share", "freeform", "tweet", "video:youtube", "collection", "poll"] as const;
const MAX_COMMENT_DEPTH = 3;
const MAX_COMMENT_COUNT = 100;
const NEWS_GENERAL_DIR = join(homedir(), ".pi", "NEWS", "GENERAL");
const NEWS_SECURITY_DIR = join(homedir(), ".pi", "NEWS", "SECURITY");
const shownNewsOutputs = new Set<string>();

const NEWS_SOURCES = ["hackernews", "socket", "dailydev", "reddit", "twitter", "all"] as const;
const CONCRETE_NEWS_SOURCES = ["hackernews", "socket", "dailydev", "reddit", "twitter"] as const;
type ConcreteNewsSource = (typeof CONCRETE_NEWS_SOURCES)[number];
type NewsSource = (typeof NEWS_SOURCES)[number];

const HN_FEEDS = ["top", "new", "best", "ask", "show", "job"] as const;
type HnFeed = (typeof HN_FEEDS)[number];

type HnItem = {
  id: number;
  deleted?: boolean;
  type?: "job" | "story" | "comment" | "poll" | "pollopt";
  by?: string;
  time?: number;
  text?: string;
  dead?: boolean;
  parent?: number;
  poll?: number;
  kids?: number[];
  url?: string;
  score?: number;
  title?: string;
  parts?: number[];
  descendants?: number;
};

type CommentNode = {
  id: number;
  by?: string;
  time?: number;
  text?: string;
  kids?: CommentNode[];
};

type NewsEntry = {
  source: "hackernews" | "socket" | "dailydev" | "reddit" | "twitter" | "vuln";
  id?: string | number;
  title: string;
  url: string;
  sourceUrl?: string;
  author?: string;
  score?: number;
  comments?: number;
  publishedAt?: string;
  summary?: string;
  feed?: string;
};

type VulnerabilityEntry = NewsEntry & {
  source: "vuln";
  cve: string;
  severity?: "CRITICAL" | "HIGH";
  cvss?: number;
  epss?: number;
  sourceCount: number;
  sources: string[];
  affected?: string[];
  status?: string;
  fixed?: boolean;
};

type SocketJsonFeed = {
  title?: string;
  home_page_url?: string;
  feed_url?: string;
  items?: Array<{
    id?: string;
    url?: string;
    external_url?: string;
    title?: string;
    content_text?: string;
    content_html?: string;
    summary?: string;
    date_published?: string;
    date_modified?: string;
    author?: { name?: string };
    authors?: Array<{ name?: string }>;
  }>;
};

type DailyDevPost = {
  id?: string;
  title?: string | null;
  titleHtml?: string | null;
  url?: string | null;
  summary?: string | null;
  content?: string | null;
  contentHtml?: string | null;
  publishedAt?: string | null;
  createdAt?: string;
  commentsPermalink?: string;
  permalink?: string;
  source?: { id?: string; name?: string; handle?: string; image?: string | null };
  tags?: string[];
  numUpvotes?: number;
  numComments?: number;
  author?: { name?: string | null; username?: string | null } | null;
  type?: string | null;
  readTime?: number | null;
  bookmarked?: boolean;
  read?: boolean;
  upvoted?: boolean;
  userState?: { vote?: number } | null;
  sharedPost?: DailyDevPost | null;
};

type DailyDevFeedResponse = {
  data?: DailyDevPost[];
};

type DailyDevGraphqlPostConnection = {
  edges?: Array<{
    node?: DailyDevPost;
  }>;
};

type DailyDevGraphqlResponse = {
  data?: {
    latest?: DailyDevPost[];
    feed?: DailyDevGraphqlPostConnection;
    mostUpvotedFeed?: DailyDevGraphqlPostConnection;
  };
  errors?: Array<{ message?: string }>;
};

type RedditListingResponse = {
  error?: number | string;
  message?: string;
  data?: {
    children?: Array<{
      data?: {
        id?: string;
        title?: string;
        author?: string;
        subreddit?: string;
        score?: number;
        num_comments?: number;
        url?: string;
        permalink?: string;
        created_utc?: number;
        selftext?: string;
        over_18?: boolean;
        stickied?: boolean;
      };
    }>;
  };
};

type RedditSort = "hot" | "new" | "top" | "rising";
type TwitterRank = "engagement" | "recent";
type DailyDevRank = "recent" | "upvoted";

type XRecentSearchResponse = {
  data?: Array<{
    id: string;
    text?: string;
    author_id?: string;
    created_at?: string;
    public_metrics?: {
      retweet_count?: number;
      reply_count?: number;
      like_count?: number;
      quote_count?: number;
    };
  }>;
  includes?: {
    users?: Array<{ id: string; username?: string; name?: string }>;
  };
  errors?: Array<{ title?: string; detail?: string }>;
};

type RssItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  creator?: string;
  description?: string;
};

type NvdResponse = {
  vulnerabilities?: Array<{
    cve?: {
      id?: string;
      published?: string;
      lastModified?: string;
      vulnStatus?: string;
      descriptions?: Array<{ lang?: string; value?: string }>;
      metrics?: {
        cvssMetricV31?: Array<{ cvssData?: { baseScore?: number; baseSeverity?: string } }>;
        cvssMetricV30?: Array<{ cvssData?: { baseScore?: number; baseSeverity?: string } }>;
        cvssMetricV2?: Array<{ baseSeverity?: string; cvssData?: { baseScore?: number } }>;
      };
      references?: { referenceData?: Array<{ url?: string }> };
      configurations?: Array<{ nodes?: Array<{ cpeMatch?: Array<{ criteria?: string; matchCriteriaId?: string; vulnerable?: boolean }> }> }>;
    };
  }>;
};

type CisaKevResponse = { vulnerabilities?: Array<{ cveID?: string; vulnerabilityName?: string; dateAdded?: string; shortDescription?: string; requiredAction?: string; vendorProject?: string; product?: string }> };
type EpssResponse = { data?: Array<{ cve?: string; epss?: string; percentile?: string }> };
type GitHubAdvisory = { ghsa_id?: string; cve_id?: string | null; summary?: string; description?: string; severity?: string; published_at?: string; updated_at?: string; html_url?: string; state?: string; vulnerabilities?: Array<{ vulnerable_version_range?: string; patched_versions?: string | null; package?: { ecosystem?: string; name?: string } }> };
type CveRecordResponse = { cveMetadata?: { cveId?: string; state?: string; datePublished?: string; dateUpdated?: string }; containers?: { cna?: { descriptions?: Array<{ lang?: string; value?: string }> } } };
type OsvVulnerability = { id?: string; aliases?: string[]; summary?: string; details?: string; modified?: string; published?: string; affected?: Array<{ ranges?: Array<{ events?: Array<{ fixed?: string }> }> }> };

type SetupUiContext = {
  ui: {
    input(title: string, placeholder?: string): Promise<string | undefined>;
    select(title: string, options: string[]): Promise<string | undefined>;
    notify(message: string, level?: "info" | "warning" | "error" | "success"): void;
  };
};

type NewsMessageDetails = {
  source: NewsSource;
  entries: NewsEntry[];
  generatedAt: number;
};

type ParsedNewsArgs = {
  source: NewsSource;
  feed: HnFeed;
  limit: number;
  redditSort: RedditSort;
  subreddits?: string[];
  twitterQuery?: string;
  twitterAccounts?: string[];
  twitterRank: TwitterRank;
  dailyDevRank: DailyDevRank;
};

type ParsedSecurityNewsArgs = {
  limit: number;
  redditSort: RedditSort;
};

const sourceSchema = Type.Union([Type.Literal("hackernews"), Type.Literal("socket"), Type.Literal("dailydev"), Type.Literal("reddit"), Type.Literal("twitter"), Type.Literal("all")]);
const hnFeedSchema = Type.Union([
  Type.Literal("top"),
  Type.Literal("new"),
  Type.Literal("best"),
  Type.Literal("ask"),
  Type.Literal("show"),
  Type.Literal("job"),
]);

const redditSortSchema = Type.Union([Type.Literal("hot"), Type.Literal("new"), Type.Literal("top"), Type.Literal("rising")]);
const twitterRankSchema = Type.Union([Type.Literal("engagement"), Type.Literal("recent")]);
const dailyDevRankSchema = Type.Union([Type.Literal("recent"), Type.Literal("upvoted")]);

const NEWS_FEED_PARAMS = Type.Object({
  source: Type.Optional(sourceSchema, { description: "News source: hackernews, socket, dailydev, reddit, twitter, or all." }),
  feed: Type.Optional(hnFeedSchema, { description: "Hacker News feed when source is hackernews/all: top, new, best, ask, show, or job." }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_LIMIT, description: "Number of entries to return, max 50." })),
  subreddits: Type.Optional(Type.Array(Type.String(), { description: "Reddit subreddits to fetch when source is reddit/all. Defaults to tech subreddits." })),
  redditSort: Type.Optional(redditSortSchema, { description: "Reddit sort: hot, new, top, or rising." }),
  twitterQuery: Type.Optional(Type.String({ description: "X/Twitter recent-search query. Defaults to configured NITTER_ACCOUNTS as from:user OR terms, then tech-news terms." })),
  twitterAccounts: Type.Optional(Type.Array(Type.String(), { description: "X/Twitter accounts to fetch via query/from:account and Nitter fallback." })),
  twitterRank: Type.Optional(twitterRankSchema, { description: "Twitter/X ranking mode for official API results: engagement or recent. Defaults to engagement." }),
  dailyDevRank: Type.Optional(dailyDevRankSchema, { description: "daily.dev ranking mode when source is dailydev/all: upvoted or recent. Defaults to upvoted." }),
});

const NEWS_SEC_PARAMS = Type.Object({
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_LIMIT, description: "Number of security/CVE-relevant entries to return, max 50. Defaults to 20." })),
  redditSort: Type.Optional(redditSortSchema, { description: "Reddit sort for security subreddits: hot, new, top, or rising. Defaults to hot." }),
});

const ITEM_PARAMS = Type.Object({
  id: Type.Number({ minimum: 1, description: "Hacker News item ID." }),
  includeComments: Type.Optional(Type.Boolean({ description: "Whether to include a bounded comment tree for story items." })),
  maxDepth: Type.Optional(Type.Number({ minimum: 0, maximum: MAX_COMMENT_DEPTH, description: "Maximum comment depth, max 3." })),
  maxComments: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_COMMENT_COUNT, description: "Maximum total comments to fetch, max 100." })),
});

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function hnFeedToEndpoint(feed: HnFeed): string {
  return feed === "top" ? "topstories" : `${feed}stories`;
}

function hnItemUrl(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

async function fetchUrlJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal,
    headers: { "user-agent": "pi-news-feed/0.1 (+https://socket.dev)" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return (await response.json()) as T;
}

async function fetchHnJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return fetchUrlJson<T>(`${HN_BASE_URL}${path}`, signal);
}

async function fetchHnItem(id: number, signal?: AbortSignal): Promise<HnItem | null> {
  return fetchHnJson<HnItem | null>(`/item/${id}.json`, signal);
}

function htmlToText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .trim();
}

function summarizeHnStory(item: HnItem, feed: HnFeed): NewsEntry {
  return {
    source: "hackernews",
    feed,
    id: item.id,
    title: item.title ?? `(untitled item ${item.id})`,
    url: item.url ?? hnItemUrl(item.id),
    sourceUrl: hnItemUrl(item.id),
    author: item.by,
    score: item.score,
    comments: item.descendants,
    publishedAt: item.time ? new Date(item.time * 1000).toISOString() : undefined,
  };
}

async function fetchHnFeed(feed: HnFeed, limit: number, signal?: AbortSignal): Promise<NewsEntry[]> {
  const ids = await fetchHnJson<number[]>(`/${hnFeedToEndpoint(feed)}.json`, signal);
  const items = await Promise.all(ids.slice(0, limit).map((id) => fetchHnItem(id, signal)));
  return items.filter((item): item is HnItem => !!item).map((item) => summarizeHnStory(item, feed));
}

async function fetchSocketFeed(limit: number, signal?: AbortSignal): Promise<NewsEntry[]> {
  const feed = await fetchUrlJson<SocketJsonFeed>(SOCKET_FEED_URL, signal);
  return (feed.items ?? []).slice(0, limit).map((item) => ({
    source: "socket" as const,
    id: item.id,
    title: item.title ?? item.id ?? "Untitled Socket blog post",
    url: item.url ?? item.external_url ?? item.id ?? "https://socket.dev/blog",
    sourceUrl: item.url ?? item.external_url ?? item.id,
    author: item.author?.name ?? item.authors?.map((author) => author.name).filter(Boolean).join(", "),
    publishedAt: item.date_published ?? item.date_modified,
    summary: item.summary ?? htmlToText(item.content_html)?.slice(0, 280) ?? item.content_text?.slice(0, 280),
  }));
}

function textFromDailyDevPost(value: string | null | undefined, html?: string | null): string | undefined {
  return value?.trim() || htmlToText(html ?? undefined);
}

function mapDailyDevPosts(posts: DailyDevPost[], limit: number, feedLabel?: string): NewsEntry[] {
  return posts.slice(0, limit).map((post) => {
    const linkedPost = post.sharedPost ?? post;
    const tagSummary = post.tags?.slice(0, 5).map((tag) => `#${tag}`).join(" ");
    const stateSummary = [
      post.readTime ? `${post.readTime} min read` : "",
      post.bookmarked ? "bookmarked" : "",
      post.read ? "read" : "",
      post.upvoted || (post.userState?.vote ?? 0) > 0 ? "upvoted" : "",
      tagSummary,
    ].filter(Boolean).join(" · ");
    const title = textFromDailyDevPost(post.title, post.titleHtml)
      ?? textFromDailyDevPost(linkedPost.title, linkedPost.titleHtml)
      ?? textFromDailyDevPost(post.content, post.contentHtml)
      ?? textFromDailyDevPost(linkedPost.content, linkedPost.contentHtml)
      ?? post.id
      ?? linkedPost.id
      ?? "Untitled daily.dev post";
    const summary = post.summary
      ?? linkedPost.summary
      ?? textFromDailyDevPost(post.content, post.contentHtml)
      ?? textFromDailyDevPost(linkedPost.content, linkedPost.contentHtml)
      ?? (stateSummary || undefined);

    return {
      source: "dailydev" as const,
      id: post.id,
      title,
      url: linkedPost.url ?? post.url ?? post.commentsPermalink ?? post.permalink ?? (post.id ? `https://app.daily.dev/posts/${post.id}` : "https://app.daily.dev/"),
      sourceUrl: post.commentsPermalink ?? post.permalink,
      author: post.author?.name ?? post.author?.username ?? post.source?.name ?? post.source?.handle,
      score: post.numUpvotes,
      comments: post.numComments,
      publishedAt: post.publishedAt ?? post.createdAt,
      summary,
      feed: feedLabel ?? (post.bookmarked || post.read || post.upvoted || post.userState ? "daily.dev/session" : undefined),
    };
  });
}

function normalizeAuthorizationHeader(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function buildDailyDevSessionHeaders(): Record<string, string> {
  const cookie = resolveEnvValue(DAILY_DEV_COOKIE_ENV).value?.trim();
  const authorization = normalizeAuthorizationHeader(resolveEnvValue(DAILY_DEV_AUTHORIZATION_ENV).value);
  return {
    ...(cookie ? { cookie } : {}),
    ...(authorization ? { authorization } : {}),
  };
}

function hasDailyDevSessionAuth(): boolean {
  const headers = buildDailyDevSessionHeaders();
  return Boolean(headers.cookie || headers.authorization);
}

async function fetchDailyDevRestFeed(limit: number, token: string, signal?: AbortSignal): Promise<NewsEntry[]> {
  const url = `${DAILY_DEV_BASE_URL}/feeds/popular?limit=${encodeURIComponent(String(limit))}`;
  const response = await fetch(url, {
    signal,
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": "pi-news-feed/0.1 (+https://daily.dev)",
    },
  });
  if (!response.ok) throw new Error(`daily.dev API ${response.status} for /feeds/popular`);

  const feed = (await response.json()) as DailyDevFeedResponse;
  return mapDailyDevPosts(feed.data ?? [], limit);
}

async function fetchDailyDevGraphqlFeed(limit: number, signal?: AbortSignal): Promise<NewsEntry[]> {
  // Best-effort unauthenticated fallback. This is daily.dev's internal GraphQL API,
  // not the supported Plus Public API, so the query may break if daily.dev changes it.
  const query = `
    query NewsFeedDailyDevFallback($pageSize: Int!, $latest: String!) {
      latest(params: { pageSize: $pageSize, page: 0, sortBy: "popularity", latest: $latest }) {
        id
        title
        url
        createdAt
        source { name handle }
        numUpvotes
        numComments
      }
    }
  `;
  const response = await fetch("https://api.daily.dev/graphql", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "user-agent": "pi-news-feed/0.1 (+https://daily.dev)",
    },
    body: JSON.stringify({
      query,
      variables: { pageSize: limit, latest: new Date().toISOString() },
    }),
  });
  if (!response.ok) throw new Error(`daily.dev GraphQL ${response.status} for latest feed`);

  const payload = (await response.json()) as DailyDevGraphqlResponse;
  if (payload.errors?.length) {
    throw new Error(`daily.dev GraphQL error: ${payload.errors.map((error) => error.message ?? "unknown").join("; ")}`);
  }
  return mapDailyDevPosts(payload.data?.latest ?? [], limit);
}

function dailyDevPostSelection(): string {
  return `
    edges {
      node {
        id
        title
        titleHtml
        url
        publishedAt
        createdAt
        image
        summary
        content
        contentHtml
        type
        readTime
        commentsPermalink
        permalink
        source { id name handle image }
        tags
        numUpvotes
        numComments
        author { name username }
        bookmarked
        read
        upvoted
        userState { vote }
        sharedPost {
          id
          title
          titleHtml
          url
          summary
          content
          contentHtml
          commentsPermalink
          permalink
          source { id name handle image }
        }
      }
    }
  `;
}

async function fetchDailyDevGraphqlSessionFeed(limit: number, rank: DailyDevRank = DEFAULT_DAILY_DEV_RANK, signal?: AbortSignal): Promise<NewsEntry[]> {
  // Advanced opt-in path for mimicking the authenticated web app feed. This uses
  // daily.dev's internal GraphQL API and can break if private operations change.
  // recent uses TIME ranking; upvoted uses daily.dev's "most upvoted in the past
  // 7 days" feed instead of POPULARITY, which can surface stale onboarding posts.
  const query = rank === "upvoted"
    ? `
      query NewsFeedDailyDevMostUpvoted($first: Int!, $supportedTypes: [String!]) {
        mostUpvotedFeed(first: $first, period: 7, supportedTypes: $supportedTypes) {
          ${dailyDevPostSelection()}
        }
      }
    `
    : `
      query NewsFeedDailyDevSession($first: Int!, $now: DateTime!) {
        feed(first: $first, now: $now, ranking: TIME) {
          ${dailyDevPostSelection()}
        }
      }
    `;
  const response = await fetch("https://api.daily.dev/graphql", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "user-agent": "pi-news-feed/0.1 (+https://daily.dev)",
      ...buildDailyDevSessionHeaders(),
    },
    body: JSON.stringify({
      query,
      variables: rank === "upvoted" ? { first: limit, supportedTypes: [...DAILY_DEV_SUPPORTED_TYPES] } : { first: limit, now: new Date().toISOString() },
    }),
  });
  if (!response.ok) throw new Error(`daily.dev authenticated GraphQL ${response.status} for ${rank} feed`);

  const payload = (await response.json()) as DailyDevGraphqlResponse;
  if (payload.errors?.length) {
    throw new Error(`daily.dev authenticated GraphQL error: ${payload.errors.map((error) => error.message ?? "unknown").join("; ")}`);
  }
  const connection = rank === "upvoted" ? payload.data?.mostUpvotedFeed : payload.data?.feed;
  const entries = mapDailyDevPosts(connection?.edges?.map((edge) => edge.node).filter((post): post is DailyDevPost => Boolean(post)) ?? [], limit, `daily.dev/session/${rank}`);
  return rank === "upvoted"
    ? entries.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"))
    : entries.sort((a, b) => Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"));
}

async function fetchDailyDevFeed(limit: number, rank: DailyDevRank = DEFAULT_DAILY_DEV_RANK, signal?: AbortSignal): Promise<NewsEntry[]> {
  if (hasDailyDevSessionAuth()) return fetchDailyDevGraphqlSessionFeed(limit, rank, signal);
  if (rank === "upvoted") return fetchDailyDevGraphqlSessionFeed(limit, rank, signal);
  const token = resolveEnvValue(DAILY_DEV_TOKEN_ENV).value;
  if (token) return fetchDailyDevRestFeed(limit, token, signal);
  return fetchDailyDevGraphqlFeed(limit, signal);
}

function buildRedditCookieHeader(): string {
  return [
    resolveEnvValue(REDDIT_SESSION_ENV).value ? `reddit_session=${resolveEnvValue(REDDIT_SESSION_ENV).value}` : "",
    resolveEnvValue(REDDIT_TOKEN_V2_ENV).value ? `token_v2=${resolveEnvValue(REDDIT_TOKEN_V2_ENV).value}` : "",
  ].filter(Boolean).join("; ");
}

function normalizeSubreddits(input: unknown): string[] {
  const raw = Array.isArray(input) && input.length > 0 ? input : [...DEFAULT_REDDIT_SUBREDDITS];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const sub = item.trim().replace(/^r\//i, "");
    if (!/^[A-Za-z0-9_]{2,21}$/.test(sub)) continue;
    const key = sub.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(sub);
  }
  return normalized.slice(0, 20);
}

async function fetchRedditJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const cookies = buildRedditCookieHeader();
  const response = await fetch(url, {
    signal,
    headers: {
      accept: "application/json",
      "user-agent": REDDIT_USER_AGENT,
      ...(cookies ? { cookie: cookies } : {}),
    },
  });
  if (!response.ok) throw new Error(`Reddit HTTP ${response.status} for ${url}`);
  return (await response.json()) as T;
}

async function fetchRedditSubredditFeed(subreddit: string, limit: number, sort: RedditSort, signal?: AbortSignal): Promise<NewsEntry[]> {
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.json?limit=${encodeURIComponent(String(limit))}`;
  const data = await fetchRedditJson<RedditListingResponse>(url, signal);
  if (data.error) throw new Error(`Reddit error for r/${subreddit}: ${data.error}${data.message ? ` - ${data.message}` : ""}`);

  return (data.data?.children ?? [])
    .map((child): NewsEntry | undefined => {
      const post = child.data;
      if (!post?.title || post.stickied) return undefined;
      const permalink = post.permalink ? `https://reddit.com${post.permalink}` : `https://www.reddit.com/r/${subreddit}`;
      return {
        source: "reddit",
        feed: `r/${post.subreddit ?? subreddit}/${sort}`,
        id: post.id,
        title: post.title,
        url: post.url || permalink,
        sourceUrl: permalink,
        author: post.author ? `u/${post.author}` : undefined,
        score: post.score,
        comments: post.num_comments,
        publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined,
        summary: post.selftext ? post.selftext.replace(/\s+/g, " ").trim().slice(0, 280) : undefined,
      };
    })
    .filter((entry): entry is NewsEntry => Boolean(entry));
}

async function fetchRedditFeed(limit: number, subredditsInput?: unknown, sort: RedditSort = "hot", signal?: AbortSignal): Promise<NewsEntry[]> {
  const subreddits = normalizeSubreddits(subredditsInput);
  if (subreddits.length === 0) return [];
  const limitPerSubreddit = Math.max(1, Math.ceil(limit / subreddits.length));
  const results = await Promise.allSettled(subreddits.map((subreddit) => fetchRedditSubredditFeed(subreddit, limitPerSubreddit, sort, signal)));
  const entries: NewsEntry[] = [];
  const failures: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") entries.push(...result.value);
    else failures.push(`r/${subreddits[i]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  }
  if (entries.length === 0 && failures.length > 0) throw new Error(`Reddit fetch failed: ${failures.join("; ")}`);
  return entries.sort((a, b) => Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0")).slice(0, limit);
}

function normalizeTwitterHandle(handle: string): string | undefined {
  const normalized = handle.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(normalized) ? normalized : undefined;
}

function normalizeTwitterAccounts(input?: unknown): string[] {
  const fromInput = Array.isArray(input) ? input : [];
  const fromEnv = resolveEnvValue(NITTER_ACCOUNTS_ENV).value?.split(",") ?? [];
  const raw = fromInput.length > 0 ? fromInput : fromEnv.length > 0 ? fromEnv : [...DEFAULT_TWITTER_ACCOUNTS];
  const seen = new Set<string>();
  const accounts: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const account = normalizeTwitterHandle(item);
    if (!account) continue;
    const key = account.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push(account);
  }
  return accounts.slice(0, 25);
}

function buildTwitterQuery(query?: string, accountsInput?: unknown): string {
  const explicit = query?.trim();
  if (explicit) return explicit;
  const accounts = normalizeTwitterAccounts(accountsInput);
  if (accounts.length > 0) return `(${accounts.map((account) => `from:${account}`).join(" OR ")}) -is:retweet`;
  return `(AI OR LLM OR cybersecurity OR programming OR opensource OR "open source") -is:retweet lang:en`;
}

function sortTwitterEntries(entries: NewsEntry[], rankMode: TwitterRank): NewsEntry[] {
  if (rankMode === "recent") return [...entries].sort((a, b) => Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"));
  return [...entries].sort((a, b) => {
    const popDelta = popularityRank(b) - popularityRank(a);
    if (popDelta !== 0) return popDelta;
    return Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0");
  });
}

async function fetchXRecentSearch(limit: number, query: string, rankMode: TwitterRank, signal?: AbortSignal): Promise<NewsEntry[]> {
  const token = resolveEnvValue(X_BEARER_TOKEN_ENV).value;
  if (!token) throw new Error(`${X_BEARER_TOKEN_ENV} is not configured`);

  const sampleSize = Math.max(10, Math.min(100, rankMode === "engagement" ? Math.max(limit * 5, limit) : limit));
  const params = new URLSearchParams({
    query,
    max_results: String(sampleSize),
    "tweet.fields": "created_at,public_metrics,author_id",
    expansions: "author_id",
    "user.fields": "username,name",
  });
  const response = await fetch(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
    signal,
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": "pi-news-feed/0.1 (+https://x.com)",
    },
  });
  if (!response.ok) throw new Error(`X API HTTP ${response.status} for recent search`);

  const payload = (await response.json()) as XRecentSearchResponse;
  if (payload.errors?.length && !payload.data?.length) {
    throw new Error(`X API error: ${payload.errors.map((error) => error.detail ?? error.title ?? "unknown").join("; ")}`);
  }
  const users = new Map((payload.includes?.users ?? []).map((user) => [user.id, user]));
  const mapped = (payload.data ?? []).map((tweet) => {
    const user = tweet.author_id ? users.get(tweet.author_id) : undefined;
    const username = user?.username;
    const text = tweet.text?.replace(/\s+/g, " ").trim() || `Tweet ${tweet.id}`;
    const metrics = tweet.public_metrics;
    return {
      source: "twitter" as const,
      feed: query,
      id: tweet.id,
      title: truncateText(text, 140) ?? text,
      url: username ? `https://x.com/${username}/status/${tweet.id}` : `https://x.com/i/web/status/${tweet.id}`,
      author: username ? `@${username}` : user?.name,
      score: (metrics?.like_count ?? 0) + (metrics?.retweet_count ?? 0) + (metrics?.quote_count ?? 0),
      comments: metrics?.reply_count,
      publishedAt: tweet.created_at,
      summary: text,
    };
  });
  return sortTwitterEntries(mapped, rankMode).slice(0, limit);
}

function parseRssItems(xml: string): RssItem[] {
  const channelTitle = getXmlTag(xml, "title") ?? "";
  if (/not yet whitelist|not yet whitelisted|forbidden|blocked/i.test(channelTitle)) return [];

  return [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].flatMap((match) => {
    const block = match[0];
    const title = getXmlTag(block, "title");
    const description = htmlToText(getXmlTag(block, "description"));
    const summary = `${title ?? ""} ${description ?? ""}`;
    if (/not yet whitelist|not yet whitelisted|plain request with just the id|forbidden|blocked/i.test(summary)) return [];
    return [{
      title,
      link: getXmlTag(block, "link"),
      pubDate: getXmlTag(block, "pubDate"),
      creator: getXmlTag(block, "dc:creator") ?? getXmlTag(block, "author"),
      description,
    }];
  });
}

function getNitterBaseUrl(): string | undefined {
  const baseUrl = (resolveEnvValue(NITTER_BASE_URL_ENV).value?.trim() || DEFAULT_NITTER_BASE_URL).replace(/\/+$/, "");
  if (!baseUrl) return undefined;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

async function fetchNitterAccountFeed(account: string, limit: number, baseUrl: string, signal?: AbortSignal): Promise<NewsEntry[]> {
  const url = `${baseUrl}/${encodeURIComponent(account)}/rss`;
  const response = await fetch(url, {
    signal,
    headers: {
      accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      "user-agent": NITTER_RSS_USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`Nitter HTTP ${response.status} for @${account}`);
  const items = parseRssItems(await response.text());
  return items.slice(0, limit).map((item) => {
    const link = item.link || `${baseUrl}/${account}`;
    const xLink = link.replace(/^https?:\/\/[^/]+\//, `https://x.com/`);
    const summary = item.description || item.title || `@${account} post`;
    return {
      source: "twitter" as const,
      feed: `nitter:@${account}`,
      title: truncateText(summary, 140) ?? summary,
      url: xLink,
      sourceUrl: link,
      author: item.creator || `@${account}`,
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
      summary,
    };
  });
}

async function fetchNitterFeed(limit: number, accountsInput?: unknown, signal?: AbortSignal): Promise<NewsEntry[]> {
  const baseUrl = getNitterBaseUrl();
  if (!baseUrl) throw new Error(`${NITTER_BASE_URL_ENV} is not configured`);
  const accounts = normalizeTwitterAccounts(accountsInput);
  if (accounts.length === 0) throw new Error(`${NITTER_ACCOUNTS_ENV}, twitterAccounts, or built-in default accounts are required for Nitter fallback`);
  const limitPerAccount = Math.max(1, Math.ceil(limit / accounts.length));
  const results = await Promise.allSettled(accounts.map((account) => fetchNitterAccountFeed(account, limitPerAccount, baseUrl, signal)));
  const entries = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (entries.length === 0) {
    const failures = results.map((result, index) => result.status === "rejected" ? `@${accounts[index]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}` : undefined).filter(Boolean);
    throw new Error(`Nitter fallback failed: ${failures.join("; ")}`);
  }
  return entries.sort((a, b) => Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0")).slice(0, limit);
}

async function fetchTwitterFeed(limit: number, query?: string, accountsInput?: unknown, signal?: AbortSignal, rankMode: TwitterRank = "engagement"): Promise<NewsEntry[]> {
  const searchQuery = buildTwitterQuery(query, accountsInput);
  try {
    return await fetchXRecentSearch(limit, searchQuery, rankMode, signal);
  } catch (error) {
    const fallbackEntries = await fetchNitterFeed(limit, accountsInput, signal);
    return fallbackEntries.map((entry) => ({
      ...entry,
      summary: `${entry.summary ?? ""}${entry.summary ? " " : ""}(X API fallback: ${error instanceof Error ? error.message : String(error)})`,
    }));
  }
}

function sourceLabel(source: NewsEntry["source"]): string {
  if (source === "hackernews") return "🟧 Hacker News";
  if (source === "socket") return "🛡️ Socket.dev Blog";
  if (source === "dailydev") return "🟦 daily.dev";
  if (source === "reddit") return "🟥 Reddit";
  if (source === "twitter") return "𝕏 Twitter/X";
  if (source === "vuln") return "🚨 CVE Intelligence";
  return source;
}

function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function truncateAtSentence(value: string | undefined, minLength: number, softMaxLength: number, overflowLength = 0): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= softMaxLength) return normalized;

  const searchFrom = Math.min(minLength, normalized.length);
  const hardMaxLength = Math.min(normalized.length, softMaxLength + Math.max(0, overflowLength));
  const sentenceBoundary = /[.!?](?:["')\]]+)?(?:\s|$)/g;
  sentenceBoundary.lastIndex = searchFrom;
  let match: RegExpExecArray | null;
  while ((match = sentenceBoundary.exec(normalized)) !== null) {
    const end = match.index + match[0].trimEnd().length;
    if (end <= hardMaxLength) return normalized.slice(0, end).trim();
    break;
  }

  const lastClearBreak = Math.max(
    normalized.lastIndexOf(";", hardMaxLength),
    normalized.lastIndexOf(":", hardMaxLength),
    normalized.lastIndexOf(" — ", hardMaxLength),
    normalized.lastIndexOf(" – ", hardMaxLength),
  );
  if (lastClearBreak >= minLength) return `${normalized.slice(0, lastClearBreak).trimEnd()}…`;

  const lastWordBreak = normalized.lastIndexOf(" ", hardMaxLength);
  if (lastWordBreak >= minLength) return `${normalized.slice(0, lastWordBreak).trimEnd()}…`;

  return `${normalized.slice(0, Math.max(0, softMaxLength - 1)).trimEnd()}…`;
}

function formatEntry(entry: NewsEntry, index: number): string {
  const badges = [
    entry.feed ? `[${entry.feed}]` : undefined,
    entry.score === undefined ? undefined : `▲ ${entry.score}`,
    entry.comments === undefined ? undefined : `💬 ${entry.comments}`,
    entry.author ? `👤 ${entry.author}` : undefined,
    formatDate(entry.publishedAt) ? `🕒 ${formatDate(entry.publishedAt)}` : undefined,
  ].filter(Boolean).join("  ");
  const title = truncateAtSentence(entry.title, 120, 180);
  const summary = truncateAtSentence(entry.summary, 180, 300, 180);
  return [
    ` ${String(index + 1).padStart(2, " ")}. ${title}`,
    badges ? `     ${badges}` : undefined,
    `     🔗 ${entry.url}`,
    entry.sourceUrl && entry.sourceUrl !== entry.url ? `     🧭 ${entry.sourceUrl}` : undefined,
    summary ? `     📝 ${summary}` : undefined,
  ].filter(Boolean).join("\n");
}

function popularityRank(entry: NewsEntry): number {
  // Prefer explicit popularity signals when the source exposes them.
  // HN has score + comments; Socket's JSON feed currently has no popularity metric.
  if (entry.score !== undefined || entry.comments !== undefined) {
    return (entry.score ?? 0) * 1000 + (entry.comments ?? 0);
  }
  return Number.NEGATIVE_INFINITY;
}

function sortEntriesForDisplay(entries: NewsEntry[]): NewsEntry[] {
  return [...entries].sort((a, b) => {
    const popularityDelta = popularityRank(b) - popularityRank(a);
    if (popularityDelta !== 0) return popularityDelta;
    return Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0");
  });
}

function formatSection(sourceName: ConcreteNewsSource, entries: NewsEntry[]): string {
  const sortedEntries = sortEntriesForDisplay(entries);
  const label = sourceLabel(sourceName);
  const headerText = `${label} (${entries.length})`;
  const rule = "═".repeat(Math.max(24, headerText.length + 2));
  return [`╔${rule}╗`, `║ ${headerText.padEnd(rule.length - 1)}║`, `╚${rule}╝`, "", ...sortedEntries.map(formatEntry)].join("\n");
}

function formatNews(source: NewsSource, entries: NewsEntry[]): string {
  if (entries.length === 0) return `No ${source} news entries found.`;

  const sourceOrder = source === "all" ? CONCRETE_NEWS_SOURCES : CONCRETE_NEWS_SOURCES.filter((sourceName) => sourceName === source);
  const sections = sourceOrder.flatMap((sourceName) => {
    const sourceEntries = entries.filter((entry) => entry.source === sourceName);
    if (sourceEntries.length === 0) return [];
    return [formatSection(sourceName, sourceEntries)];
  });

  const total = entries.length;
  const title = source === "all" ? `🗞️  News Feed — ${total} stories across ${sections.length} sources` : `🗞️  News Feed — ${sourceLabel(source)} — ${total} stories`;
  return `${title}\n\n${sections.join("\n\n")}`;
}

function safeFilenamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "news";
}

function saveNewsOutput(kind: "general" | "security", content: string, label: string): string {
  const dir = kind === "security" ? NEWS_SECURITY_DIR : NEWS_GENERAL_DIR;
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${timestamp}-${safeFilenamePart(label)}.md`);
  writeFileSync(path, `${content.trimEnd()}\n`, "utf8");
  return path;
}

function sendNewsMessage(pi: ExtensionAPI, content: string, entries: NewsEntry[], source: NewsSource = "all"): void {
  pi.sendMessage({
    customType: NEWS_MESSAGE_TYPE,
    content,
    display: true,
    details: { source, entries, generatedAt: Date.now() } satisfies NewsMessageDetails,
  });
}

function sendNewsMessageOnce(pi: ExtensionAPI, key: string, content: string, entries: NewsEntry[], source: NewsSource = "all"): boolean {
  if (shownNewsOutputs.has(key)) return false;
  shownNewsOutputs.add(key);
  sendNewsMessage(pi, content, entries, source);
  return true;
}

function parseNewsArgs(args: string): ParsedNewsArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const source = NEWS_SOURCES.includes(tokens[0] as NewsSource) ? (tokens.shift() as NewsSource) : "all";
  const limitTokenIndex = tokens.findIndex((token) => /^\d+$/.test(token));
  const limitInput = limitTokenIndex >= 0 ? Number(tokens.splice(limitTokenIndex, 1)[0]) : undefined;
  const feed = HN_FEEDS.includes(tokens[0] as HnFeed) ? (tokens.shift() as HnFeed) : "top";
  const redditSortToken = tokens.find((token) => ["hot", "new", "top", "rising"].includes(token));
  const redditSort = (redditSortToken ?? "hot") as RedditSort;
  const subredditsToken = tokens.find((token) => token.startsWith("subreddits="));
  const subreddits = subredditsToken ? subredditsToken.slice("subreddits=".length).split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const twitterAccountsToken = tokens.find((token) => token.startsWith("twitterAccounts=") || token.startsWith("accounts="));
  const twitterAccounts = twitterAccountsToken ? twitterAccountsToken.slice(twitterAccountsToken.indexOf("=") + 1).split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const twitterQueryIndex = tokens.findIndex((token) => token.startsWith("twitterQuery=") || token.startsWith("query="));
  const twitterQueryToken = twitterQueryIndex >= 0 ? tokens.slice(twitterQueryIndex).join(" ") : undefined;
  const twitterQuery = twitterQueryToken ? twitterQueryToken.slice(twitterQueryToken.indexOf("=") + 1) : undefined;
  const twitterRankToken = tokens.find((token) => token === "engagement" || token === "recent");
  const twitterRank = (twitterRankToken ?? "engagement") as TwitterRank;
  const dailyDevRankToken = tokens.find((token) => token === "upvoted" || token === "popular" || token === "recent");
  const dailyDevRank = (dailyDevRankToken === "recent" ? "recent" : DEFAULT_DAILY_DEV_RANK) as DailyDevRank;
  const limit = clampInteger(limitInput, DEFAULT_LIMIT, 1, MAX_LIMIT);
  return { source, feed, limit, redditSort, subreddits, twitterQuery, twitterAccounts, twitterRank, dailyDevRank };
}

function parseSecurityNewsArgs(args: string): ParsedSecurityNewsArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const limitToken = tokens.find((token) => /^\d+$/.test(token));
  const sortToken = tokens.find((token) => ["hot", "new", "top", "rising"].includes(token));
  return { limit: clampInteger(limitToken ? Number(limitToken) : 20, 20, 1, MAX_LIMIT), redditSort: (sortToken ?? "hot") as RedditSort };
}

function newsSessionKey(parsed: ParsedNewsArgs): string {
  return `news:${JSON.stringify(parsed)}`;
}

function securityNewsSessionKey(parsed: ParsedSecurityNewsArgs): string {
  return `security:${parsed.limit}:${parsed.redditSort}`;
}

function getEnabledNewsSources(): ConcreteNewsSource[] {
  return [...CONCRETE_NEWS_SOURCES];
}

function newsSourceProgressLabel(source: ConcreteNewsSource): string {
  if (source === "hackernews") return "Fetching Hacker News…";
  if (source === "socket") return "Fetching Socket.dev supply-chain news…";
  if (source === "dailydev") return "Fetching daily.dev…";
  if (source === "reddit") return "Fetching Reddit feeds…";
  return "Fetching X/Twitter feeds…";
}

async function withWorkingMessage<T>(ctx: any, message: string, run: (update: (message: string) => void) => Promise<T>): Promise<T> {
  return withExtensionWorkingIndicator(ctx, message, async (indicator: ExtensionWorkingIndicator) => run((nextMessage) => indicator.update(nextMessage)), {
    id: "tech-news-working",
    title: "Working",
    placement: "aboveEditor",
  });
}

async function fetchConcreteNewsFeed(source: ConcreteNewsSource, hnFeed: HnFeed, limit: number, redditSubreddits?: unknown, redditSort: RedditSort = "hot", signal?: AbortSignal, twitterQuery?: string, twitterAccounts?: unknown, twitterRank: TwitterRank = "engagement", dailyDevRank: DailyDevRank = DEFAULT_DAILY_DEV_RANK, onProgress?: (message: string) => void): Promise<NewsEntry[]> {
  onProgress?.(newsSourceProgressLabel(source));
  if (source === "hackernews") return fetchHnFeed(hnFeed, limit, signal);
  if (source === "socket") return fetchSocketFeed(limit, signal);
  if (source === "dailydev") return fetchDailyDevFeed(limit, dailyDevRank, signal);
  if (source === "reddit") return fetchRedditFeed(limit, redditSubreddits, redditSort, signal);
  return fetchTwitterFeed(limit, twitterQuery, twitterAccounts, signal, twitterRank);
}

function perSourceLimit(totalLimit: number, sourceCount: number): number {
  return Math.max(1, Math.floor(totalLimit / Math.max(1, sourceCount)));
}

async function fetchNewsFeed(source: NewsSource, hnFeed: HnFeed, limit: number, redditSubreddits?: unknown, redditSort: RedditSort = "hot", signal?: AbortSignal, twitterQuery?: string, twitterAccounts?: unknown, twitterRank: TwitterRank = "engagement", dailyDevRank: DailyDevRank = DEFAULT_DAILY_DEV_RANK, onProgress?: (message: string) => void): Promise<NewsEntry[]> {
  if (source !== "all") return fetchConcreteNewsFeed(source, hnFeed, limit, redditSubreddits, redditSort, signal, twitterQuery, twitterAccounts, twitterRank, dailyDevRank, onProgress);

  const enabledSources = getEnabledNewsSources();
  const limitPerSource = perSourceLimit(limit, enabledSources.length);
  onProgress?.(`Fetching ${enabledSources.length} news sources…`);
  const results = await Promise.allSettled(
    enabledSources.map((sourceName) => fetchConcreteNewsFeed(sourceName, hnFeed, limitPerSource, redditSubreddits, redditSort, signal, twitterQuery, twitterAccounts, twitterRank, dailyDevRank, onProgress)),
  );
  const entries = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  return entries
    .sort((a, b) => Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"))
    .slice(0, limit);
}

function cveIdFromText(value: string | undefined): string | undefined {
  return value?.match(/CVE-\d{4}-\d{4,}/i)?.[0]?.toUpperCase();
}

function nvdSeverityAndScore(cve: NonNullable<NonNullable<NvdResponse["vulnerabilities"]>[number]["cve"]>): { severity?: "CRITICAL" | "HIGH"; score?: number } {
  const metric = cve.metrics?.cvssMetricV31?.[0] ?? cve.metrics?.cvssMetricV30?.[0] ?? cve.metrics?.cvssMetricV2?.[0];
  const metricAny = metric as { baseSeverity?: string; cvssData?: { baseSeverity?: string; baseScore?: number } } | undefined;
  const severity = (metricAny?.cvssData?.baseSeverity ?? metricAny?.baseSeverity)?.toUpperCase();
  return { severity: severity === "CRITICAL" || severity === "HIGH" ? severity : undefined, score: metricAny?.cvssData?.baseScore };
}

function isConfirmedCveStatus(status: string | undefined): boolean {
  return !status || !["REJECTED", "DENIED", "RESERVED"].includes(status.toUpperCase());
}

function parseCpeAffected(criteria: string | undefined): string | undefined {
  if (!criteria) return undefined;
  const parts = criteria.split(":");
  const vendor = parts[3]?.replace(/_/g, " ");
  const product = parts[4]?.replace(/_/g, " ");
  const version = parts[5] && !["*", "-"].includes(parts[5]) ? ` ${parts[5]}` : "";
  if (!vendor || !product) return undefined;
  return `${vendor} ${product}${version}`;
}

function uniqueLimited(values: Array<string | undefined>, limit = 4): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))].slice(0, limit);
}

function mergeVulnerability(map: Map<string, VulnerabilityEntry>, patch: Partial<VulnerabilityEntry> & { cve: string; sourceName: string }) {
  const current = map.get(patch.cve);
  const sources = new Set([...(current?.sources ?? []), patch.sourceName]);
  const affected = uniqueLimited([...(current?.affected ?? []), ...(patch.affected ?? [])], 6);
  map.set(patch.cve, {
    source: "vuln",
    id: patch.cve,
    cve: patch.cve,
    title: patch.title ?? current?.title ?? patch.cve,
    url: patch.url ?? current?.url ?? `https://nvd.nist.gov/vuln/detail/${patch.cve}`,
    publishedAt: patch.publishedAt ?? current?.publishedAt,
    summary: patch.summary ?? current?.summary,
    feed: [...sources].join(", "),
    severity: patch.severity ?? current?.severity,
    cvss: Math.max(patch.cvss ?? 0, current?.cvss ?? 0) || undefined,
    epss: patch.epss ?? current?.epss,
    sourceCount: sources.size,
    sources: [...sources].sort(),
    affected,
    status: patch.status ?? current?.status,
    fixed: patch.fixed ?? current?.fixed,
  });
}

async function fetchNvdCriticalHigh(limit: number, signal?: AbortSignal): Promise<VulnerabilityEntry[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000);
  const url = `${NVD_CVE_API_URL}?pubStartDate=${encodeURIComponent(start.toISOString())}&pubEndDate=${encodeURIComponent(end.toISOString())}&resultsPerPage=${Math.min(200, Math.max(50, limit * 4))}`;
  const data = await fetchUrlJson<NvdResponse>(url, signal);
  const map = new Map<string, VulnerabilityEntry>();
  for (const item of data.vulnerabilities ?? []) {
    const cve = item.cve;
    if (!cve?.id || !isConfirmedCveStatus(cve.vulnStatus)) continue;
    const { severity, score } = nvdSeverityAndScore(cve);
    if (!severity) continue;
    const affected = uniqueLimited(cve.configurations?.flatMap((configuration) => configuration.nodes?.flatMap((node) => node.cpeMatch?.filter((match) => match.vulnerable !== false).map((match) => parseCpeAffected(match.criteria)) ?? []) ?? []) ?? []);
    mergeVulnerability(map, {
      sourceName: "nvd",
      cve: cve.id,
      title: `${cve.id} — ${severity}${score ? ` ${score}` : ""}`,
      url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
      publishedAt: cve.published,
      summary: cve.descriptions?.find((d) => d.lang === "en")?.value,
      severity,
      cvss: score,
      affected,
      status: cve.vulnStatus,
    });
  }
  return [...map.values()];
}

async function enrichSecurityVulns(entries: VulnerabilityEntry[], signal?: AbortSignal): Promise<VulnerabilityEntry[]> {
  const map = new Map(entries.map((entry) => [entry.cve, entry]));
  const [kev, githubCritical, githubHigh, epssRecords, osvRecords, cveStatuses] = await Promise.allSettled([
    fetchUrlJson<CisaKevResponse>(CISA_KEV_JSON_URL, signal),
    fetchUrlJson<GitHubAdvisory[]>(`${GITHUB_ADVISORIES_API_URL}?severity=critical&per_page=100&sort=published&direction=desc`, signal),
    fetchUrlJson<GitHubAdvisory[]>(`${GITHUB_ADVISORIES_API_URL}?severity=high&per_page=100&sort=published&direction=desc`, signal),
    fetchUrlJson<EpssResponse>(`${FIRST_EPSS_API_URL}?cve=${encodeURIComponent(entries.map((entry) => entry.cve).join(","))}`, signal),
    Promise.all(entries.slice(0, 50).map((entry) => fetchUrlJson<OsvVulnerability>(`${OSV_API_URL}/${entry.cve}`, signal).catch(() => undefined))),
    Promise.all(entries.slice(0, 50).map((entry) => fetchUrlJson<CveRecordResponse>(`${CVE_RECORD_API_URL}/${entry.cve}`, signal).catch(() => undefined))),
  ]);

  if (kev.status === "fulfilled") {
    for (const item of kev.value.vulnerabilities ?? []) {
      const cve = item.cveID?.toUpperCase();
      const existing = cve ? map.get(cve) : undefined;
      if (!cve || !existing) continue;
      mergeVulnerability(map, { sourceName: "cisa-kev", cve, title: item.vulnerabilityName, publishedAt: item.dateAdded, summary: `${item.shortDescription ?? existing.summary ?? ""}${item.requiredAction ? ` Required action: ${item.requiredAction}` : ""}`, affected: uniqueLimited([`${item.vendorProject ?? ""} ${item.product ?? ""}`]), fixed: /update|upgrade|patch|fixed|apply/i.test(item.requiredAction ?? "") });
    }
  }

  const github = [githubCritical, githubHigh].flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (github.length > 0) {
    for (const item of github) {
      const cve = item.cve_id?.toUpperCase() ?? cveIdFromText(`${item.summary} ${item.description}`);
      const severity = item.severity?.toUpperCase();
      if (!cve || !map.has(cve) || (severity !== "CRITICAL" && severity !== "HIGH")) continue;
      const affected = uniqueLimited(item.vulnerabilities?.map((v) => `${v.package?.ecosystem ?? "package"}/${v.package?.name ?? "unknown"} ${v.vulnerable_version_range ?? ""}`) ?? []);
      mergeVulnerability(map, { sourceName: "github-advisory", cve, title: item.summary, url: item.html_url, publishedAt: item.published_at, severity: severity as "CRITICAL" | "HIGH", affected, fixed: item.vulnerabilities?.some((v) => !!v.patched_versions) });
    }
  }

  if (osvRecords.status === "fulfilled") {
    for (const item of osvRecords.value) {
      const cve = item?.aliases?.find((alias) => /^CVE-\d{4}-\d{4,}$/i.test(alias))?.toUpperCase() ?? cveIdFromText(item?.id);
      if (!cve || !map.has(cve)) continue;
      mergeVulnerability(map, { sourceName: "osv", cve, title: item?.summary, url: `https://osv.dev/vulnerability/${encodeURIComponent(item?.id ?? cve)}`, publishedAt: item?.published, summary: item?.details, affected: item?.affected?.length ? [item.id ?? cve] : undefined, fixed: item?.affected?.some((affected) => affected.ranges?.some((range) => range.events?.some((event) => !!event.fixed))) });
    }
  }

  if (epssRecords.status === "fulfilled") {
    for (const item of epssRecords.value.data ?? []) {
      const cve = item.cve?.toUpperCase();
      const epss = item.epss ? Number(item.epss) : undefined;
      if (cve && map.has(cve)) mergeVulnerability(map, { sourceName: "epss", cve, epss });
    }
  }

  if (cveStatuses.status === "fulfilled") {
    for (const item of cveStatuses.value) {
      const cve = item?.cveMetadata?.cveId?.toUpperCase();
      const state = item?.cveMetadata?.state;
      if (!cve || !map.has(cve)) continue;
      if (!isConfirmedCveStatus(state)) map.delete(cve);
      else mergeVulnerability(map, { sourceName: "cve-org", cve, status: state });
    }
  }

  return [...map.values()].sort((a, b) => {
    const sourceDelta = b.sourceCount - a.sourceCount;
    if (sourceDelta !== 0) return sourceDelta;
    const severityDelta = (b.severity === "CRITICAL" ? 1 : 0) - (a.severity === "CRITICAL" ? 1 : 0);
    if (severityDelta !== 0) return severityDelta;
    return (b.epss ?? 0) - (a.epss ?? 0) || (b.cvss ?? 0) - (a.cvss ?? 0) || Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0");
  });
}

function formatSecurityNews(entries: NewsEntry[]): string {
  if (entries.length === 0) return "No confirmed high/critical CVEs found.";
  const separator = "─".repeat(88);
  return [`🚨 Security CVE Feed`, `${entries.length} confirmed HIGH/CRITICAL CVEs · ranked by source coverage, severity, EPSS, CVSS`, "", ...entries.map((entry, index) => {
    const vuln = entry as VulnerabilityEntry;
    const severity = [vuln.severity, vuln.cvss ? `CVSS ${vuln.cvss}` : undefined, vuln.epss !== undefined ? `EPSS ${(vuln.epss * 100).toFixed(1)}%` : undefined].filter(Boolean).join(" · ");
    const state = [vuln.status ? `status: ${vuln.status}` : undefined, vuln.fixed === undefined ? undefined : vuln.fixed ? "fix/mitigation signal: yes" : "fix/mitigation signal: none found"].filter(Boolean).join(" · ");
    return [
      separator,
      `${String(index + 1).padStart(2, " ")}. ${vuln.cve}  ${severity}`,
      `    Title:    ${vuln.title.replace(/^CVE-\d{4}-\d{4,}\s+—\s+/, "")}`,
      `    Affects:  ${(vuln.affected?.length ? vuln.affected.join("; ") : "unknown / not provided by sources")}`,
      `    Sources:  ${vuln.sourceCount} (${vuln.sources.join(", ")})`,
      state ? `    State:    ${state}` : undefined,
      `    Link:     ${vuln.url}`,
      vuln.summary ? `    Summary:  ${truncateAtSentence(vuln.summary, 220, 420)}` : undefined,
    ].filter(Boolean).join("\n");
  }), separator].join("\n");
}

async function fetchSecurityNews(limit: number, redditSort: RedditSort = "hot", signal?: AbortSignal, onProgress?: (message: string) => void): Promise<NewsEntry[]> {
  onProgress?.("Fetching NVD high/critical CVEs…");
  const nvdEntries = await fetchNvdCriticalHigh(limit, signal);
  onProgress?.("Enriching CVEs with CISA KEV, CVE.org, EPSS, OSV, and GitHub Advisories…");
  const enriched = await enrichSecurityVulns(nvdEntries, signal);
  if (enriched.length > 0) return enriched.slice(0, limit);

  const redditLimit = Math.max(1, Math.ceil(limit * 0.75));
  const socketLimit = Math.max(1, limit - redditLimit);
  onProgress?.("CVE APIs returned no entries; fetching Reddit and Socket.dev fallback…");
  const [redditEntries, socketEntries] = await Promise.all([
    fetchRedditFeed(redditLimit, [...SECURITY_REDDIT_SUBREDDITS], redditSort, signal),
    fetchSocketFeed(socketLimit, signal),
  ]);
  return [...redditEntries, ...socketEntries]
    .sort((a, b) => {
      const popularityDelta = popularityRank(b) - popularityRank(a);
      if (popularityDelta !== 0 && Number.isFinite(popularityDelta)) return popularityDelta;
      return Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0");
    })
    .slice(0, limit);
}

function renderStyledNews(details: NewsMessageDetails, theme: any): Box {
  if (details.entries.some((entry) => entry.source === "vuln")) {
    const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
    box.addChild(new Text(formatSecurityNews(details.entries), 0, 0));
    return box;
  }

  const sourceOrder = details.source === "all" ? CONCRETE_NEWS_SOURCES : CONCRETE_NEWS_SOURCES.filter((sourceName) => sourceName === details.source);
  const lines: string[] = [];
  const activeSections = sourceOrder.filter((sourceName) => details.entries.some((entry) => entry.source === sourceName));
  lines.push(theme.fg("accent", theme.bold(`🗞️  News Feed — ${details.entries.length} stories across ${activeSections.length} source${activeSections.length === 1 ? "" : "s"}`)));
  lines.push(theme.fg("dim", `Generated ${formatDate(new Date(details.generatedAt).toISOString()) ?? "now"}`));

  for (const sourceName of sourceOrder) {
    const sourceEntries = sortEntriesForDisplay(details.entries.filter((entry) => entry.source === sourceName));
    if (sourceEntries.length === 0) continue;

    lines.push("");
    lines.push(theme.fg("accent", theme.bold(`━━ ${sourceLabel(sourceName)} (${sourceEntries.length}) ${"━".repeat(18)}`)));

    sourceEntries.forEach((entry, index) => {
      const badges = [
        entry.feed ? theme.fg("dim", `[${entry.feed}]`) : undefined,
        entry.score === undefined ? undefined : theme.fg("success", `▲ ${entry.score}`),
        entry.comments === undefined ? undefined : theme.fg("warning", `💬 ${entry.comments}`),
        entry.author ? theme.fg("dim", `👤 ${entry.author}`) : undefined,
        formatDate(entry.publishedAt) ? theme.fg("dim", `🕒 ${formatDate(entry.publishedAt)}`) : undefined,
      ].filter(Boolean).join("  ");
      const title = truncateAtSentence(entry.title, 120, 180);
      const summary = truncateAtSentence(entry.summary, 180, 300, 180);

      lines.push(`${theme.fg("dim", String(index + 1).padStart(2, " ") + ".")} ${theme.bold(title ?? entry.title)}`);
      if (badges) lines.push(`    ${badges}`);
      lines.push(`    ${theme.fg("accent", "🔗")} ${entry.url}`);
      if (entry.sourceUrl && entry.sourceUrl !== entry.url) lines.push(`    ${theme.fg("dim", "🧭")} ${theme.fg("dim", entry.sourceUrl)}`);
      if (summary) lines.push(`    ${theme.fg("dim", "📝")} ${summary}`);
      lines.push("");
    });
  }

  const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
  box.addChild(new Text(lines.join("\n").trimEnd(), 0, 0));
  return box;
}

const REDDIT_COOKIE_INSTRUCTIONS = `How to get Reddit cookies:
1. Open https://www.reddit.com in a browser and log in.
2. Open DevTools (F12) → Application/Storage → Cookies → https://www.reddit.com.
3. Copy the value of the 'reddit_session' cookie.
4. Optional: copy the value of the 'token_v2' cookie.
5. Treat these like passwords; they authenticate your Reddit session.`;

const DAILY_DEV_SESSION_INSTRUCTIONS = `daily.dev session GraphQL setup (advanced/fragile):
1. Open https://app.daily.dev in a browser and log in.
2. Open DevTools (F12) → Network, then refresh the daily.dev feed.
3. In the DevTools Network request list, filter for Fetch/XHR or search for graphql.
4. Select a POST request whose URL is https://api.daily.dev/graphql inside DevTools. Do not open that URL in the browser tab; opened directly it only returns {"errors":[{"message":"Unknown query"}]}.
5. With that Network request selected, open Headers → Request Headers.
6. Copy the full Cookie request header and save it as ${DAILY_DEV_COOKIE_ENV}.
7. If Request Headers includes Authorization, copy it too and save it as ${DAILY_DEV_AUTHORIZATION_ENV}.
8. Prefer ${DAILY_DEV_TOKEN_ENV} when available; session headers can expire and are private app internals.`;

const TWITTER_SETUP_INSTRUCTIONS = `Twitter/X setup:
1. Create an X developer app with API v2 Recent Search access.
2. Copy the app Bearer Token.
3. Official X API results include engagement metrics and support ranking via twitterRank=engagement|recent.
4. Optional fallback: configure a Nitter-compatible base URL and comma-separated account handles.
5. The official X API is the primary source; Nitter is used only when the API fails or no token is configured.`;

async function setupDailyDev(ctx: SetupUiContext): Promise<void> {
  const existingToken = resolveEnvValue(DAILY_DEV_TOKEN_ENV);
  const existingCookie = resolveEnvValue(DAILY_DEV_COOKIE_ENV);
  const existingAuthorization = resolveEnvValue(DAILY_DEV_AUTHORIZATION_ENV);
  const action = await ctx.ui.select("daily.dev setup", [
    existingToken.value ? "Replace API token" : "Enter API token",
    existingCookie.value || existingAuthorization.value ? "Replace session headers" : "Enter session headers",
    "Show API token URL",
    "Show session instructions",
    "Cancel",
  ]);

  if (action === "Show API token URL") {
    ctx.ui.notify("Create/manage token here: https://app.daily.dev/settings/api", "info");
    return;
  }
  if (action === "Show session instructions") {
    ctx.ui.notify(DAILY_DEV_SESSION_INSTRUCTIONS, "info");
    return;
  }
  if (action === "Enter API token" || action === "Replace API token") {
    const token = (await ctx.ui.input("daily.dev API token", existingToken.value ? "Paste replacement Personal Access Token" : "Paste your daily.dev Personal Access Token"))?.trim();
    if (!token) {
      ctx.ui.notify("News setup cancelled: no token entered.", "warning");
      return;
    }

    const filePath = getAgentEnvPath();
    upsertEnvValue(filePath, DAILY_DEV_TOKEN_ENV, token);
    process.env[DAILY_DEV_TOKEN_ENV] = token;
    ctx.ui.notify(`daily.dev API token saved to ${filePath}`, "success");
    return;
  }
  if (action === "Enter session headers" || action === "Replace session headers") {
    ctx.ui.notify(DAILY_DEV_SESSION_INSTRUCTIONS, "info");
    const cookie = (await ctx.ui.input("daily.dev Cookie header", existingCookie.value ? "Paste replacement full Cookie header" : "Paste full Cookie request header from api.daily.dev/graphql"))?.trim();
    const authorization = (await ctx.ui.input("daily.dev Authorization header (optional)", existingAuthorization.value ? "Paste replacement Authorization header or leave blank to keep unset" : "Paste Authorization header if present, or leave blank"))?.trim();
    if (!cookie && !authorization) {
      ctx.ui.notify("News setup cancelled: no session headers entered.", "warning");
      return;
    }

    const filePath = getAgentEnvPath();
    if (cookie) {
      upsertEnvValue(filePath, DAILY_DEV_COOKIE_ENV, cookie);
      process.env[DAILY_DEV_COOKIE_ENV] = cookie;
    }
    if (authorization) {
      upsertEnvValue(filePath, DAILY_DEV_AUTHORIZATION_ENV, authorization);
      process.env[DAILY_DEV_AUTHORIZATION_ENV] = authorization;
    }
    ctx.ui.notify(`daily.dev session headers saved to ${filePath}. ${DAILY_DEV_COOKIE_ENV} ${cookie ? "saved" : "left unchanged"}; ${DAILY_DEV_AUTHORIZATION_ENV} ${authorization ? "saved" : "left unchanged"}.`, "success");
    return;
  }
  ctx.ui.notify("News setup cancelled.", "warning");
}

async function setupReddit(ctx: SetupUiContext): Promise<void> {
  const existingSession = resolveEnvValue(REDDIT_SESSION_ENV);
  const existingTokenV2 = resolveEnvValue(REDDIT_TOKEN_V2_ENV);
  const action = existingSession.value
    ? await ctx.ui.select(`Reddit cookies are already configured via ${existingSession.source}.`, ["Replace cookies", "Show cookie instructions", "Cancel"])
    : await ctx.ui.select("Reddit setup", ["Enter cookies", "Show cookie instructions", "Cancel"]);

  if (action === "Show cookie instructions") {
    ctx.ui.notify(REDDIT_COOKIE_INSTRUCTIONS, "info");
    return;
  }
  if (action !== "Replace cookies" && action !== "Enter cookies") {
    ctx.ui.notify("Reddit setup cancelled.", "warning");
    return;
  }

  ctx.ui.notify(REDDIT_COOKIE_INSTRUCTIONS, "info");
  const redditSession = (await ctx.ui.input("Reddit reddit_session cookie", existingSession.value ? "Paste replacement reddit_session cookie" : "Paste reddit_session cookie value"))?.trim();
  if (!redditSession) {
    ctx.ui.notify("Reddit setup cancelled: reddit_session is required.", "warning");
    return;
  }

  const tokenV2 = (await ctx.ui.input("Reddit token_v2 cookie (optional)", existingTokenV2.value ? "Paste replacement token_v2 or leave blank to keep unset" : "Paste token_v2 cookie value, or leave blank"))?.trim();
  const filePath = getAgentEnvPath();
  upsertEnvValue(filePath, REDDIT_SESSION_ENV, redditSession);
  process.env[REDDIT_SESSION_ENV] = redditSession;
  if (tokenV2) {
    upsertEnvValue(filePath, REDDIT_TOKEN_V2_ENV, tokenV2);
    process.env[REDDIT_TOKEN_V2_ENV] = tokenV2;
  }
  ctx.ui.notify(`Reddit cookies saved to ${filePath}. ${REDDIT_TOKEN_V2_ENV} ${tokenV2 ? "saved" : "left unset"}.`, "success");
}

async function setupTwitter(ctx: SetupUiContext): Promise<void> {
  const existingToken = resolveEnvValue(X_BEARER_TOKEN_ENV);
  const existingNitter = resolveEnvValue(NITTER_BASE_URL_ENV);
  const action = await ctx.ui.select("Twitter/X setup", ["Enter X Bearer Token", "Configure Nitter fallback", "Show setup instructions", "Cancel"]);

  if (action === "Show setup instructions") {
    ctx.ui.notify(TWITTER_SETUP_INSTRUCTIONS, "info");
    return;
  }
  if (action === "Enter X Bearer Token") {
    ctx.ui.notify(TWITTER_SETUP_INSTRUCTIONS, "info");
    const token = (await ctx.ui.input("X API Bearer Token", existingToken.value ? "Paste replacement bearer token" : "Paste bearer token"))?.trim();
    if (!token) {
      ctx.ui.notify("Twitter setup cancelled: no bearer token entered.", "warning");
      return;
    }
    const filePath = getAgentEnvPath();
    upsertEnvValue(filePath, X_BEARER_TOKEN_ENV, token);
    process.env[X_BEARER_TOKEN_ENV] = token;
    ctx.ui.notify(`X Bearer Token saved to ${filePath}`, "success");
    return;
  }
  if (action === "Configure Nitter fallback") {
    const baseUrl = (await ctx.ui.input("Nitter base URL", existingNitter.value ?? DEFAULT_NITTER_BASE_URL))?.trim();
    if (!baseUrl) {
      ctx.ui.notify("Twitter setup cancelled: Nitter base URL is required.", "warning");
      return;
    }
    const accounts = (await ctx.ui.input("Twitter/X accounts for Nitter fallback", resolveEnvValue(NITTER_ACCOUNTS_ENV).value ?? DEFAULT_TWITTER_ACCOUNTS.join(",")))?.trim();
    if (!accounts) {
      ctx.ui.notify("Twitter setup cancelled: at least one account is required for Nitter fallback.", "warning");
      return;
    }
    const filePath = getAgentEnvPath();
    upsertEnvValue(filePath, NITTER_BASE_URL_ENV, baseUrl.replace(/\/+$/, ""));
    upsertEnvValue(filePath, NITTER_ACCOUNTS_ENV, accounts);
    process.env[NITTER_BASE_URL_ENV] = baseUrl.replace(/\/+$/, "");
    process.env[NITTER_ACCOUNTS_ENV] = accounts;
    ctx.ui.notify(`Nitter fallback saved to ${filePath}`, "success");
    return;
  }
  ctx.ui.notify("Twitter setup cancelled.", "warning");
}

async function runNewsSetup(ctx: SetupUiContext): Promise<void> {
  const choice = await ctx.ui.select("News setup", ["daily.dev", "Reddit cookies", "Twitter/X + Nitter", "Show Reddit cookie instructions"]);
  if (choice === "daily.dev") return setupDailyDev(ctx);
  if (choice === "Reddit cookies") return setupReddit(ctx);
  if (choice === "Twitter/X + Nitter") return setupTwitter(ctx);
  if (choice === "Show Reddit cookie instructions") {
    ctx.ui.notify(REDDIT_COOKIE_INSTRUCTIONS, "info");
    return;
  }
  ctx.ui.notify("News setup cancelled.", "warning");
}

export default function newsFeedExtension(pi: ExtensionAPI) {
  pi.registerMessageRenderer(NEWS_MESSAGE_TYPE, (message: any, _options: any, theme: any) => {
    const details = message.details as NewsMessageDetails | undefined;
    if (!details) {
      const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
      box.addChild(new Text(String(message.content ?? "No news details available."), 0, 0));
      return box;
    }
    return renderStyledNews(details, theme);
  });

  pi.registerTool({

    name: "news_feed",
    label: "News Feed",
    description: "Fetch news entries from Hacker News, Socket.dev Blog, Reddit tech subreddits, X/Twitter, and configured authenticated sources like daily.dev.",
    promptSnippet: "Fetch news from Hacker News feeds, Socket.dev blog JSON feed, Reddit tech subreddits, X/Twitter, and configured authenticated sources like daily.dev.",
    promptGuidelines: ["Use news_feed when the user asks for current Hacker News, Reddit, Socket.dev, security, supply-chain, or general news feed entries."],
    parameters: NEWS_FEED_PARAMS,
    async execute(_toolCallId: unknown, params: any, signal?: AbortSignal, onUpdate?: any, ctx?: any) {
      const source = (params.source ?? "all") as NewsSource;
      const feed = (params.feed ?? "top") as HnFeed;
      const limit = clampInteger(params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
      const redditSort = (params.redditSort ?? "hot") as RedditSort;
      const twitterRank = (params.twitterRank ?? "engagement") as TwitterRank;
      const dailyDevRank = (params.dailyDevRank ?? DEFAULT_DAILY_DEV_RANK) as DailyDevRank;
      return withWorkingMessage(ctx, "Fetching news…", async (update) => {
        const entries = await fetchNewsFeed(source, feed, limit, params.subreddits, redditSort, signal, params.twitterQuery, params.twitterAccounts, twitterRank, dailyDevRank, (message) => {
          update(message);
          onUpdate?.({ content: [{ type: "text", text: `Working… ${message}` }], isPartial: true });
        });
        update("Formatting and saving news…");
        const content = formatNews(source, entries);
        const savedPath = saveNewsOutput("general", content, `${source}-${feed}-${limit}`);
        return {
          content: [{ type: "text", text: `${content}\n\nSaved: ${savedPath}` }],
          details: { source, feed, redditSort, subreddits: normalizeSubreddits(params.subreddits), twitterQuery: params.twitterQuery, twitterAccounts: normalizeTwitterAccounts(params.twitterAccounts), twitterRank, dailyDevRank, limit, savedPath, entries },
        };
      });
    },
  });

  pi.registerTool({
    name: "news_sec",
    label: "Security News",
    description: "Fetch recent and popular security/CVE-relevant news from security Reddit subreddits and Socket.dev supply-chain posts.",
    promptSnippet: "Fetch security and CVE-relevant news from Reddit security communities and Socket.dev.",
    promptGuidelines: ["Use news_sec when the user asks for current security, CVE, vulnerability, exploit, malware, supply-chain, or incident news. Summarize the most important items and call out likely actionability for the user."],
    parameters: NEWS_SEC_PARAMS,
    async execute(_toolCallId: unknown, params: any, signal?: AbortSignal, onUpdate?: any, ctx?: any) {
      const limit = clampInteger(params.limit, 20, 1, MAX_LIMIT);
      const redditSort = (params.redditSort ?? "hot") as RedditSort;
      return withWorkingMessage(ctx, "Fetching security CVE news…", async (update) => {
        const entries = await fetchSecurityNews(limit, redditSort, signal, (message) => {
          update(message);
          onUpdate?.({ content: [{ type: "text", text: `Working… ${message}` }], isPartial: true });
        });
        update("Formatting and saving security news…");
        const content = formatSecurityNews(entries);
        const savedPath = saveNewsOutput("security", content, `security-${redditSort}-${limit}`);
        return {
          content: [{ type: "text", text: `${content}\n\nSaved: ${savedPath}` }],
          details: { source: "security", redditSort, subreddits: [...SECURITY_REDDIT_SUBREDDITS], limit, savedPath, entries },
        };
      });
    },
  });

  pi.registerCommand("news-setup", {
    description: "Configure optional news sources such as daily.dev tokens and Reddit cookies.",
    handler: async (_args: string, ctx: any) => {
      await runNewsSetup(ctx);
    },
  });

  pi.registerCommand("news", {
    description: "Fetch news: /news [hackernews|socket|dailydev|reddit|twitter|all] [limit] [top|new|best|ask|show|job|hot|rising|engagement|recent|upvoted|popular] [subreddits=programming,rust] [accounts=OpenAI,github] [query=from:OpenAI]",
    handler: async (args: string, ctx: any) => {
      const parsed = parseNewsArgs(args);
      try {
        await withWorkingMessage(ctx, "Fetching news…", async (update) => {
          const entries = await fetchNewsFeed(parsed.source, parsed.feed, parsed.limit, parsed.subreddits, parsed.redditSort, undefined, parsed.twitterQuery, parsed.twitterAccounts, parsed.twitterRank, parsed.dailyDevRank, update);
          update("Formatting news…");
          const content = formatNews(parsed.source, entries);
          sendNewsMessage(pi, content, entries, parsed.source);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to fetch news: ${message}`, "error");
      }
    },
  });

  pi.registerCommand("news-save", {
    description: "Fetch, show once per session, and save news to ~/.pi/NEWS/GENERAL/: /news-save [same args as /news]",
    handler: async (args: string, ctx: any) => {
      const parsed = parseNewsArgs(args);
      try {
        await withWorkingMessage(ctx, "Fetching news…", async (update) => {
          const entries = await fetchNewsFeed(parsed.source, parsed.feed, parsed.limit, parsed.subreddits, parsed.redditSort, undefined, parsed.twitterQuery, parsed.twitterAccounts, parsed.twitterRank, parsed.dailyDevRank, update);
          update("Formatting and saving news…");
          const content = formatNews(parsed.source, entries);
          const savedPath = saveNewsOutput("general", content, `${parsed.source}-${parsed.feed}-${parsed.limit}`);
          sendNewsMessageOnce(pi, newsSessionKey(parsed), content, entries, parsed.source);
          ctx.ui.notify(`News saved to ${savedPath}`, "success");
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to save news: ${message}`, "error");
      }
    },
  });

  pi.registerCommand("news-sec", {
    description: "Fetch recent/popular security and CVE-relevant news: /news-sec [limit] [hot|new|top|rising]",
    handler: async (args: string, ctx: any) => {
      const parsed = parseSecurityNewsArgs(args);
      try {
        await withWorkingMessage(ctx, "Fetching security CVE news…", async (update) => {
          const entries = await fetchSecurityNews(parsed.limit, parsed.redditSort, undefined, update);
          update("Formatting security news…");
          const content = formatSecurityNews(entries);
          sendNewsMessage(pi, content, entries);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to fetch security news: ${message}`, "error");
      }
    },
  });

  pi.registerCommand("news-sec-save", {
    description: "Fetch, show once per session, and save security CVE news to ~/.pi/NEWS/SECURITY/: /news-sec-save [limit] [hot|new|top|rising]",
    handler: async (args: string, ctx: any) => {
      const parsed = parseSecurityNewsArgs(args);
      try {
        await withWorkingMessage(ctx, "Fetching security CVE news…", async (update) => {
          const entries = await fetchSecurityNews(parsed.limit, parsed.redditSort, undefined, update);
          update("Formatting and saving security news…");
          const content = formatSecurityNews(entries);
          const savedPath = saveNewsOutput("security", content, `security-${parsed.redditSort}-${parsed.limit}`);
          sendNewsMessageOnce(pi, securityNewsSessionKey(parsed), content, entries);
          ctx.ui.notify(`Security news saved to ${savedPath}`, "success");
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to save security news: ${message}`, "error");
      }
    },
  });

}
