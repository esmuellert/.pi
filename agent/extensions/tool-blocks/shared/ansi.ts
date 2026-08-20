/**
 * Reading text that carries SGR sequences.
 *
 * Three places needed the same "what would this look like without colour"
 * question answered, and each had written the pattern out again. A regex
 * repeated is a regex that drifts.
 *
 * pi-tui's `visibleWidth` answers the width question and is used directly
 * wherever that is what is wanted; this is for the cases that need the text.
 */

const SGR = /\u001b\[[0-9;]*m/g;

/** The text as it would read with no colour applied. */
export const plain = (text: string): string => text.replace(SGR, "");

/** True when a line carries no visible text, whatever colour it is painted. */
export const blank = (line: string): boolean => plain(line).trim() === "";
