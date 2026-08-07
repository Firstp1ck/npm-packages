# Technical reference: Tech News for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Install

```bash
pi install npm:@firstpick/pi-extension-tech-news
```

## Commands

- `/news` — show a small combined technology feed.
- `/news <source> <limit>` — choose a source and number of stories.
- `/news-save` — show and save the general feed.
- `/news-sec` — show security-focused news.
- `/news-sec-save` — show and save the security feed.
- `/news-setup` — configure optional signed-in sources.

Examples:

```text
/news socket 10
/news reddit 20 hot
/news dailydev 10 recent
/news twitter 20 engagement accounts=CISAgov,TheHackersNews
/news-sec 25 hot
```

General feeds are saved under `~/.pi/NEWS/GENERAL/`; security feeds use `~/.pi/NEWS/SECURITY/`.

## Sources

The package supports Hacker News, Socket.dev Blog, Reddit, X/Twitter, Nitter, and daily.dev. Available ranking and filtering choices depend on the source.

When no source is named, Pi divides the requested result count across the enabled sources.

## daily.dev setup

Run `/news-setup`, choose daily.dev, and paste a Personal Access Token from:

<https://app.daily.dev/settings/api>

The token is stored in Pi’s global environment file, normally `~/.pi/agent/.env`.

Browser-session authentication is an unofficial fallback that can break when daily.dev changes. Its integration details are kept in the contributor guide rather than the user reference.

## X/Twitter and Nitter

Run `/news-setup` and choose **Twitter/X + Nitter**.

- An X bearer token enables signed-in recent search.
- A Nitter address enables best-effort public fallback feeds.
- Account lists narrow the feed to selected publishers.

Public Nitter instances may rate-limit requests, block feeds, or disappear without notice.

## Reddit

Run `/news-setup`, choose Reddit, and follow the cookie prompt. Reddit session values are stored in Pi’s global environment file.

Session cookies act like passwords. Do not paste them into chat, screenshots, issues, or repository files.

## Privacy and limitations

- Signed-in source tokens and cookies are optional.
- Saved feeds may include article titles and links from third parties.
- Source availability, ranking, and rate limits can change.
- Security feeds are an aid for discovery, not a complete vulnerability scan.
- Social-media results can contain unverified claims; check original sources before acting.
