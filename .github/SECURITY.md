# Security

## Reporting

Please report security problems privately, not in a public issue: email [contact@florentinf.dev](mailto:contact@florentinf.dev). Include what you found and how to reproduce it. A sample file helps, as long as it contains nothing private.

This is a small project maintained in spare time, so there's no bounty and no fixed response time, but reports are read and credited if you'd like that.

## What counts

The site's promise is that files never leave the visitor's device, so the most serious reports are ways to break it:

- Anything that sends file contents or names off the device, or lets a crafted file do so.
- A bypass of the Content Security Policy in `public/_headers`.
- Script running on rebake's origin from a file's name, metadata or contents.
- A vendored engine that doesn't match what `vendor/manifest.json` says it is.

Also in scope: a conversion that silently keeps metadata the visitor asked to remove.

A crafted file that crashes or slows one tab isn't a vulnerability on its own, because it affects only the person who opened it. It's still worth a normal bug report.

## Supported versions

Only what's live at [rebake.app](https://rebake.app), which is the latest tested commit on `main`.

## Dependencies

Engines are served from rebake's own origin, and each file is pinned by SHA-256 in `vendor/SHA256SUMS`, which every build checks. Modified files are listed in [THIRD_PARTY.md](../docs/THIRD_PARTY.md).
