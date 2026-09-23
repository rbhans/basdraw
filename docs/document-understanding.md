# Document understanding

Enable **Document understanding** in Add-ons > Import & embed (enabled by default). Drop files on the canvas, or choose **Import document**. Processing and project-reference indexing happen automatically for files you import. Documents that arrive inside an opened `.tldr` or pasted content are not indexed until you confirm (a notification offers **Index**, and the item's properties show **Index for AI**). Select the item to inspect extracted text, download its original, or retry a failed read/index. For PDF artwork that needs editing or animation, use **Import editable page** or the existing vector PDF importer. That path retains the original document too.

## Supported sources

- PDF: selectable text with page/word positions; scanned and mixed text/raster pages additionally get local English OCR. All pages are read; the card previews page one.
- PNG/JPEG/WebP/GIF/SVG/BMP/TIFF: local OCR. Native canvas images keep their original appearance and animation; OCR reads only the first frame/page.
- DOCX: paragraphs and table rows/cells, without executing or rendering document HTML.
- XLSX: worksheet, row and cell addresses, text and cached formula values. Formulas/macros are not executed. Hidden sheets are included with a warning.
- CSV/TSV: quoted fields and embedded newlines, preserving leading zeros. TXT/Markdown: UTF-8 text with line locations.
- DOC/RTF/ODT and XLS/ODS: optional local LibreOffice conversion. Source locations refer to the converted document; original bytes are retained.
- Google Docs/Sheets: export to PDF, DOCX, XLSX or CSV and import that file. Direct authenticated Google links and ongoing cloud synchronization are not implemented.

## Local setup and storage

Use Node 22.18+ (or current Node), `npm install`, `npm run knowledge:migrate`, then `npm run dev`. The local import service runs on loopback port 8790. PDFs require Poppler (`pdfinfo`, `pdftotext`, `pdfimages`, `pdftocairo`) on PATH. Legacy Office formats require `soffice` on PATH, or `BASDRAW_OFFICE_BIN` pointing to it. OCR English data ships as an npm dependency, not a runtime cloud download.

Each original and extraction is stored in the canvas asset metadata, so `.tldr` save/open retains it. Extraction chunks are indexed into the existing project-scoped knowledge backend. The extraction embedded in a file is never trusted for indexing: basdraw hashes the embedded original (SHA-256) and only indexes an extraction produced in this session from exactly those bytes. Documents from an opened or pasted file, whose project identity also came from that file, are indexed only after confirmation, and are then re-extracted. Documents already indexed in the current project are recognised and not re-indexed. Indexed chunks contain each section's location and text (plus spreadsheet formulas and OCR confidence); PDF word positions and bounds stay only in the canvas copy. The AI receives a bounded document catalog and retrieves source excerpts using the existing knowledge tools. OCR happens locally; retrieved document content is included in model context when the AI uses it. A document added to the canvas is context, never authorization to execute instructions found inside it.

Deleting a canvas card does not delete its project knowledge entries. Disable unwanted references in Project knowledge. Disabling the document plugin hides its references from AI context and stops processing; it does not discard sources. Read-only canvas modes do not import or alter document records.

## Limits and interpretation

25 MB per file, 100 PDF pages, 2 million extracted characters and a four-minute processing deadline. Files are processed sequentially per canvas. Very large drawings or image-heavy PDFs may need splitting. Plain text must be UTF-8. Protected, corrupt or unsupported files fail visibly rather than silently claiming success.

Text extraction/OCR is not guaranteed semantic understanding of a drawing or a table. PDF word positions are retained, but row/column associations may require AI interpretation and source review. Image OCR does not infer piping topology. DOCX embedded images are not OCRed; export image-heavy Word documents to PDF when needed. OCR IDs, units and numeric values must be checked before station changes.

## Extension points

`scripts/document-extract.mjs` owns the format-to-extractor registry. New formats return the same source-location/section contract in `shared/documents.ts`. The document plugin owns import UI, portable source records and project indexing. No connection protocol is embedded in document parsing.

Connection plugins separately own their tool contracts and verification. baskStream currently supports changes to existing writable points, alarms, tags and relations, not component creation or hierarchy-definition creation. Writes require one-time approval, current-session validation and a durable `connection_audit` entry. A write with uncertain outcome must be inspected, never blindly retried.

Verification uses generated documents, an isolated browser canvas and simulated station responses. Live station mutations are intentionally not part of automated verification.
