# Book-er

A phone-friendly PDF reader. It turns small-print PDFs into re-wrappable text
you can resize, and can also show the original pages with the margins trimmed.
Everything runs on the phone: books are stored in the browser's own storage
(IndexedDB) and never uploaded anywhere.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173, also reachable from your phone on the same Wi-Fi
npm run build      # production build in dist/
npm run preview    # serve the production build
```

Testing from a phone over Wi-Fi works for reading, but installing to the home
screen and offline mode need https, so use the Vercel deploy for that.

## Deploy to Vercel

Vercel detects Vite automatically (build command `npm run build`, output `dist`).
Either push the folder to GitHub and import it at vercel.com/new, or run
`npx vercel` from this folder.

## How it's built

- `src/lib/extract.ts`: rebuilds headings and paragraphs from the PDF's
  positioned text: drops running headers/footers and page numbers, detects
  paragraph breaks (indents, spacing, lines that end early), and rejoins
  words hyphenated across lines.
- `src/lib/pdf.ts`: pdf.js setup, page drawing, cover images, and the
  margin-trimming used by page view.
- `src/lib/library.ts` / `db.ts`: the on-device library (books, PDF files,
  extracted text, reading position).
- `src/lib/backup.ts`: single-file backup/restore of the whole library.
- `src/components/`: library screen, reader (text view + page view), settings
  and chapter sheets, install hint.

Needs iOS 17.4+ / a 2024-or-newer browser (pdf.js 6 requirement).
