import { expect, test } from "vite-plus/test";
import { normalizeExecCapture } from "../src/index.ts";

test("normalizeExecCapture removes markers, ansi, prompt noise, and trailing blank lines", () => {
  const result = normalizeExecCapture(
    [
      "\u001eTD_BEGIN:step-1\u001e",
      "\u001b[32mfirst.txt\u001b[0m\n",
      "loading\rloaded\n",
      "\n",
      "(alpha) /repo $ ",
      "\u001eTD_END:step-1:0\u001e",
    ].join(""),
    {
      promptPattern: /^\(alpha\) \/repo \$ $/u,
    },
  );

  expect(result.text).toBe("first.txt\nloaded");
  expect(result.lines).toEqual(["first.txt", "loaded"]);
});

test("normalizeExecCapture keeps raw text available while pruning empty trailing lines", () => {
  const raw = "README.md\nsrc\n\n\n";

  const result = normalizeExecCapture(raw);

  expect(result.raw).toBe(raw);
  expect(result.text).toBe("README.md\nsrc");
  expect(result.lines).toEqual(["README.md", "src"]);
});
