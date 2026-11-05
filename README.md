<div align="center">

<img src="public/favicon.svg" alt="classify logo" width="72" height="72" />

# classify

**Hand it the spreadsheet. Get the decisions back.**

Teach it your categories and decisions with a few examples. It goes through your file row by row, fills in the answers, flags what a person should check, and gives you back the same file with new columns. Everything runs in your browser.

[Live app](https://shubhamcodess.github.io/classify/) · [Report an issue](https://github.com/shubhamcodess/classify/issues/new)

</div>

## How it works

1. **Write a playbook.** Categories, the decisions you take, and rules that must always hold, such as "billing over $500 goes to a person".
2. **Drop a file.** Excel, CSV, TSV, JSON, JSONL or logs. Title rows, blank lines, empty columns, other separators and multiple sheets are handled.
3. **Review.** Unsure rows wait in a queue, each with its reason. Your corrections become training examples.
4. **Download.** Excel comes back as the same workbook: other sheets, formatting and formulas stay, and these columns are added: `category`, `category_confidence`, `decision`, `decision_confidence`, `decided_by`, `reason`, `needs_review`. Macros (`.xlsm`) and charts may not survive; `.xls` and `.ods` come back as a new `.xlsx`.

5. **Come back later.** Save a run as a project: the file, results and corrections stay in this browser, and later changes save automatically.

## How a row is decided

| Step | What it does | Cost |
| --- | --- | --- |
| Rules | Checked first and always win. Can use any column. | None |
| Words | Naive Bayes over your examples. | None |
| Meaning | `bge-small-en-v1.5`, closest example by cosine similarity. | 34 MB, once |
| Laya | Convai Innovations' `laya-typed-decisions`, as a second opinion on unsure rows. | 847 MB, once; needs WebGPU to be practical |

Rows below your confidence threshold go to a person. Rows with nothing to read, like a "Total" footer, stay blank.

Laya's own card says it is "a fast base to specialise, not a zero-shot decision engine". That matched our tests: the only existing browser build (multilingual) scored 27% on our tuning lines, so this app uses the fine-tuned checkpoint as one signal among three. See [scripts/laya-export](scripts/laya-export/README.md) to publish its browser build, which the Thorough engine needs.

## Measured accuracy

`npm run bench` trains on a few examples and tests on lines kept aside. Mixing weights were chosen on separate tuning lines before the test set was run. The sets are small and hand-labelled, so treat small differences as noise, and test on your own data.

| Task | Lines | Words | + Meaning | Laya alone | All three |
| --- | --- | --- | --- | --- | --- |
| Ticket decisions (untouched test set) | 45 | 73% | 80% | 71% | **87%** |
| Ticket categories | 29 | 83% | 90% | 86% | **93%** |
| Log severity | 30 | 53% | 70% | 77% | **70%** |
| Review sentiment | 18 | 56% | 94% | 89% | **100%** |

On ticket decisions with all three, at 80% confidence or above, 53% of rows are decided automatically at 96% accuracy. The rest go to review. Combining is not always better: on log severity, Laya alone beat all three.

## Privacy

Your files never leave the tab. The only network requests are downloads you ask for: model files from Hugging Face and the ONNX runtime from jsDelivr. Models are stored in the browser's private file system, projects in IndexedDB and playbooks in local storage.

Rows are untrusted input. A row can try to talk a model into an answer, but it can only pick from your options, and rules run first. Use rules for anything that must never be wrong.

## Run locally

```bash
npm ci
npm run dev        # http://localhost:5173
npm test
npm run build
LAYA_REPO=your/repo npm run bench   # or LAYA_LOCAL=path/ ; without Laya, those columns are skipped
```

Pushing to `main` deploys to GitHub Pages through `.github/workflows/pages.yml`.

## License

MIT © 2026 [Shubham Prakash](https://www.linkedin.com/in/shubham-prakash-dev/). Laya is Apache-2.0 by Convai Innovations; bge-small-en-v1.5 is MIT by BAAI.
