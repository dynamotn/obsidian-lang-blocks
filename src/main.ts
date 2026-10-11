/**
 * lang-blocks for Obsidian: show one language at a time for notes written
 * with `<!--lang:xx-->` … `<!--lang:*-->` blocks.
 *
 * In reading mode a post-processor tags every rendered section with the
 * language of the lines it comes from, and switching language only toggles a
 * class on those sections. In Live Preview an editor extension folds the
 * blocks of the other languages (see editor.ts).
 */
import type { EditorView } from "@codemirror/view"
import {
  type Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  type App,
  type MarkdownPostProcessorContext,
  type TFile,
} from "obsidian"
import {
  checkMarkers,
  isVisible,
  lineLangs,
  modeLabel,
  nextMode,
  parseLanguages,
  sectionLang,
  skeleton,
  titleFor,
  type Lang,
  type LineLang,
  type MarkerProblem,
  type Mode,
} from "./logic"
import { langBlocksDiagnostics, setDiagnosticsEffect, setLanguagesEffect } from "./diagnostics"
import { langBlocksEditor, setEnabledEffect, setModeEffect, setSourceModeEffect } from "./editor"

interface Settings {
  /** Languages to cycle through, in order. */
  languages: Lang[]
  /** The language shown now, or "all". */
  mode: Mode
  /** Show the `title` frontmatter entry of the language as the inline title. */
  localizedTitle: boolean
  /** Fold the blocks of the other languages in Live Preview. */
  livePreview: boolean
  /** Fold them in source mode too. */
  sourceMode: boolean
  /** Highlight marker lines that probably don't do what was meant. */
  diagnostics: boolean
}

const DEFAULTS: Settings = { languages: ["vi-VN", "en-US"], mode: "vi-VN", localizedTitle: true, livePreview: true, sourceMode: false, diagnostics: true }

const SECTION_ATTR = "data-lang-block"
const HIDDEN_CLASS = "lang-blocks-hidden"
const TITLE_ATTR = "data-lang-title"

export default class LangBlocksPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS }
  private statusEl: HTMLElement | undefined
  /** Last parsed source, so the sections of one note share one parse. */
  private cache: { text: string; langs: LineLang[] } | undefined

  override async onload() {
    const saved = (await this.loadData()) as Partial<Settings> | null
    this.settings = { ...DEFAULTS, ...saved }

    this.registerMarkdownPostProcessor((el, ctx) => this.tagSection(el, ctx))
    this.registerEditorExtension(
      langBlocksEditor({
        mode: () => this.settings.mode,
        enabled: () => this.settings.livePreview,
        sourceMode: () => this.settings.sourceMode,
        reveal: () => void this.setMode("all"),
      }),
    )
    this.registerEditorExtension(
      langBlocksDiagnostics({
        enabled: () => this.settings.diagnostics,
        languages: () => this.settings.languages,
      }),
    )

    this.statusEl = this.addStatusBarItem()
    this.statusEl.addClass("mod-clickable", "lang-blocks-status")
    this.statusEl.setAttribute("aria-label", "Switch the language shown in reading mode")
    this.statusEl.addEventListener("click", () => void this.cycle())

    this.addCommand({ id: "cycle", name: "Switch to the next language", callback: () => void this.cycle() })
    this.addCommand({ id: "show-all", name: "Show every language", callback: () => void this.setMode("all") })
    this.addCommand({
      id: "insert-blocks",
      name: "Insert language blocks (wraps the selection)",
      editorCallback: (editor) => this.insertBlocks(editor),
    })
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const wrap = editor.somethingSelected()
        menu.addItem((item) =>
          item
            .setTitle(wrap ? "Wrap in language blocks" : "Insert language blocks")
            .setIcon("languages")
            .onClick(() => this.insertBlocks(editor)),
        )
      }),
    )
    this.addCommand({
      id: "check-vault",
      name: "Check language markers in every note",
      callback: () => void this.checkVault(),
    })
    for (const lang of this.settings.languages) {
      this.addCommand({ id: `show-${lang}`, name: `Show ${lang} only`, callback: () => void this.setMode(lang) })
    }

    this.addSettingTab(new LangBlocksSettingTab(this.app, this))

    this.registerEvent(this.app.workspace.on("layout-change", () => this.refreshTitles()))
    this.registerEvent(this.app.workspace.on("file-open", () => this.refreshTitles()))
    this.registerEvent(this.app.metadataCache.on("changed", () => this.refreshTitles()))
    this.app.workspace.onLayoutReady(() => this.apply())
  }

  override onunload() {
    this.forEachRoot((root) => {
      for (const el of Array.from(root.querySelectorAll(`[${SECTION_ATTR}]`))) {
        el.removeClass(HIDDEN_CLASS)
        el.removeAttribute(SECTION_ATTR)
      }
      for (const el of Array.from(root.querySelectorAll(`[${TITLE_ATTR}]`))) el.removeAttribute(TITLE_ATTR)
    })
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }

  async setMode(mode: Mode) {
    this.settings.mode = mode
    await this.saveSettings()
    this.apply()
  }

  private async cycle() {
    await this.setMode(nextMode(this.settings.mode, this.settings.languages))
  }

  /** Show or hide every tagged section for the current mode, and update the UI. */
  apply() {
    const mode = this.settings.mode
    this.forEachRoot((root) => {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${SECTION_ATTR}]`))) {
        const lang = el.getAttribute(SECTION_ATTR)
        el.toggleClass(HIDDEN_CLASS, !isVisible(lang, mode))
      }
    })
    this.refreshTitles()
    this.dispatchToEditors()
    if (this.statusEl) {
      this.statusEl.setText(modeLabel(mode))
      this.statusEl.setAttribute("title", mode === "all" ? "Showing every language" : `Showing ${mode}`)
    }
  }

  /** Tell every open editor about the current mode and whether folding is on. */
  dispatchToEditors() {
    const effects = [
      setModeEffect.of(this.settings.mode),
      setEnabledEffect.of(this.settings.livePreview),
      setSourceModeEffect.of(this.settings.sourceMode),
      setDiagnosticsEffect.of(this.settings.diagnostics),
      setLanguagesEffect.of(this.settings.languages),
    ]
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view
      if (!(view instanceof MarkdownView)) continue
      // Obsidian exposes the CodeMirror 6 view of an editor as `cm`.
      const cm = (view.editor as unknown as { cm?: EditorView }).cm
      cm?.dispatch({ effects })
    }
  }

  /**
   * Insert a block per configured language at the cursor, or wrap the
   * selection into the block of the language shown. Markers always get lines
   * of their own.
   */
  insertBlocks(editor: Editor) {
    const languages = this.settings.languages
    const mode = this.settings.mode
    const primary = mode === "all" ? (languages[0] ?? "en-US") : mode
    const from = editor.getCursor("from")
    const to = editor.getCursor("to")
    const body = editor.somethingSelected() ? editor.getRange(from, to) : undefined
    const { lines, cursorLine } = skeleton(languages, primary, body)
    const before = from.ch > 0 ? "\n" : ""
    const after = to.ch < editor.getLine(to.line).length ? "\n" : ""
    editor.replaceRange(before + lines.join("\n") + after, from, to)
    editor.setCursor({ line: from.line + (before ? 1 : 0) + cursorLine, ch: 0 })
  }

  /** Check the markers of every note and list the problems found. */
  private async checkVault() {
    const found: { file: TFile; problems: MarkerProblem[] }[] = []
    for (const file of this.app.vault.getMarkdownFiles()) {
      const text = await this.app.vault.cachedRead(file)
      if (!text.includes("<!--lang:")) continue
      const problems = checkMarkers(text, this.settings.languages)
      if (problems.length > 0) found.push({ file, problems })
    }
    if (found.length === 0) {
      new Notice("Lang Blocks: no marker problems found.")
      return
    }
    found.sort((a, b) => a.file.path.localeCompare(b.file.path))
    new ProblemsModal(this.app, found).open()
  }

  /** Post-processor: tag a rendered section with the language of its source lines. */
  private tagSection(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    // Embeds, hover previews and some special blocks have no section info:
    // leave them untouched, so nothing is hidden by mistake.
    const info = ctx.getSectionInfo(el)
    if (!info) return
    if (this.cache?.text !== info.text) this.cache = { text: info.text, langs: lineLangs(info.text) }
    const lang = sectionLang(this.cache.langs, info.lineStart, info.lineEnd)
    if (lang === null) return
    el.setAttribute(SECTION_ATTR, lang)
    el.toggleClass(HIDDEN_CLASS, !isVisible(lang, this.settings.mode))
  }

  /** Show the per-language `title` frontmatter entry as the inline title in reading mode. */
  refreshTitles() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view
      if (!(view instanceof MarkdownView)) continue
      const titleEl = view.containerEl.querySelector<HTMLElement>(".markdown-reading-view .inline-title")
      if (!titleEl) continue
      const fm = view.file ? this.app.metadataCache.getFileCache(view.file)?.frontmatter : undefined
      const title = this.settings.localizedTitle ? titleFor(fm?.title, this.settings.mode) : null
      if (title === null) titleEl.removeAttribute(TITLE_ATTR)
      else titleEl.setAttribute(TITLE_ATTR, title)
    }
  }

  /** Run `fn` on the container of every open leaf, in every window. */
  private forEachRoot(fn: (root: HTMLElement) => void) {
    this.app.workspace.iterateAllLeaves((leaf) => fn(leaf.view.containerEl))
  }
}

/** The result of "Check language markers in every note", grouped by note. */
class ProblemsModal extends Modal {
  constructor(
    app: App,
    private found: { file: TFile; problems: MarkerProblem[] }[],
  ) {
    super(app)
  }

  override onOpen() {
    const total = this.found.reduce((n, f) => n + f.problems.length, 0)
    this.setTitle(`Language marker problems: ${total} in ${this.found.length} notes`)
    const list = this.contentEl.createEl("div", { cls: "lang-blocks-report" })
    for (const { file, problems } of this.found) {
      list.createEl("h4", { text: file.path })
      const ul = list.createEl("ul")
      for (const problem of problems) {
        const li = ul.createEl("li")
        const link = li.createEl("a", { text: `Line ${problem.line + 1}`, href: "#" })
        li.appendText(`: ${problem.message}`)
        link.addEventListener("click", (event) => {
          event.preventDefault()
          this.close()
          void this.app.workspace.getLeaf(false).openFile(file, { eState: { line: problem.line } })
        })
      }
    }
  }

  override onClose() {
    this.contentEl.empty()
  }
}

class LangBlocksSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: LangBlocksPlugin,
  ) {
    super(app, plugin)
  }

  display() {
    const { containerEl } = this
    containerEl.empty()

    new Setting(containerEl)
      .setName("Languages")
      .setDesc(
        "Language tags used in <!--lang:xx--> markers, in the order the status bar cycles through them. " +
          "Separate them with commas. Commands for new languages appear after a restart.",
      )
      .addText((text) =>
        text
          .setPlaceholder("vi-VN, en-US")
          .setValue(this.plugin.settings.languages.join(", "))
          .onChange(async (value) => {
            const languages = parseLanguages(value)
            if (languages.length === 0) return
            this.plugin.settings.languages = languages
            const mode = this.plugin.settings.mode
            if (mode !== "all" && !languages.includes(mode)) this.plugin.settings.mode = languages[0] ?? "all"
            await this.plugin.saveSettings()
            this.plugin.apply()
          }),
      )

    new Setting(containerEl)
      .setName("Localized inline title")
      .setDesc("In reading mode, show the title frontmatter entry of the language (title: { vi-VN: …, en-US: … }).")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.localizedTitle).onChange(async (value) => {
          this.plugin.settings.localizedTitle = value
          await this.plugin.saveSettings()
          this.plugin.refreshTitles()
        }),
      )

    new Setting(containerEl)
      .setName("Fold other languages in Live Preview")
      .setDesc(
        "Replace the blocks of the languages not shown with a one-line placeholder; click it to show every " +
          "language. A block stays open while the cursor is inside it. Source mode always shows everything.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.livePreview).onChange(async (value) => {
          this.plugin.settings.livePreview = value
          await this.plugin.saveSettings()
          this.plugin.dispatchToEditors()
        }),
      )

    new Setting(containerEl)
      .setName("Highlight marker problems")
      .setDesc(
        "In the editor, highlight markers that share a line with other text, use a language that isn't " +
          "configured, or open a block that is never closed. Hover a line for the reason.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.diagnostics).onChange(async (value) => {
          this.plugin.settings.diagnostics = value
          await this.plugin.saveSettings()
          this.plugin.dispatchToEditors()
        }),
      )

    new Setting(containerEl)
      .setName("Fold in source mode too")
      .setDesc(
        "Also fold the blocks of the other languages in source mode. Line numbers then skip the folded lines. " +
          "Needs the Live Preview folding above to be on.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sourceMode).onChange(async (value) => {
          this.plugin.settings.sourceMode = value
          await this.plugin.saveSettings()
          this.plugin.dispatchToEditors()
        }),
      )
  }
}
