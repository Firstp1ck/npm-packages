# Technical reference: Competitor Analysis

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for tasks involving comparing competing products, services, libraries, tools, vendors, or approaches for market/product positioning, feature matrices, strategic trade-offs, pricing, adoption, or differentiation.

## Install

```bash
pi install npm:@firstpick/pi-skill-competitor-analysis
```

## Requirements and fallback

Current comparisons require host-provided web search/fetch access; this package does not bundle retrieval tools. When web access is unavailable, provide the source documents directly and treat time-sensitive claims as unverified rather than inventing current data.

## Example view

```text
User: Compare these three hosted databases for an offline-first desktop app. Use current official pricing and maintenance evidence, and mark anything you cannot verify.
Agent: Builds a sourced comparison, separates current facts from inference, and reports evidence gaps.
```
