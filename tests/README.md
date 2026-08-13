# Frame Twelve tests

```bash
npm install
npx playwright install chromium   # first time only
npm test                          # both viewports
npm test -- --project=phone       # phone only
npm test -- undo                  # one spec
npm run test:report               # open the HTML report after a failure
```

The app is a single self-contained HTML file, so the suite loads
`web/frame-twelve.html` over `file://`. There is no server to start and no build
step — the tests exercise exactly the bytes that ship.

## Two viewports, deliberately

`playwright.config.js` defines **phone** (412×915, touch) and **desktop**
(1280×860). This is not thoroughness for its own sake: the app switches timeline
metrics at 560px, and nearly every layout bug worth catching appeared on one side
of that line and not the other.

## What each spec is for

| Spec | Guards |
| --- | --- |
| `smoke.spec.js` | Boots, creates a project, draws, undoes. If this is red, ignore everything else. |
| `undo.spec.js` | Undo availability **per input device**. Mouse, stylus and finger take different code paths. |
| `timeline.spec.js` | Frame navigation, scrubber/cell alignment, add-frame semantics, orientation flips. |
| `popups.spec.js` | Every floating panel opens fully on screen and anchored to its trigger. |
| `layout.spec.js` | Touch target sizes, focus mode, safe-area insets, no horizontal overflow. |
| `exports.spec.js` | All export formats deliver files; project save/load round-trips; no export shelf. |
| `memory.spec.js` | Lazy frame buffers: every tool materialises before writing, reclaim never eats artwork. |
| `selection.spec.js` | Marquee, lasso, delete, cut/copy/paste, flip, fill, scale, rotate, copy-to-next-frame. |
| `visual.spec.js` | 24 pixel baselines. Local only — skipped in CI, since font rasterisation is not portable. |

## Traps worth knowing before you add a test

**`window.layers` is always `undefined`.** The app's top-level state uses `let`,
which creates global *lexical* bindings, not properties of `window`. Inside
`page.evaluate` use the bare identifier (`layers`, `curFrame`, `TLFW`); reaching
through `window` silently yields `undefined` and your assertion passes for the
wrong reason.

**`fps` is not global either** — `saveProject` reads it from `#fps-sel` on each
call. Read the input.

**`doExport(fmt, scale, bg, quality, fps)` needs its `scale`.** Call it with one
argument and `W`/`H` become `NaN`; `toDataURL` quietly returns something while
`getImageData` throws.

**Real format ids are `png-single`, `jpg-single`, `png-sheet`, `png-seq`,
`jpg-seq`, `gif`, `video`.** `'sheet'` matches nothing and fails silently — the
export simply does not happen and no error is raised.

**Mouse input is not a substitute for touch.** `page.mouse` produces pointer
events with `pointerType: 'mouse'`; finger input goes through a separate
`touchend` path. Use `H.inkTouch()` (CDP) for the touch path. An undo bug lived
in the pointer path precisely because only one device was ever exercised.

**A selection tightens to its content, not to the marquee you dragged.** So
flipping a symmetric shape inside its own bounds is correctly a no-op, and a
test that expects movement will fail against working code. Use an asymmetric
shape.

**Paste is a floating selection.** `selPaste()` does not put pixels in the
frame; `clearSelection()` commits them. Reading the frame straight after a paste
returns zero, which looks exactly like data loss and is not.

**Writes no longer need to go through `_wf()` to be safe** — a deferred frame's
context materialises on any touch that could draw. `_wf()` is still the clearer
way to say "I am about to write", but forgetting it is no longer destructive.

**Popup placement needs a real assertion.** `toBeVisible()` passes for a panel
stranded at `left: 0, top: 0`, which is the exact signature of measuring a
detached anchor. Use `H.expectOnScreen()`.

## Adding a regression test

Write the test, then **confirm it fails without the fix** — stash the source
change, run it, expect red, restore:

```bash
git stash push -- web/frame-twelve.html
npm test -- undo          # should fail
git stash pop
npm test -- undo          # should pass
```

A test that has never been seen to fail is documentation, not a test.
