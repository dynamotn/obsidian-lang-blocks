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
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting,
  type App,
  type MarkdownPostProcessorContext,
} from "obsidian"
import {
  isVisible,
  lineLangs,
  modeLabel,
  nextMode,
  parseLanguages,
  sectionLang,
  titleFor,
  type Lang,
  type LineLang,
  type Mode,
} from "./logic"
import { langBlocksEditor, setEnabledEffect, setModeEffect } from "./editor"

interface Settings {
  /** Languages to cycle through, in order. */
  languages: Lang[]
  /** The language shown now, or "all". */
  mode: Mode
  /** Show the `title` frontmatter entry of the language as the inline title. */
  localizedTitle: boolean
  /** Fold the blocks of the other languages in Live Preview. */
  livePreview: boolean
}

const DEFAULTS: Settings = { languages: ["vi-VN", "en-US"], mode: "vi-VN", localizedTitle: true, livePreview: true }

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
        reveal: () => void this.setMode("all"),
      }),
    )

    this.statusEl = this.addStatusBarItem()
    this.statusEl.addClass("mod-clickable", "lang-blocks-status")
    this.statusEl.setAttribute("aria-label", "Switch the language shown in reading mode")
    this.statusEl.addEventListener("click", () => void this.cycle())

    this.addCommand({ id: "cycle", name: "Switch to the next language", callback: () => void this.cycle() })
    this.addCommand({ id: "show-all", name: "Show every language", callback: () => void this.setMode("all") })
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
    const effects = [setModeEffect.of(this.settings.mode), setEnabledEffect.of(this.settings.livePreview)]
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view
      if (!(view instanceof MarkdownView)) continue
      // Obsidian exposes the CodeMirror 6 view of an editor as `cm`.
      const cm = (view.editor as unknown as { cm?: EditorView }).cm
      cm?.dispatch({ effects })
    }
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
  }
}
