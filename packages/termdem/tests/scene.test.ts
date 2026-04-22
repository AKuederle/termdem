import { createElement, type ReactNode } from "react";
import { expect, test } from "vite-plus/test";
import { Pane, Stage, collectPaneDefinitions } from "../src/scene.ts";

test("collectPaneDefinitions resolves panes by name in declaration order", () => {
  const scene = createElement(
    Stage,
    null,
    createElement(
      Stack,
      null,
      createElement(Pane, {
        name: "main",
        className: "terminal-surface",
      }),
      createElement(Stack, null, createElement(Pane, { name: "side" })),
    ),
  );

  expect(collectPaneDefinitions(scene)).toEqual([
    {
      className: "terminal-surface",
      name: "main",
      style: undefined,
    },
    {
      className: undefined,
      name: "side",
      style: undefined,
    },
  ]);
});

test("collectPaneDefinitions fails clearly on duplicate pane names", () => {
  const scene = createElement(
    Stage,
    null,
    createElement(Pane, { name: "main" }),
    createElement(Pane, { name: "main" }),
  );

  expect(() => collectPaneDefinitions(scene)).toThrowError('Duplicate pane name "main"');
});

function Stack({ children }: { children?: ReactNode }) {
  return children ?? null;
}
