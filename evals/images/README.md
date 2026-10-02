Photos of real handwritten attempts go here. Point a case at one with
"attempt": { "image": "evals/images/<file>.jpg" } in place of "text".

## Rendered check-work photos

`node evals/make-images.mjs` renders these (printed question + handwritten
working, one tilted and dim, one not homework at all) for cases 11-18.

## Question-detection pages (cases 21-24, `"kind": "detect"`)

Each case gives the image's true pixel `width`/`height` and, per numbered
question, the true box as a `rect` normalized to 0..1 (x, y = top-left). A
true box covers the question's number, stem, every part and option, and any
handwritten working under it; it leaves out running headers, headings, page
numbers, rules and shared "Use this information to answer questions…" stems.
No two boxes in a case overlap.

| Image | Size | Questions | What it tests |
|---|---|---|---|
| `spread-gas-laws.jpg` (case 21) | 1206x1688 | 18 (13-30) | The real photo detection failed on: textbook p. 182, two columns, curved and slightly rotated, a shared stem over 13-15, pencil marks. Tapping 27 boxed 25(a)(b) + the top of 26; tapping 19 boxed the bottom of 18 + the top of 19. |
| `detect-two-column.jpg` (case 22) | 900x1200 | 10 (31-40) | A clean printed two-column page: running header, page number, a heading, (a)(b)(c) parts, A-D options, a shared stem. |
| `detect-worksheet.jpg` (case 23) | 900x1200 | 6 (1-6) | One column with blank answer space; questions 2 and 5 have handwritten working, which is inside their box. |
| `detect-tilted-spread.jpg` (case 24) | 900x1200 | 10 (31-40) | Case 22's page rotated 3° and scaled on a dark desk, dimmed and vignetted like a phone photo. |

Every one has a `<name>.grid.jpg` twin: the same pixels with the coordinate
grid the app can draw for detection (`lib/detectGrid.ts`, the app's own
drawer, transpiled in): 9 lines each way at every 10%, labelled at both ends
with their pixel position.

**Where the truth comes from.**
- 21: `spread-gas-laws.jpg` was rebuilt by `evals/rebuild-spread.mjs` from two
  phone screenshots of the cropper over the student's photo (the original
  photo wasn't kept): the cropper's dark overlay was measured where the two
  screenshots' selection boxes differ and inverted. The formerly dimmed areas
  carry some amplified JPEG noise. The boxes were measured on the result:
  ink of each question (dark pixels, grouped into lines), enclosed in an
  axis-aligned box with 1px to spare, and checked by eye.
- 22-24: `make-images.mjs` measures them from the DOM: the union of the
  rendered boxes of every piece of text in a question (for 24, each of those
  boxes' corners is put through the page's rotate/scale transform first, and
  the result is checked against Chrome's own transformed rects). It writes
  the case JSON in the same run, so the image and its truth can't drift.
