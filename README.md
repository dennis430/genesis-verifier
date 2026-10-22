# Genesis

Independently reproducible verification for evidence-backed machine assertions.

Genesis checks a receipt against the file it cites. It uses Node's `crypto` and `zlib`. It does not call a model or a server. Node 20 or newer. Licensed under Apache-2.0.

## What it verifies

Given the original bytes and a `genesis.receipt.v1` receipt, `verify` recomputes only what the receipt names:

- The SHA-256 of those original bytes.
- When `extraction` is set, a second SHA-256 produced by running the named profile again.
- An exact quotation, or exact rational arithmetic: add, subtract, multiply, divide, percent, and reconciliation. Division and percent require a named rounding mode.
- That the receipt did not use an inference, a model output, or a derivative as a root, and did not label a calculation as observed.
- That the receipt did not claim a signature or independent corroboration this package does not check.

## What it does not establish

A `PASS` does not establish that the document is genuine, that `source.kind` is true, that a signature was checked, that another source corroborated the file, or that a payment is authorized. Currency and period labels are checked only for consistency. The claim sentence is not interpreted beyond the exact match the rule requires.

Byte integrity, extraction reproducibility, source authenticity, and authorization are four different properties. This package performs the first two. It does not perform the last two.

## Install

```bash
npm install @dws/genesis-verifier
```

The package is scoped. Publication uses public access. If you have the release tarball instead:

```bash
npm install ./dws-genesis-verifier-0.1.1.tgz
```

```js
import { verify } from '@dws/genesis-verifier'
```

Do not import `src/`.

## Example

`sample/app.mjs` adds `$6,200.00` and `$7,750.00` from `sample/invoice.txt`. The check can pass. Payment stays unauthorized, in `sample/policy.mjs`, which this package does not call.

```bash
cp -a node_modules/@dws/genesis-verifier/sample .
node sample/app.mjs
```

```
PASS
authorizePayable false
```

## Profiles

| Profile | Accepts | Does not do |
|---|---|---|
| none | UTF-8 bytes, spans into those bytes | No extraction |
| `genesis.pdf-text.v1` | `%PDF-` with literal shown text, uncompressed or one FlateDecode filter | No OCR, no ToUnicode, no encryption, no other filters. Spans address the extract, not the PDF bytes. |
| `genesis.csv.v1` | LF-only `text/csv`, no BOM | Rejects CR, BOM, tabs, blank rows, quoted newlines, uneven rows |
| `genesis.csv.v2` | `text/csv`, optional leading UTF-8 BOM, CRLF | Does not skip a blank row or pad an uneven row. A quoted line break is escaped. A bare CR is unverifiable. |

`EXTRACTION_PROFILES` lists the algorithm, version, input, output, and hashing rule. `extraction` may contain only `profile` and `extractedSha256`. Any other field, including pasted cells, is `FAIL` `CALLER_EXTRACT_NOT_ACCEPTED`.

The original-file hash and the extract hash are separate. A match on one does not imply the other.

## Verdicts

| Result | Meaning |
|---|---|
| `PASS` | The cited bytes, spans, and arithmetic reproduced. |
| `FAIL` | The check ran and the receipt is false: hash, span, arithmetic, standing, inference, or an origin overclaim. |
| `UNVERIFIABLE` | This version cannot perform the check. That is not a contradiction and not a pass. |

`FAIL` and `UNVERIFIABLE` must both stop an automated action. They stop it for different reasons. Neither result authorizes a payment. Authorization stays in the application that calls `verify`.

## Limitations

PDF text that depends on a custom encoding or a scan is `UNVERIFIABLE`, not approximated. CSV profiles split on commas only. They do not detect a header. v1 does not read a typical spreadsheet export that uses CRLF or a BOM; use v2 for that export. v2 still will not repair uneven rows.

## License and contributions

Copyright 2026 Dennis Liu. Apache License 2.0. See `LICENSE`.

There are no third-party runtime dependencies and no separate `NOTICE` file.

Issues and pull requests: https://github.com/dennis430/genesis-verifier/issues
