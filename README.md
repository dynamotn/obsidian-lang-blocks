# Lang Blocks for Obsidian

Show one language at a time, in reading mode and Live Preview, for notes that
keep several languages side by side:

```markdown
<!--lang:vi-VN-->
## Mục tiêu
Tiết kiệm 6 tháng chi tiêu.
<!--lang:en-US-->
## Goals
Save six months of expenses.
<!--lang:*-->
![[Budget.base]]
```

A line containing `<!--lang:xx-->` starts the block of language `xx`, and
`<!--lang:*-->` returns to text shared by every language. Text outside any
block is always shown, and markers inside a ```` ``` ```` fence are ignored.
These are the rules of [datme](https://gitlab.com/dynamo-tools/datme), so a note
reads the same in Obsidian as on the published garden.

## Use

- **The status bar** shows the language in view (`VI`, `EN` or `ALL`). Click it
  to switch to the next language, and after the last one to every language.
- **Commands**: *Switch to the next language*, *Show every language*, and
  *Show xx only* for each configured language.
- **Localized inline title**: in reading mode, a note with a per-language
  `title` shows the entry of the language instead of its file name:

  ```yaml
  title:
    vi-VN: Tài chính
    en-US: Finance
  ```

- **Live Preview** folds the blocks of the other languages into a one-line
  placeholder such as `en-US · 12 lines hidden`; click it to show every
  language. A block stays open while the cursor or a selection is inside it, so
  you never edit text you can't see. Source mode shows everything unless
  *Fold in source mode too* is on.

- **Insert language blocks** (command, or the editor's right-click menu) adds a
  block per configured language at the cursor, with the cursor in the block of
  the language shown. With text selected, it wraps the selection into that
  block and moves the cursor to the first other block, ready for the
  translation. Markers always get lines of their own.
- **Marker problems** are highlighted in the editor, with the reason on hover:
  a marker sharing its line with other text (it still switches the block), a
  language that isn't configured (often a typo such as `vi-vn`), or a block
  left open at the end of the note. *Check language markers in every note*
  lists them for the whole vault; click one to jump to its line.

Switching never rewrites a note: reading mode toggles a CSS class on sections
that are already rendered, and Live Preview only changes editor decorations.

## Settings

- **Languages**: the tags used in your markers, in the order the status bar
  cycles through them. Default `vi-VN, en-US`.
- **Localized inline title**: on by default.
- **Fold other languages in Live Preview**: on by default.
- **Highlight marker problems**: on by default.
- **Fold in source mode too**: off by default. Line numbers skip the folded
  lines.

## Limits

- Put every marker on a line of its own. A line that merely mentions one, such
  as a sentence quoting a whole marker in inline code, still counts as a marker
  (the datme rule) and ends the block it sits in; the editor highlights it.
- Embedded notes and hover previews show every block: Obsidian gives the plugin
  no source position for them, and the plugin never hides what it can't place.
- A section that mixes two languages, which happens only when a marker sits
  inside a paragraph or list without a blank line around it, is shown in every
  mode.
- The file explorer and tab titles keep the file name.

## Install

Until it's in the community directory:

1. Build it: `bun install && bun run build`.
2. Copy `main.js`, `manifest.json` and `styles.css` into
   `<your vault>/.obsidian/plugins/lang-blocks/`, or symlink this folder there
   while developing.
3. Enable **Lang Blocks** under Settings → Community plugins.

## Develop

```sh
bun install
bun test          # logic tests
bun run check     # type check
bun run build     # bundle main.js
```

`src/logic.ts` holds everything that doesn't need Obsidian and is covered by
`tests/logic.test.ts`. `src/editor.ts` is the CodeMirror 6 extension for Live
Preview, tested in `tests/editor.test.ts` against a stand-in for the one
Obsidian export it reads. `src/main.ts` wires both into the app.
