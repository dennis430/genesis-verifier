# Genesis integration

Genesis checks a receipt against bytes. It does not decide whether to pay, book, or trust the author.

## What it verifies

Given the original file and a `genesis.receipt.v1` receipt, `verify` recomputes only what the receipt names:

- The SHA-256 of the original bytes, kept separate from the SHA-256 of a reproduced extract.
- When `extraction` is present, a second SHA-256 produced by re-running the named profile. A string or byte array supplied beside the hash is `FAIL` `CALLER_EXTRACT_NOT_ACCEPTED`. It is not checked and then trusted.
- Exact quotation of a span.
- Exact arithmetic: addition, subtraction, multiplication, division, percent, and reconciliation. Division and percent require a named rounding mode. Values are rationals, not floating-point numbers.
- That the receipt did not ask an inference, a model output, or a derivative to count as a root.
- That the receipt did not label a sum as observed.
- That the receipt did not claim a signature or independent corroboration this program does not check.

## What it cannot establish

A `PASS` does not establish any of the following:

- The document is genuine, complete, or the document that was alleged.
- `source.kind` is true. A caller can label model output as `counterparty_supplied`.
- The evaluated party does not control the file.
- A signature was checked. The result says `cryptographic: "not_checked"`.
- Another source corroborated the file. The result says `corroboration: "not_checked"`.
- The currency or the accounting period is real. They are checked only for consistency when the receipt declares them.
- The English sentence means what it appears to mean, beyond the exact substring the rule requires.
- A scan, a photo, or a custom-encoded font was read. Those are unsupported, not false.

## What the consumer supplies

- The original bytes (`Uint8Array`).
- The receipt JSON: version, rule id and version, original hash, source kind, claim text, derivation, and the required limitation strings.
- For a PDF, `evidence.mediaType` of `application/pdf`, `extraction.profile` of `genesis.pdf-text.v1`, `extraction.extractedSha256`, and the limitation `SPANS_ADDRESS_EXTRACTED_TEXT_NOT_PDF_BYTES`.
- For a CSV that is LF-only and has no BOM, `extraction.profile` of `genesis.csv.v1`.
- For a CSV that may start with a UTF-8 BOM or use CRLF, `extraction.profile` of `genesis.csv.v2`. v1 is unchanged and still refuses those files. v2 keeps a blank record as one empty field, refuses uneven rows instead of padding them, and escapes a quoted line break. Both require `text/csv` and `SPANS_ADDRESS_CANONICAL_CELLS_NOT_SOURCE_BYTES`.

`extraction` has two fields: `profile` and `extractedSha256`. A pasted cell listing is `FAIL` `CALLER_EXTRACT_NOT_ACCEPTED`.

`EXTRACTION_PROFILES` lists each profile's algorithm, version, supported input, output, and hashing rule. Unknown profiles are `UNVERIFIABLE`, not guessed.

No API key, network, or model.

## How to read the result

| `result` | Meaning | What it is not |
|---|---|---|
| `PASS` | The named bytes, spans, and arithmetic reproduced. | Not authorization. Not authenticity. |
| `FAIL` | The check ran and the receipt is false: hash, span, arithmetic, standing, inference, or an origin overclaim. | Not a prompt to retry with a looser reading. |
| `UNVERIFIABLE` | This profile cannot perform the check: unknown version, unreadable PDF, ambiguous amount, missing rounding. | Not `FAIL`. Do not treat unsupported evidence as a contradiction. |

`UNVERIFIABLE` and `FAIL` must both stop an automated action. They stop it for different reasons.

## Where it sits

An application asks a model for a financial assertion. The model, or a tool beside it, emits a receipt that cites the file. A different process imports `verify` from `@dws/genesis-verifier` and recomputes the receipt with no call back to the model. That process then applies its own policy.

Authorization is that policy. A reproduced total is one input. It is not the decision. `sample/policy.mjs` returns `authorizePayable: false` for `PASS`, `FAIL`, and `UNVERIFIABLE` unless the caller separately supplies human approval and an origin authentication this package did not perform.

## Unsupported PDF features

These return `UNVERIFIABLE`. They are not normalized into a nearby string:

- No shown text, including a scan or a page that only draws an image (`NO_EXTRACTABLE_TEXT`).
- `/ToUnicode` or any custom character map (`TOUNICODE_UNSUPPORTED`).
- Encryption (`ENCRYPTED_PDF`).
- Object streams (`OBJECT_STREAM_UNSUPPORTED`).
- Any filter other than a single `/FlateDecode` (`UNSUPPORTED_PDF_FILTER`).
- A non-ASCII byte inside a shown string (`NON_ASCII_PDF_STRING`).
- The `"` text operator (`UNSUPPORTED_TEXT_OPERATOR`).

Import the package entry point:

```js
import { verify } from '@dws/genesis-verifier'
```

Do not import `src/`. That path is not the contract.

## Install without a registry

Version 0.1.1 is the preview build of the 0.1.0 verification contract. It is not published. From a checkout of this package:

```bash
npm pack
npm install /absolute/path/dws-genesis-verifier-0.1.1.tgz
```

The tarball contains `index.mjs`, `src/`, and these notes. An application outside the repository installs that file and imports `@dws/genesis-verifier`. It does not import this repository.

A pass on the arithmetic still does not authorize a payable. That decision stays in the installing application.

