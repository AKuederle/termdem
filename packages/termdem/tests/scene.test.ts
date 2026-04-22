import { createElement, Fragment } from "react";
import { expect, test } from "vite-plus/test";
import { Pane, Stage, collectPaneDefinitions } from "../src/scene.ts";

test("collectPaneDefinitions resolves panes by name in declaration order", () => {
  const scene = createElement(
    Stage,
    null,
    createElement(
      Fragment,
      null,
      createElement(Pane, {
        name: "main",
        className: "terminal-surface",
      }),
      createElement(Fragment, null, createElement(Pane, { name: "side" })),
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

test("collectPaneDefinitions rejects custom components inside stage scenes", () => {
  const scene = createElement(Stage, null, createElement(Sidebar));

  expect(() => collectPaneDefinitions(scene)).toThrowError(
    "Custom React components are not supported inside Stage scenes",
  );
});

function Sidebar() {
  return createElement(Pane, { name: "side" });
}
