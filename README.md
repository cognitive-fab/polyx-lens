# polyx-lens

**Read an agent's own logs, and report which of the rules it was given it
actually kept.** Apache-2.0. No mining, no model call, no network code.

Your coding agents have been running for months. Somewhere in
`~/.claude/projects` is a record of every consequential thing they did — every
push, every delete, every deploy — and of every time they skipped the step a
tool contract told them to take first. Nobody has counted.

```
polyx lens — cc against the claude-code contracts (v1)

141 sessions · 111,926 events · 50,295 actions
3,927 events (3.5%) this alphabet cannot name — every figure below is
measured over the rest

WHAT YOUR AGENTS DID
  irreversible    1957   no way back from this machine
         654  push to the remote
         478  change cloud infrastructure or identity
         390  delete files

RULES YOU WERE GIVEN, AND BROKE (12)
  Load the browser skill before driving the browser.
      VIOLATED 299 of 299 times (100.0%)
  Look at the target before deleting it.
      VIOLATED 313 of 390 times (80.3%)
```

That first run is a real one, on 141 real sessions.

## Three things it refuses to do

**It leads with what it cannot see.** The unknown rate is printed before any
finding, because a compliance figure measured over the share of actions a parser
happened to understand is not a measurement. This is not hypothetical: the shell
parser in here once dropped two thirds of a corpus's `git push` calls while
reporting a 1.4% unknown rate. Every number below that line is measured over
what was actually named.

**It never counts "never came up" as a pass.** A clause the corpus never
exercised is reported separately. Merging the two flatters the reader, and
flattery is the failure mode of every compliance tool.

**It says what it cannot answer at all.** Everything here is measured against
rules you already have. The regularities in your history that no document states
— the ones people follow because that is how the work is done — are in no clause
set, so nothing here can find them. That needs a miner, and it is a separate,
commercial thing.

## Install and run

```
npm install
node bin/polyx-lens.mjs             # your own transcripts, from ~/.claude/projects
node bin/polyx-lens.mjs cc-sample   # the sample corpus, shipped with the package
node bin/polyx-lens.mjs audit       # what the alphabet could and could not name
```

**No arguments and no configuration.** Claude Code has been writing transcripts
to `~/.claude/projects` since you installed it; that is the default corpus, read
in place. A run on 378 sessions takes about eight seconds.

It tells you what it skipped before it tells you anything else:

```
reading 378 sessions across 259 projects from ~/.claude/projects
134 of them called a tool at least once; 244 are conversation only
and cannot be checked
```

`cc-sample` is four generated sessions that ship with the package, for when you
want to see the shape of the report without your own data in it.

**The sample is generated, not obfuscated.** A real transcript with its names
hashed still carries the shape of somebody's work — which projects, how long,
what in what order — and that shape is the whole reason a corpus is worth
mining, so redacting it destroys the thing being tested. Every figure the tests
assert is planted in `fixtures/sample/generate.mjs` and stated there in a table,
which also makes them an oracle rather than a lock on whatever the code happened
to print.

Corpora are declared in `polyx.config.json`; five adapters ship — Claude Code
transcripts, ABCD, τ²-bench, BPIC 2017 event logs and a synthetic fixture.

## What is in here

```
src/record.ts        the canonical record: typed events, declared consequence
src/alphabet/        typing, redaction, outcome classification — a reviewed YAML artefact
src/ingest/          five adapters, each a pure function from source files to records
src/ports/           segmentation, subjects, provenance — two implementations each
src/lens/            contract sets, the clause checker, the report
alphabets/           the reviewed typing for each corpus family
contracts/           the rules a harness publishes about itself, decomposed
fixtures/            corpora to test against, including the generated sample
```

Alphabets and fixtures ship with the package, and a dependent reads them from
here rather than keeping a copy: two copies of a reviewed artefact drift, and an
alphabet that drifts silently changes every figure derived from it. A bare
filename in `polyx.config.json` names a shipped alphabet; a path names your own.

`npm test` runs 42 tests over the adapters, the alphabet, the record validator,
the ports and the lens — the code in this package, tested in this package.

**Free text is never persisted.** Command bodies, file contents, edit strings and
prompts hold paths, host names, credentials and customer data. Only the verb and
the redacted path survive into a record; everything else stays where it was.

**A contract set is not an answer key.** `contracts/claude-code.yaml` decomposes
what the harness publishes about *itself* — "you must Read the file in this
conversation before editing" — so it holds for every installation and ships
here. Of its 28 clauses, 13 are checkable as a precedence between two typed
actions and 15 are not, each recorded with the reason. That ratio is the honest
answer to "can you enforce my agent policy": about half of what a harness writes
down is a statement about intent, about a flag on a command, or about the
content of an argument, and no precedence language reaches it.

## Ports, not plugins

Segmentation, subject extraction and provenance are ports with two
implementations each — a naive one written here and a polyness one, vendored
under `vendor/` so a checkout installs standalone. A port with one
implementation is a wish.

## Licence

Apache-2.0. The vendored polyness modules are Apache-2.0 too, with provenance
and byte-level digests recorded in `vendor/polyness/VENDORED.md`.
