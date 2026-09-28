# INEC Result Intelligence

A source-traceable civic technology platform for collecting, extracting, validating, aggregating, and exploring polling-unit election results from publicly available INEC result sources.

## Principles

- Preserve the original result-sheet evidence.
- Separate extraction from validation and aggregation.
- Never silently alter extracted figures.
- Make every displayed result traceable to its source.
- Clearly distinguish official INEC data from independently processed analytics.
- Surface uncertainty and review requirements instead of hiding them.

## Planned pipeline

IReV / public INEC source → collection → original evidence storage → OCR/vision extraction → deterministic validation → confidence/review → structured results → aggregation → analytics.

## Status

Project foundation. The next milestone is the application shell, data model, source collector, and evidence-first result processing pipeline.
