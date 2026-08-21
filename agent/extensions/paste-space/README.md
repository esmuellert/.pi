# paste-space

Keep a pasted path from growing onto the one before it.

## The problem

Pasting an image writes a temp file and inserts its path at the cursor:

```js
// interactive-mode.js  handleClipboardPaste()
this.editor.insertTextAtCursor?.(filePath);
```

Nothing looks at what is already there, so two pastes in a row produce

```
/tmp/pi-clipboard-e58….png/tmp/moshi-paste-384….jpg
```

and both paths are ruined — the first grew a tail, the second lost its head.

It is not one terminal or one client. Every route into the editor ends at
`insertTextAtCursor`, and none of them spaces anything.

## What it does

Wraps that one method, so everything that inserts is covered and nothing about
the editor changes. `setEditorComponent` would have meant reimplementing the
whole input area for the sake of a space.

The editor comes from `tui.getFocusedComponent()` — pi focuses it at startup
and returns focus to it after every dialog. The TUI itself comes from a widget
factory, which is the only place an extension is handed it; the widget draws
nothing and is removed as soon as it has served.

## What it does not do

**It does not look at the text.** A path, a word and a sentence all need the
same gap. Deciding from the content which is which is how a rule like this
starts mangling ordinary typing.

**It does not reach past the current line.** pi's own insertion works on
`state.lines[cursorLine]` sliced at `cursorCol`, so anything wider would answer
a different question than the one being asked.

**It does not guess.** If the cursor cannot be located, the text is inserted
exactly as asked. If there is no method to wrap, that is reported — silence
there has the same symptom as the bug.

## Held by tests

15 of them, including: a space appears between two things that would touch and
nowhere else, both ends are separated when the insertion lands mid-word, a
newline counts as a separator, wrapping twice does not stack, and an editor
that cannot say where its cursor is gets its text through unchanged.
