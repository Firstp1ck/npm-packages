# Tech News for Pi

Bring technology news from several sources into Pi for browsing and summaries.

## What you can do

- Collects technology stories from several sources.
- Offers general and security-focused feeds.
- Filters by source, topic, account, or community.
- Can save selected feeds locally for later reading.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-tech-news
```

Restart Pi if the package does not appear in your current session.

## How to use it

Run `/news` for a small combined feed. Choose a source or topic when you want something narrower, and use the save commands when you want a local copy.

Start with the combined feed:

```text
/news
```

Or choose a source and number of stories:

```text
/news socket 10
/news reddit 20 hot
/news dailydev 10 recent
```

Useful commands:

- `/news-setup` — configure optional daily.dev, Reddit, or X sources. Tokens and session cookies entered here are saved to Pi’s agent environment file; treat that file as sensitive.
- `/news-save` — show the feed and save a copy locally.
- `/news-sec` — focus on security news.
- `/news-sec-save` — show and save the security feed.

Source filters, subreddit lists, account lists, ranking modes, and the complete syntax are in the technical reference.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-tech-news/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
