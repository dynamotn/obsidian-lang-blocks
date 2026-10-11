import { describe, expect, mock, test } from "bun:test"
import { EditorSelection, EditorState, StateField, type Extension } from "@codemirror/state"
import { EditorView, type DecorationSet } from "@codemirror/view"

// Obsidian is not available outside the app: stand in for the one export the
// editor extension reads, whether the editor is in Live Preview.
const livePreview = StateField.define<boolean>({ create: () => true, update: (v) => v })
mock.module("obsidian", () => ({ editorLivePreviewField: livePreview }))
const { langBlocksEditor, setEnabledEffect, setFallbackEffect, setModeEffect, setSourceModeEffect } = await import(
  "../src/editor"
)

const doc = [
  "# Title", //               line 1
  "<!--lang:vi-VN-->", //     line 2
  "Xin chào", //              line 3
  "<!--lang:en-US-->", //     line 4
  "Hello", //                 line 5
  "World", //                 line 6
  "<!--lang:*-->", //         line 7
  "shared", //                line 8
].join("\n")

function stateWith(
  opts: {
    mode?: string
    live?: boolean
    cursorLine?: number
    enabled?: boolean
    sourceMode?: boolean
    fallback?: string | null
    text?: string
  } = {},
) {
  const extensions: Extension[] = [
    opts.live === false ? livePreview.init(() => false) : livePreview,
    langBlocksEditor({
      mode: () => opts.mode ?? "vi-VN",
      enabled: () => opts.enabled ?? true,
      sourceMode: () => opts.sourceMode ?? false,
      fallback: () => (opts.fallback === undefined ? null : opts.fallback),
      reveal: () => {},
    }),
  ]
  let state = EditorState.create({ doc: opts.text ?? doc, extensions })
  const line = state.doc.line(opts.cursorLine ?? 1)
  state = state.update({ selection: EditorSelection.cursor(line.from) }).state
  return state
}

/** The folded ranges, as 1-based line numbers. */
function folded(state: EditorState): [number, number][] {
  const out: [number, number][] = []
  for (const source of state.facet(EditorView.decorations)) {
    if (typeof source === "function") continue
    ;(source as DecorationSet).between(0, state.doc.length, (from, to) => {
      out.push([state.doc.lineAt(from).number, state.doc.lineAt(to).number])
    })
  }
  return out
}

describe("Live Preview folding", () => {
  test("folds the other language's block with its opening marker", () => {
    expect(folded(stateWith({ mode: "vi-VN" }))).toEqual([[4, 6]])
    expect(folded(stateWith({ mode: "en-US" }))).toEqual([[2, 3]])
  })

  test("folds nothing in all mode, in source mode or when turned off", () => {
    expect(folded(stateWith({ mode: "all" }))).toEqual([])
    expect(folded(stateWith({ live: false }))).toEqual([])
    expect(folded(stateWith({ enabled: false }))).toEqual([])
  })

  test("keeps a block open while the cursor is inside it", () => {
    expect(folded(stateWith({ mode: "vi-VN", cursorLine: 5 }))).toEqual([])
    expect(folded(stateWith({ mode: "vi-VN", cursorLine: 4 }))).toEqual([])
    expect(folded(stateWith({ mode: "vi-VN", cursorLine: 7 }))).toEqual([[4, 6]])
  })

  test("follows mode and enabled effects", () => {
    let state = stateWith({ mode: "vi-VN" })
    state = state.update({ effects: setModeEffect.of("en-US") }).state
    expect(folded(state)).toEqual([[2, 3]])
    state = state.update({ effects: setEnabledEffect.of(false) }).state
    expect(folded(state)).toEqual([])
  })

  test("folds in source mode only when asked to", () => {
    expect(folded(stateWith({ live: false, sourceMode: true }))).toEqual([[4, 6]])
    let state = stateWith({ live: false })
    expect(folded(state)).toEqual([])
    state = state.update({ effects: setSourceModeEffect.of(true) }).state
    expect(folded(state)).toEqual([[4, 6]])
    expect(folded(stateWith({ live: false, sourceMode: true, enabled: false }))).toEqual([])
  })

  test("folds to the fallback language when the shown one has no text", () => {
    const untranslated = [
      "<!--lang:vi-VN-->", //  line 1
      "Đã viết.", //           line 2
      "<!--lang:en-US-->", //  line 3
      "## Goals", //           line 4: a heading alone isn't text
      "<!--lang:*-->", //      line 5
    ].join("\n")
    // No fallback: the empty English block shows, Vietnamese folds.
    expect(folded(stateWith({ mode: "en-US", text: untranslated, cursorLine: 5 }))).toEqual([[1, 2]])
    // Fallback to Vietnamese: the English block folds instead.
    let state = stateWith({ mode: "en-US", text: untranslated, cursorLine: 5, fallback: "vi-VN" })
    expect(folded(state)).toEqual([[3, 4]])
    state = state.update({ effects: setFallbackEffect.of(null) }).state
    expect(folded(state)).toEqual([[1, 2]])
  })

  test("refolds after an edit", () => {
    let state = stateWith({ mode: "vi-VN", cursorLine: 8 })
    state = state.update({ changes: { from: state.doc.length, insert: "\n<!--lang:en-US-->\nmore" } }).state
    expect(folded(state)).toEqual([
      [4, 6],
      [9, 10],
    ])
  })
})
