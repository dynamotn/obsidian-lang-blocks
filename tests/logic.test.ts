import { describe, expect, test } from "bun:test"
import {
  hiddenRuns,
  isVisible,
  languagesIn,
  lineLangs,
  modeLabel,
  nextMode,
  parseLanguages,
  sectionLang,
  titleFor,
  type LineLang,
} from "../src/logic"

const kinds = (langs: LineLang[]) => langs.map((l) => (l.kind === "lang" ? l.lang : l.kind))

describe("lineLangs", () => {
  test("splits a note into marker, language and shared lines", () => {
    const src = [
      "# Title",
      "<!--lang:vi-VN-->",
      "Xin chào",
      "<!--lang:en-US-->",
      "Hello",
      "<!--lang:*-->",
      "![[embed]]",
    ].join("\n")
    expect(kinds(lineLangs(src))).toEqual(["shared", "marker", "vi-VN", "marker", "en-US", "marker", "shared"])
  })

  test("treats frontmatter and text before the first marker as shared", () => {
    const src = ["---", "title:", "  vi-VN: Tài chính", "---", "<!--lang:vi-VN-->", "x"].join("\n")
    expect(kinds(lineLangs(src))).toEqual(["shared", "shared", "shared", "shared", "marker", "vi-VN"])
  })

  test("ignores markers inside a code fence, like datme", () => {
    const src = ["<!--lang:vi-VN-->", "```markdown", "<!--lang:en-US-->", "```", "vẫn tiếng Việt"].join("\n")
    expect(kinds(lineLangs(src))).toEqual(["marker", "vi-VN", "vi-VN", "vi-VN", "vi-VN"])
  })

  test("accepts a marker with trailing spaces or a carriage return", () => {
    expect(kinds(lineLangs("<!--lang:en-US-->  \r\ntext"))).toEqual(["marker", "en-US"])
  })

  test("treats a note without markers as shared", () => {
    expect(kinds(lineLangs("a\nb"))).toEqual(["shared", "shared"])
  })
})

describe("sectionLang", () => {
  const langs = lineLangs(
    ["shared", "<!--lang:vi-VN-->", "vi 1", "vi 2", "<!--lang:en-US-->", "en 1", "<!--lang:*-->", "end"].join("\n"),
  )

  test("returns the language of a section inside one block", () => {
    expect(sectionLang(langs, 2, 3)).toBe("vi-VN")
    expect(sectionLang(langs, 5, 5)).toBe("en-US")
  })

  test("ignores marker lines at the edge of a section", () => {
    expect(sectionLang(langs, 1, 3)).toBe("vi-VN")
  })

  test("returns null for shared, marker-only and mixed sections", () => {
    expect(sectionLang(langs, 0, 0)).toBeNull()
    expect(sectionLang(langs, 7, 7)).toBeNull()
    expect(sectionLang(langs, 4, 4)).toBeNull()
    expect(sectionLang(langs, 3, 5)).toBeNull()
  })

  test("clamps a range that runs past the note", () => {
    expect(sectionLang(langs, 5, 99)).toBeNull()
    expect(sectionLang(langs, -3, 2)).toBeNull()
  })
})

describe("isVisible", () => {
  test("shows shared sections and the chosen language", () => {
    expect(isVisible(null, "vi-VN")).toBe(true)
    expect(isVisible("vi-VN", "vi-VN")).toBe(true)
    expect(isVisible("en-US", "vi-VN")).toBe(false)
    expect(isVisible("en-US", "all")).toBe(true)
  })
})

describe("modes", () => {
  test("lists the languages a note uses in order", () => {
    expect(languagesIn(lineLangs("<!--lang:en-US-->\na\n<!--lang:vi-VN-->\nb\n<!--lang:en-US-->\nc"))).toEqual([
      "en-US",
      "vi-VN",
    ])
  })

  test("cycles through the languages, then all, then back", () => {
    const languages = ["vi-VN", "en-US"]
    expect(nextMode("vi-VN", languages)).toBe("en-US")
    expect(nextMode("en-US", languages)).toBe("all")
    expect(nextMode("all", languages)).toBe("vi-VN")
    expect(nextMode("fr-FR", languages)).toBe("vi-VN")
  })

  test("labels a mode by its language subtag", () => {
    expect(modeLabel("vi-VN")).toBe("VI")
    expect(modeLabel("en")).toBe("EN")
    expect(modeLabel("all")).toBe("ALL")
  })

  test("parses the language setting", () => {
    expect(parseLanguages(" vi-VN, en-US  en-US,*, all ")).toEqual(["vi-VN", "en-US"])
    expect(parseLanguages("")).toEqual([])
  })
})

describe("titleFor", () => {
  const title = { "vi-VN": "Tài chính", "en-US": " Finance " }

  test("picks the entry of the language", () => {
    expect(titleFor(title, "vi-VN")).toBe("Tài chính")
    expect(titleFor(title, "en-US")).toBe("Finance")
  })

  test("returns null in all mode, for a missing entry, or a plain title", () => {
    expect(titleFor(title, "all")).toBeNull()
    expect(titleFor(title, "fr-FR")).toBeNull()
    expect(titleFor({ "vi-VN": "" }, "vi-VN")).toBeNull()
    expect(titleFor("Finance", "vi-VN")).toBeNull()
    expect(titleFor(undefined, "vi-VN")).toBeNull()
    expect(titleFor(["a"], "vi-VN")).toBeNull()
  })
})

describe("hiddenRuns", () => {
  const src = [
    "# Title", //                0 shared
    "<!--lang:vi-VN-->", //      1
    "vi 1", //                   2
    "", //                       3
    "<!--lang:en-US-->", //      4
    "en 1", //                   5
    "en 2", //                   6
    "<!--lang:*-->", //          7
    "shared", //                 8
  ].join("\n")
  const langs = lineLangs(src)

  test("hides the other language's block with its opening marker", () => {
    expect(hiddenRuns(langs, "vi-VN")).toEqual([{ start: 4, end: 6, lang: "en-US", lines: 2 }])
    expect(hiddenRuns(langs, "en-US")).toEqual([{ start: 1, end: 3, lang: "vi-VN", lines: 2 }])
  })

  test("hides nothing in all mode or in a note without blocks", () => {
    expect(hiddenRuns(langs, "all")).toEqual([])
    expect(hiddenRuns(lineLangs("a\nb"), "vi-VN")).toEqual([])
  })

  test("hides every block of a language the note has but isn't shown", () => {
    expect(hiddenRuns(langs, "fr-FR")).toEqual([
      { start: 1, end: 3, lang: "vi-VN", lines: 2 },
      { start: 4, end: 6, lang: "en-US", lines: 2 },
    ])
  })

  test("keeps a fenced example inside its block", () => {
    const fenced = lineLangs(["<!--lang:en-US-->", "```", "<!--lang:vi-VN-->", "```", "<!--lang:*-->"].join("\n"))
    expect(hiddenRuns(fenced, "vi-VN")).toEqual([{ start: 0, end: 3, lang: "en-US", lines: 3 }])
  })

  test("handles a block that ends the note without a closing marker", () => {
    expect(hiddenRuns(lineLangs("<!--lang:en-US-->\nlast"), "vi-VN")).toEqual([
      { start: 0, end: 1, lang: "en-US", lines: 1 },
    ])
  })
})
