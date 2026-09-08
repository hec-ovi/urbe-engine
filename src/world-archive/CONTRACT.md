# World archive

Stores JSON in bounded collection parts and reads it without constructing one document string.

## Input and output

[API schema](schema/api.d.ts) declares each public function. [Index schema](schema/index.schema.json) declares the persisted format.

Node imports `index.js`. Browser imports `browser.js`, which has no Node dependencies.

- `writeWorldArchive(value, directory, options?)` publishes `index.json` and deterministic `parts/00000000.json` paths in an empty directory. It returns the index. Record collections outside other arrays split above `maxRecords` (100). Arrays inside records, primitive arrays and coordinate arrays split only when their encoded size exceeds `maxPartBytes` (4 MiB). Small coordinate arrays stay inline. Major record parts respect both limits; nested, primitive and coordinate parts follow the byte limit; an indivisible record or scalar over the byte budget fails. Writing preserves JSON.stringify property order, toJSON and omission semantics. Root values without JSON representations fail.
- `openWorldArchive(directory, options?)` or browser `openWorldArchive(indexUrl, options?)` returns `{ index, read(), readProjection({ omit }), readCollection(pointer, range?) }`. `readWorldArchive(directory, options?)` opens and reads the complete value. `readCollection` returns the requested array slice, including nested collections, and fetches only overlapping parts. Unsplit arrays are also readable. Ranges use zero-based inclusive `start` and exclusive `end`; defaults cover the collection. Parts load with bounded concurrency (4).
- `readProjection({ omit: [JSON-pointer, ...] })` removes explicit object properties and skips their descendant parts. Retained values and order are exact. Unknown pointers, root omission and array-element omission fail. Projections keep the complete original binding in `index.json`; they never claim to be the full document.
- `iterateJsonBytes(value)` emits compact original JSON followed by LF in bounded UTF-8 chunks. `hashJson(value)` returns its `{ sha256, bytes }`. The index's `json` field records this same original-content binding. Hashing never stringifies the whole document.

The index keeps an ordinary JSON root skeleton. A collection pointer replaces exactly one array with `null`; descriptors identify those positions, including nested arrays inside parts. No user keys are reserved. Descriptors retain original array counts and contiguous part ranges. Each part includes its byte count and SHA-256. Readers validate index structure, relative paths, part bytes, counts and hashes before returning data. The index and its metadata are read-only. Index files are limited to 32 MiB; reader concurrency accepts 1 to 32. No geometry, record, polygon or array order changes.

## Errors

`WorldArchiveError.code`: `E_ARCHIVE_INPUT` for unsupported input or options, `E_ARCHIVE_SIZE` for an indivisible value exceeding a byte budget, `E_ARCHIVE_INDEX` for malformed indices, `E_ARCHIVE_PART` for absent or malformed parts or mismatched counts, `E_ARCHIVE_HASH` for byte or SHA-256 mismatch, `E_ARCHIVE_RANGE` for invalid pointers or ranges, and `E_ARCHIVE_IO` for filesystem or fetch failures. Failed writes remove their unpublished files. Existing nonempty directories are rejected.

## Dependencies

Node filesystem and SHA-256; browser Fetch, TextEncoder, TextDecoder and Web Crypto.
