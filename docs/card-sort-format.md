# Card sort format (for on-screen card sorts in Formwork)

Formwork reads a card sort straight from its Word file (.docx) and turns it
into an on-screen activity for students. The twelve Lesson 2 card sorts made
in October 2026 (ten for Year 10, two for Year 11) already follow this format. Keep to it for every new card sort,
and paste this page into the conversation that makes them.

## The two kinds of card sort

- **Sort under headers.** Every card goes under one of 2–6 headers
  (e.g. Direct proportion / Inverse proportion / Neither).
- **Make sets.** Cards are grouped into sets (e.g. a question, its
  calculation and its answer). Every set should have the same number of
  cards, and the instruction should say how many ("sets of three").

## The file, top to bottom

1. **Title**: one line, e.g. `Surds card sort`.
2. **Subtitle**: `Lesson 2: <topic> · Print one set per pair, cut out the cards.`
3. **Instruction**: one paragraph saying what to do. For a set sort, say how
   many cards are in a set. Any shared information goes here too (e.g.
   "A bag has 5 red and 3 blue counters…").
4. **Three boxes**, each a one-cell table, in this order, with these exact
   headings on their first line:
   - `Set 4 support`
   - `Set 1 extension`
   - `Discuss with your partner` (one question per line, starting with •)
5. **The cards table.**
   - Each cell is one card. Its first line is the card's **letter** in bold
     on its own (A, B, … Z, then AA, AB, …). Letters must be unique and must
     not give the answer away (mix the order).
   - Under the letter: the card's text, or one picture, or a short label
     followed by one picture (e.g. `Graph` then the picture).
   - Leave unused cells at the end of the last row empty.
   - **Header sorts only:** the first row of the table holds the headers in
     bold, one per column, with no letter.
6. `Set 1: blank cards for your own set`, then the blank-cards table.
   Formwork ignores this part.
7. **Answer key**: the heading `Answer key — <title>`, then a two-column
   table, one row per set or header:
   - Left column: the set's name (`Set A`, or `Set 1: A ∩ B`), or for a
     header sort the header **exactly as written** in the cards table.
   - Right column: one line per card, `<letter>: <the card's text>`. For a
     picture card, just the letter and colon is enough.
   - Every card appears **exactly once** in the answer key.

## Rules that matter for the screen

- **Type maths as text**, with proper symbols: − × ÷ ² ³ √ π ∩ ∪ ′ ≈ ≤ ≥ ₦.
  Don't use Word's equation editor (Formwork can't read it). Anything that
  can't be typed (fractions stacked one above the other, graphs, diagrams,
  tree and Venn diagrams) goes in as a **PNG picture**, one per card, under
  300 KB.
- **The Set 4 support box says which cards are placed for the student.**
  Formwork places them when a student presses "Help me start". Use the
  wording the October files already use:
  - set sort: a line starting `Already matched for you (Set A):` naming one
    set from the answer key (the rest of the line is for people);
  - header sort: one line per placed card,
    `A card that goes under 'Direct proportion': <the card's text>`, with
    the header and the card's text exactly as in the cards table. Adding
    the letter, `… under 'Direct proportion': N`, is safer still.
- **Keep the whole file under 3 MB** (the upload limit for lesson
  worksheets).
- **The answer key is kept from students.** Formwork reads it on upload,
  stores it where students can't read it, and checks their answers on the
  server. The printed file still contains it, so give students the
  on-screen version, not the Word file.
