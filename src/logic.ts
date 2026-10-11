/**
 * Pure logic of lang-blocks, kept free of the Obsidian API so it can be tested.
 *
 * A note marks per-language parts with `<!--lang:xx-->` and returns to text
 * shared by every language with `<!--lang:*-->`. The rules follow
 * `filterLanguage` in datme, so a note reads the same in Obsidian as on the
 * published site: a marker is any line containing one, text outside a block is
 * shared, and markers inside a ``` fence are ignored.
 */

/** A language tag such as `vi-VN`, or `*` for text shared by every language. */
export type Lang = string

/** What one source line belongs to. */
export type LineLang = { kind: "marker" } | { kind: "shared" } | { kind: "lang"; lang: Lang }

/** Which languages the reader wants: one language, or every block at once. */
export type Mode = Lang | "all"

const MARKER = /<!--lang:(.*)-->/

/** Classify every line of a note's source. */
export function lineLangs(src: string): LineLang[] {
  let inFence = false
  let current: Lang | null = null
  const out: LineLang[] = []
  for (let line of src.split("\n")) {
    line = line.replace(/[\t\r ]*$/, "")
    if (line.includes("```")) inFence = !inFence
    if (!inFence) {
      const m = line.match(MARKER)
      if (m) {
        current = m[1] === "*" ? null : (m[1] as Lang)
        out.push({ kind: "marker" })
        continue
      }
    }
    out.push(current === null ? { kind: "shared" } : { kind: "lang", lang: current })
  }
  return out
}

/**
 * The language of a rendered section spanning `lineStart`..`lineEnd`
 * (inclusive, 0-based). Returns `null` when the section is shared, holds only
 * markers, or mixes languages: such a section is always shown.
 */
export function sectionLang(langs: LineLang[], lineStart: number, lineEnd: number): Lang | null {
  let found: Lang | null = null
  for (let i = Math.max(0, lineStart); i <= Math.min(lineEnd, langs.length - 1); i++) {
    const l = langs[i]
    if (l === undefined || l.kind === "marker") continue
    if (l.kind === "shared") return null
    if (found === null) found = l.lang
    else if (found !== l.lang) return null
  }
  return found
}

/** Whether a section of language `lang` is visible in `mode`. */
export function isVisible(lang: Lang | null, mode: Mode): boolean {
  return lang === null || mode === "all" || lang === mode
}

/** A run of lines to hide in the editor: `start`..`end`, 0-based and inclusive. */
export interface HiddenRun {
  start: number
  end: number
  lang: Lang
  /** Lines of text in the run, not counting the marker that opens it. */
  lines: number
}

/**
 * The runs of lines the editor hides in `mode`: every block of another
 * language, together with the marker line that opens it. Shared text and the
 * markers that open shown blocks or return to shared text stay visible.
 */
export function hiddenRuns(langs: LineLang[], mode: Mode): HiddenRun[] {
  if (mode === "all") return []
  const runs: HiddenRun[] = []
  let run: HiddenRun | undefined
  langs.forEach((l, i) => {
    if (l.kind !== "lang" || l.lang === mode) {
      run = undefined
      return
    }
    if (run && run.lang === l.lang && run.end === i - 1) {
      run.end = i
      run.lines++
      return
    }
    const opener = langs[i - 1]?.kind === "marker" ? i - 1 : i
    run = { start: opener, end: i, lang: l.lang, lines: 1 }
    runs.push(run)
  })
  return runs
}

/** The languages a note has blocks for, in order of first appearance. */
export function languagesIn(langs: LineLang[]): Lang[] {
  const seen: Lang[] = []
  for (const l of langs) if (l.kind === "lang" && !seen.includes(l.lang)) seen.push(l.lang)
  return seen
}

/** The mode after `mode` when cycling through `languages` and then "all". */
export function nextMode(mode: Mode, languages: Lang[]): Mode {
  const cycle: Mode[] = [...languages, "all"]
  const i = cycle.indexOf(mode)
  return cycle[(i + 1) % cycle.length] ?? "all"
}

/** Short label for the status bar: `VI` for `vi-VN`, `ALL` for every language. */
export function modeLabel(mode: Mode): string {
  return mode === "all" ? "ALL" : (mode.split("-")[0] ?? mode).toUpperCase()
}

/**
 * The title to show for `mode` from a `title` frontmatter value. Only a map of
 * language to text (`title: { vi-VN: …, en-US: … }`) gives a per-language
 * title; anything else, or a missing or empty entry, gives `null`.
 */
export function titleFor(title: unknown, mode: Mode): string | null {
  if (mode === "all" || title === null || typeof title !== "object" || Array.isArray(title)) return null
  const value = (title as Record<string, unknown>)[mode]
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

/** Parse the language list setting: comma or whitespace separated, no duplicates. */
export function parseLanguages(value: string): Lang[] {
  const out: Lang[] = []
  for (const part of value.split(/[\s,]+/)) {
    const lang = part.trim()
    if (lang !== "" && lang !== "*" && lang !== "all" && !out.includes(lang)) out.push(lang)
  }
  return out
}
