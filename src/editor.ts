/**
 * Live Preview support: fold the blocks of the languages not shown into a
 * one-line placeholder. Source mode keeps every line, and a block is never
 * folded while the cursor or a selection is inside it, so no hidden text can
 * be edited by accident.
 */
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state"
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view"
import { editorLivePreviewField } from "obsidian"
import { hiddenRuns, lineLangs, type Lang, type Mode } from "./logic"

/** Sent to every editor when the language shown changes. */
export const setModeEffect = StateEffect.define<Mode>()

/** Sent to every editor when Live Preview folding is turned on or off. */
export const setEnabledEffect = StateEffect.define<boolean>()

interface Options {
  /** The language shown when an editor opens. */
  mode: () => Mode
  /** Whether folding is on when an editor opens. */
  enabled: () => boolean
  /** Called when the reader clicks a placeholder. */
  reveal: () => void
}

interface FoldState {
  mode: Mode
  enabled: boolean
  decorations: DecorationSet
}

class FoldWidget extends WidgetType {
  constructor(
    readonly lang: Lang,
    readonly lines: number,
    readonly reveal: () => void,
  ) {
    super()
  }

  override eq(other: FoldWidget) {
    return other.lang === this.lang && other.lines === this.lines
  }

  toDOM() {
    const el = document.createElement("div")
    el.className = "lang-blocks-fold"
    el.textContent = `${this.lang} · ${this.lines} ${this.lines === 1 ? "line" : "lines"} hidden`
    el.setAttribute("aria-label", "Show every language")
    el.addEventListener("mousedown", (event) => {
      event.preventDefault()
      this.reveal()
    })
    return el
  }

  override ignoreEvent() {
    return true
  }
}

function build(state: EditorState, fold: Omit<FoldState, "decorations">, reveal: () => void): DecorationSet {
  if (!fold.enabled || fold.mode === "all" || !state.field(editorLivePreviewField, false)) return Decoration.none
  const doc = state.doc
  const builder = new RangeSetBuilder<Decoration>()
  for (const run of hiddenRuns(lineLangs(doc.toString()), fold.mode)) {
    const from = doc.line(run.start + 1).from
    const to = doc.line(run.end + 1).to
    if (state.selection.ranges.some((r) => r.from <= to && r.to >= from)) continue
    builder.add(from, to, Decoration.replace({ widget: new FoldWidget(run.lang, run.lines, reveal), block: true }))
  }
  return builder.finish()
}

/** The editor extension: a state field holding the fold decorations. */
export function langBlocksEditor(options: Options): Extension {
  const field = StateField.define<FoldState>({
    create(state) {
      const fold = { mode: options.mode(), enabled: options.enabled() }
      return { ...fold, decorations: build(state, fold, options.reveal) }
    },
    update(value, tr) {
      let { mode, enabled } = value
      for (const effect of tr.effects) {
        if (effect.is(setModeEffect)) mode = effect.value
        if (effect.is(setEnabledEffect)) enabled = effect.value
      }
      const livePreviewChanged =
        tr.startState.field(editorLivePreviewField, false) !== tr.state.field(editorLivePreviewField, false)
      if (
        mode === value.mode &&
        enabled === value.enabled &&
        !tr.docChanged &&
        !tr.selection &&
        !livePreviewChanged
      ) {
        return value
      }
      const fold = { mode, enabled }
      return { ...fold, decorations: build(tr.state, fold, options.reveal) }
    },
    provide: (f) => [
      EditorView.decorations.from(f, (value) => value.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(f).decorations),
    ],
  })
  return field
}
