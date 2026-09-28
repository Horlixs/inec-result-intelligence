# IReV source notes

## Verified public entry points

- https://inecelectionresults.ng/
- https://irev.inecnigeria.org/

## Evidence-first collection contract

The collector must capture the public election identifier, visible election name, navigation URL, geographic identifiers, result-sheet URL, original response bytes, SHA-256 hash, retrieval timestamp, and relevant HTTP metadata.

The result sheet is evidence. OCR is a derived representation and must never replace the original.

## Processing contract

discover -> download -> hash -> store -> extract -> validate -> review -> publish

A failed OCR extraction must not delete or overwrite the source sheet.

## Validation

At minimum:
- integer and non-negative vote values
- accredited voters <= registered voters when both are present
- preserve candidate/party labels exactly as extracted
- detect duplicate source hashes
- do not aggregate results until the configured publication state

Election-specific rules should be versioned rather than embedded in the UI.

## Current source limitation

The public search/index does not expose a stable documented API contract for the current IReV frontend. We therefore should not hard-code a private endpoint. The collector needs a controlled browser/network inspection step before production crawling.

## Provenance

INEC's 2023 General Election report describes IReV as the public portal for scanned polling-unit Form EC8A result sheets. The current public portal also lists recent 2026 elections.
