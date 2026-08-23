import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { driftedFrom, scriptOf } from "./script.ts";

describe("which writing system a sentence is in", () => {
	it("reads the scripts that show", () => {
		assert.equal(scriptOf("Found capPreviewLines in render-utils.ts"), "latin");
		assert.equal(scriptOf("列出扩展目录下的包"), "han");
		assert.equal(scriptOf("설치 수치 비교 완료"), "hangul");
		assert.equal(scriptOf("数字を同期間で比較した"), "kana");
		assert.equal(scriptOf("Сравнил показатели"), "cyrillic");
	});

	it("reads Japanese as Japanese, though most of it is Han", () => {
		// Japanese writes Han characters alongside kana, usually more of them.
		// Counting which appears most reads the sentence as Chinese, so a
		// session held in Chinese would never notice the drift.
		assert.equal(scriptOf("数字を同期間で比較した"), "kana");
		assert.equal(driftedFrom("帮我看看这个", "数字を同期間で比較した"), true);
	});

	it("is not confused by the identifiers inside a sentence", () => {
		// A summary names files and flags whatever language it is in, and those
		// are Latin everywhere. The prose has to outweigh them.
		assert.equal(scriptOf("在 tool-blocks/summary/noting.ts 里加了 try/catch"), "han");
		assert.equal(scriptOf("leaffold의 Sales & Trends와 Analytics 비교"), "hangul");
	});

	it("has no answer for text with no letters in it", () => {
		assert.equal(scriptOf(""), undefined);
		assert.equal(scriptOf("233 / 58 -> 25%"), undefined);
	});

	it("does not try to tell two languages sharing an alphabet apart", () => {
		// That is what a detector cannot do, and why the writer is asked for the
		// language rather than told it. Nothing about that case is jarring
		// enough to spend a request on.
		assert.equal(scriptOf("Comparé las cifras de ventas"), "latin");
		assert.equal(scriptOf("Compared the sales figures"), "latin");
		assert.equal(driftedFrom("Compared the sales figures", "Comparé las cifras"), false);
	});
});

describe("noticing that a sentence changed alphabet", () => {
	it("catches the failure that shows", () => {
		// A session held in English, a summary in Hangul. Five in sixty on the
		// block that raised it.
		assert.equal(driftedFrom("now search and lookup docs of apple", "설치 수치 비교 완료"), true);
		assert.equal(driftedFrom("我问问题是英语", "Compared the figures"), true);
	});

	it("leaves a matching pair alone", () => {
		assert.equal(driftedFrom("now search and lookup docs", "Compared the figures"), false);
		assert.equal(driftedFrom("帮我看看这个", "列出扩展目录下的包"), false);
	});

	it("says nothing when there is nothing to compare", () => {
		// A session with nothing said in it has no reader to match, and a
		// sentence made only of numbers has no script.
		assert.equal(driftedFrom("", "설치 수치 비교"), false);
		assert.equal(driftedFrom("hello", "233 / 58"), false);
	});
});
