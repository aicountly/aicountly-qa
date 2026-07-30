# QA file I/O fixtures

Small, deterministic, entirely synthetic files used by the worker's file I/O
engine. They exist so an upload/download round trip can be compared byte for
byte and row for row.

Rules for anything added here:

- No real customer, employee, or financial data. Ever.
- Keep files under a few kilobytes so they can be embedded in evidence.
- Stable content: changing a fixture invalidates every historical comparison,
  so add a new file (`-v2`) instead of editing one in place.
- CSV fixtures must have a header row and a stable key column so the data
  verification step can match rows across a round trip.

`bad-mime.png` is a CSV body carrying an image extension. It is used for the
negative test: the target application must reject it.
