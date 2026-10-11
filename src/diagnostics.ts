/**
 * Editor diagnostics: highlight marker lines that probably don't do what the
 * writer meant (see `checkMarkers`), with the reason as a tooltip. Works in
 * Live Preview and source mode alike.
 */
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state"
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view"
import { checkMarkers, type Lang } from "./logic"

/** Sent to every editor when the highlighting is turned on or off. */
export const setDiagnosticsEffect = StateEffect.define<boolean>()

/** Sent to every editor when the configured languages change. */
export const setLanguagesEffect = StateEffect.define<Lang[]>()

interface Options {
  enabled: () => boolean
  languages: () => Lang[]
}

interface DiagnosticsState {
  enabled: boolean
  languages: Lang[]
  decorations: DecorationSet
}

function build(state: EditorState, enabled: boolean, languages: Lang[]): DecorationSet {
  if (!enabled) return Decoration.none
  const builder = new RangeSetBuilder<Decoration>()
  const byLine = new Map<number, string[]>()
  for (const p of checkMarkers(state.doc.toString(), languages)) {
    byLine.set(p.line, [...(byLine.get(p.line) ?? []), p.message])
  }
  for (const [line, messages] of [...byLine].sort((a, b) => a[0] - b[0])) {
    const from = state.doc.line(line + 1).from
    builder.add(
      from,
      from,
      Decoration.line({ class: "lang-blocks-problem", attributes: { title: messages.join("\n") } }),
    )
  }
  return builder.finish()
}

/** The editor extension: a state field holding the problem line decorations. */
export function langBlocksDiagnostics(options: Options): Extension {
  return StateField.define<DiagnosticsState>({
    create(state) {
      const enabled = options.enabled()
      const languages = options.languages()
      return { enabled, languages, decorations: build(state, enabled, languages) }
    },
    update(value, tr) {
      let { enabled, languages } = value
      for (const effect of tr.effects) {
        if (effect.is(setDiagnosticsEffect)) enabled = effect.value
        if (effect.is(setLanguagesEffect)) languages = effect.value
      }
      if (enabled === value.enabled && languages === value.languages && !tr.docChanged) return value
      return { enabled, languages, decorations: build(tr.state, enabled, languages) }
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.decorations),
  })
}
