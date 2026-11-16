---
name: capture
description: Turn a folder of mixed files (PDF, images, audio, video, links, live pages) into one tagged requirements list, each requirement cited to the exact file and place it came from, with conflicts named and an owner question for each. Use for intake before building from what several people sent.
---

# capture

A folder of mixed files in; a tagged requirements list out. Every requirement is cited. Nothing is guessed.

## Steps

1. **Inventory.** List every file with its type and size. A text file that only points somewhere (a link note) is a source too: open what it points to. Note any source said to live elsewhere (a page behind sign-in, a live board) and ask your human for access instead of skipping it.
2. **Read each file the way it was made:**
   - PDF: extract text with positions (`pdftotext -bbox`) and also render the pages (`pdftoppm`) and look at them; tags can be styled apart from the text.
   - Image (screenshot, whiteboard photo): look at the whole image; handwriting and arrows carry tags. Note where each tag sits.
   - Audio: transcribe with timestamps. Spoken tags lose their dash ("R K4M" means `R-K4M`); write the tag that was meant.
   - Video: transcribe the audio, and also sample frames (every 0.5–2 s) and look for text that appears on screen; a tag can be typed and never said.
   - Live page or link: open it in a browser (signed in if needed), wait, screenshot it twice to see whether it changes.
3. **Collect only tagged requirements** (an id such as `R-X1Y`). Untagged lines are context, not requirements. Keep each tag with its exact wording.
4. **Cite each tag** to where it came from: `file` (name, or the link you opened), `at` (seconds into a recording, where the tag is said or first shown), `region` (`page`, `x`, `y`, `w`, `h` as 0–1 fractions of the image or PDF page, around the tag and its text).
5. **Check every tag against every other tag and against the data** (feeds, records). Two tags that cannot both hold are a conflict; a record that breaks a tag is a conflict with that record, by its id. Do not pick a side: the owner of the product decides.
6. **Write one owner question per conflict**, naming both sides and their sources, answerable in one word.
7. **Output:** `accepted: [{ tag, source }]`, `conflicts: [{ tag, with, ownerQuestion, source }]`, `unreadable: [{ file, why }]` for anything you could not read. Never drop a file silently.

## Checks before you hand it over

- Every file in the inventory appears in a citation or in `unreadable`.
- No tag appears in both `accepted` and `conflicts`.
- Every tag's text was read from the source, not remembered.
