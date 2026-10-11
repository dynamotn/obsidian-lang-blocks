import { describe, expect, test } from "bun:test"
import { EditorState } from "@codemirror/state"
import { EditorView, type DecorationSet } from "@codemirror/view"
import { langBlocksDiagnostics, setDiagnosticsEffect, setLanguagesEffect } from "../src/diagnostics"

const doc = [
  "<!--lang:vi-VN-->", //                       line 1
  "Dùng `<!--lang:*-->` để mở khối chung.", //  line 2: inline
  "<!--lang:fr-FR-->", //                       line 3: unknown
  "Bonjour", //                                 line 4
  "<!--lang:*-->", //                           line 5
].join("\n")

function stateWith(enabled = true, languages = ["vi-VN", "en-US"]) {
  return EditorState.create({
    doc,
    extensions: langBlocksDiagnostics({ enabled: () => enabled, languages: () => languages }),
  })
}

/** Highlighted lines, 1-based, with their tooltip. */
function flagged(state: EditorState): [number, string][] {
  const out: [number, string][] = []
  for (const source of state.facet(EditorView.decorations)) {
    if (typeof source === "function") continue
    ;(source as DecorationSet).between(0, state.doc.length, (from, _to, deco) => {
      out.push([state.doc.lineAt(from).number, String(deco.spec.attributes?.title ?? "")])
    })
  }
  return out
}

describe("marker diagnostics", () => {
  test("highlights problem lines with the reason as a tooltip", () => {
    const lines = flagged(stateWith())
    expect(lines.map(([n]) => n)).toEqual([2, 3])
    expect(lines[1]?.[1]).toContain('"fr-FR"')
  })

  test("highlights nothing when turned off", () => {
    expect(flagged(stateWith(false))).toEqual([])
  })

  test("follows the enabled and languages effects", () => {
    let state = stateWith()
    state = state.update({ effects: setLanguagesEffect.of(["vi-VN", "fr-FR"]) }).state
    expect(flagged(state).map(([n]) => n)).toEqual([2])
    state = state.update({ effects: setDiagnosticsEffect.of(false) }).state
    expect(flagged(state)).toEqual([])
  })

  test("rechecks after an edit", () => {
    let state = stateWith()
    const line2 = state.doc.line(2)
    state = state.update({ changes: { from: line2.from, to: line2.to, insert: "Dùng marker lang:* để mở khối chung." } })
      .state
    expect(flagged(state).map(([n]) => n)).toEqual([3])
  })
})
