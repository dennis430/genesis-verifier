# Receipt `genesis.receipt.v1`

A receipt is a JSON object. The verifier returns `PASS`, `FAIL`, or `UNVERIFIABLE`. `UNVERIFIABLE` is not a pass. A consumer that proceeds on it is wrong.

```json
{
  "receiptVersion": "genesis.receipt.v1",
  "rule": { "id": "sum.exact", "version": "1" },
  "evidence": { "sha256": "<64 lowercase hex chars of the cited bytes>" },
  "source": { "kind": "counterparty_supplied" },
  "claimStanding": "derived",
  "claim": { "text": "Total invoiced amount: $18,450.00" },
  "derivation": {
    "type": "sum",
    "operands": [
      { "label": "Invoice 001", "span": { "start": 12, "end": 22 }, "expectedText": "$6,200.00" }
    ],
    "expectedTotal": "$18,450.00"
  },
  "limitations": [
    "GENUINENESS_NOT_ESTABLISHED",
    "SOURCE_KIND_IS_DECLARED_NOT_PROVEN",
    "SUBJECT_CONTROL_NOT_ESTABLISHED",
    "CLAIM_TEXT_IS_NOT_INTERPRETED_BEYOND_EXACT_MATCH"
  ]
}
```

Spans are byte offsets into that hashed file, end exclusive, UTF-8. `start` and `end` are integers.

Rules in version 1:

| `derivation.type` | `rule.id` | `claimStanding` | What is recomputed |
|---|---|---|---|
| `quotation` | `quotation.exact` | `observed` or `derived` | The span text equals `expectedText`, and `claim.text` is that same string. |
| `sum` | `sum.exact` | `derived` only | Each operand span matches, each amount parses without guessing, the sum equals `expectedTotal`, and `claim.text` contains `expectedTotal` as an exact substring. |
| `inference` | none | none | `FAIL` `INFERENCE_NOT_ADMITTED`. |

`source.kind` of `derivative`, `model_output`, or `engine_derived` is `FAIL` `SOURCE_CANNOT_CORROBORATE`, even when every span matches. Other kinds must be one of `counterparty_supplied`, `independent_record`, `public_assertion`. The kind is a declaration. The verifier cannot tell a false declaration from a true one.

Amounts are ASCII dollars: `$6,200.00`, `$6200`, or `6200.00`. A trailing fraction, when present, is exactly two digits. `1.234` does not parse.

Omitting any required limitation is `FAIL`. A hash mismatch is `FAIL` and spans are not consulted. An out-of-range span, non-UTF-8 span, unknown version, or unparseable amount is `UNVERIFIABLE`.

Text receipts above are unchanged. A PDF is not text with a different name.

## PDF evidence

`evidence.sha256` is always the hash of the bytes the caller handed over. For a PDF those are the original PDF bytes.

Spans never address those bytes. Profile `genesis.pdf-text.v1` inflates `FlateDecode` streams, or reads a stream with no filter. Each literal string shown with `Tj`, `TJ`, or `'` is copied unchanged and followed by one `\n`. Nothing else is inserted: no kerning spaces, no Unicode normalization, no whitespace collapsing. Pages that contain shown text are joined with U+000C. The receipt carries `extraction.extractedSha256` of that UTF-8. The verifier runs the profile again. If it cannot, the result is `UNVERIFIABLE`. If it can and the hash differs, the result is `FAIL` `EXTRACTED_TEXT_HASH_MISMATCH`.

The profile does not normalize characters. It does not OCR. `/ToUnicode`, encryption, object streams, non-ASCII strings, and any filter other than a single `FlateDecode` are `UNVERIFIABLE`. A PDF with no shown text, including a scan, is `NO_EXTRACTABLE_TEXT`.

A PDF receipt must also include the limitation `SPANS_ADDRESS_EXTRACTED_TEXT_NOT_PDF_BYTES`. Omitting it is `FAIL`.

`span.page`, when present, is 1-based and must contain the whole span. A wrong page is `FAIL` `PAGE_MISMATCH`.

## Extraction profiles

A profile is a named, versioned reproduction of an extract. The verifier runs the profile. It does not accept an extract pasted into the receipt.

`extraction` may contain only `profile` and `extractedSha256`. Any other field, including a caller-supplied text or byte result, is `FAIL` `CALLER_EXTRACT_NOT_ACCEPTED`.

| Profile | Algorithm | Output that is hashed |
|---|---|---|
| `genesis.pdf-text.v1` | `pdf-literal-show-text` version 1 | UTF-8 shown text, as specified above. |
| `genesis.csv.v1` | `csv-rfc4180-cells` version 1 | UTF-8 lines `{row}\t{col}\t{cell}\n`, 1-based, quotes removed only by the quote rule. |
| `genesis.csv.v2` | `csv-rfc4180-cells` version 2 | Same listing. A leading BOM and CRLF are accepted. Quoted line breaks are escaped. Blank and uneven rows are not repaired. |

`genesis.csv.v1` accepts `text/csv` only. It refuses a BOM, a CR, a tab, a blank record, a quoted newline, an uneven row, and a non-UTF-8 byte. Those are `UNVERIFIABLE`. They are not rewritten. A header row is not detected and not skipped. Spans address the cell listing, and the receipt must include `SPANS_ADDRESS_CANONICAL_CELLS_NOT_SOURCE_BYTES`.

`genesis.csv.v2` uses the same limitation and the same refusal of a pasted extract. It does not change v1. It additionally accepts one leading UTF-8 BOM and a CRLF record separator. The BOM is not part of the first cell. CRLF outside quotes ends a record. CRLF inside quotes becomes a single LF in the cell, then `\`, LF, and tab are escaped as `\\`, `\n`, and `\t` so each canonical cell stays on one line. A blank record is kept as one empty field. It is not skipped. If row widths differ, the result is `UNVERIFIABLE` `CSV_UNEVEN_ROW`. Missing cells are not invented. A bare CR is `UNVERIFIABLE` `CSV_BARE_CR`.

The public list is `EXTRACTION_PROFILES`. It describes the algorithm, version, input, output, and hashing rule. It does not contain a function a caller can replace.

Plain UTF-8 receipts with no `extraction` object are unchanged: spans address the original bytes.

## Further exact arithmetic

`sum` is unchanged. Two more rules use rational arithmetic, not floating point:

| `derivation.type` | `rule.id` | Result |
|---|---|---|
| `calculate` | `calculate.exact` | `add`, `sub`, `mul`, `div`, or `pct` over span leaves. `div` and `pct` require `rounding`. |
| `reconcile` | `reconcile.exact` | The document's own total span equals the sum of its component spans. |

`expectedTotal` for `calculate` is a canonical decimal (`18450.00`, not `$18,450.00`). `rounding.mode` is `half_up`, `half_even`, or `down`, and `rounding.scale` is the number of digits after the point. `pct` is `part / whole * 100` at that scale. Division by zero is `FAIL`. A quotient that is not a terminating decimal, with no rounding rule, is `FAIL` rather than an approximation.

`unit` and `period` are declarations on leaves. Adding or subtracting unlike units or periods is `FAIL`. A product may multiply an amount by a dimensionless rate. None of this authenticates the currency or the period.

## Origin

The hash check establishes `origin.bytes = verified` and nothing else. `source.kind` stays a declaration: `sourceKindEstablished` is false on a pass.

`origin.assurance` may be `declared` or `bytes_verified`. `cryptographically_authenticated`, `independently_corroborated`, `authenticated: true`, `corroborated: true`, or `source.kindProven: true` is `FAIL` `ORIGIN_OVERCLAIM`. This verifier does not check a signature and does not look up a corroborating record, so it will not report that it did.

