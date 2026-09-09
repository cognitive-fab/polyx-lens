# Vendored: polyness

**Source:** https://github.com/cognitive-fab/polyness at commit
`2a0ddf84cb3b17f9defc171ef8d02422430e853a`
**Licence:** Apache-2.0 (see `LICENSE`), the same licence polyx already
attributes in its root `NOTICE`.

## What is here, and what is not

polyx uses polyness through three ports, and each port names exactly one
polyness function. This copy is the closure of those three entry points and
nothing else:

| file | why it is here |
|---|---|
| `src/episodes.mjs` | `episodes()` — behind the segmentation port |
| `src/subjects.mjs` | `subjects()` — behind the subjects port |
| `src/provenance.mjs` | `classify()` — behind the provenance port |
| `src/thresholds.mjs` | imported by the two above; imports nothing itself |

Everything else polyness ships — the CLI, the pipeline, propose, replay,
recognise, audit, corrections, normalise, reader, rules, show — is **not
vendored**, because `src/ports/polyness/polyness.d.ts` declares only the surface
above and a standing rule forbids any polyx module outside `src/ports/polyness/`
from importing a polyness symbol.

## Why this drops a dependency rather than adding one

polyness depends on `polyflow`, fetched as a GitHub tarball. None of the four
files above imports it. Vendoring this closure therefore removes polyflow from
polyx's dependency graph entirely, and answers the question the implementation
plan deferred: polyx ships without a tarball dependency on a private repository.

## Modifications

**None.** The four files are byte-for-byte copies of polyness's own committed
blobs — not of its working tree, which differs by line endings. That claim is
checkable in one command per file, because the git object id of the vendored
file equals the object id upstream stores:

```
git -C ../polyness rev-parse HEAD:src/episodes.mjs
git hash-object vendor/polyness/src/episodes.mjs      # same
```

| file | git blob id (both repositories) | sha-256 of the bytes |
|---|---|---|
| `src/episodes.mjs` | `98af81308371e41159db9eb0f3e953dc1bd5bf26` | `7040f45439e818ad5d7236da1ef50ebc…` |
| `src/subjects.mjs` | `b8c26f81577eed737d0dd62684ea565c956ce77c` | `b53261c4c19aaf4c8b1fb03b7f292a91…` |
| `src/provenance.mjs` | `b6910144bf4fd39f30b03e758f4069a3de65a1d5` | `108068a3d56b4414366623b25cd0acc7…` |
| `src/thresholds.mjs` | `66d52dbbb0e480fc3af36f61a7813a7032ef8f0d` | `4fa2dc2e31fc2d51a97d4835e038ad4a…` |

Three of the four carry CRLF in polyness's blobs. `.gitattributes` here sets
`* -text` so this repository stores them unchanged; without it git would
normalise to LF, the object ids would diverge, and the table above would be
false.

If a file here is ever changed, say so in this section and mark the change in
the file — Apache-2.0 §4(b) requires modifications to be marked, and polyx's
root `NOTICE` promises that they are.

## Updating

Re-run the vendoring against a newer polyness commit, record the new commit and
digests here, then run `npm run ci` **and** `node scripts/reproduce.mjs`. These
modules sit under the segmentation, subjects and provenance ports, so a change
in any of them can move a published figure; the reproduction pass is what tells
you whether it did.
