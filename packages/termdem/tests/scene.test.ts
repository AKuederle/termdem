import { createContext, createElement, Fragment, Profiler, StrictMode, Suspense } from "react";
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

test("collectPaneDefinitions resolves panes from terminal handles", () => {
  const scene = createElement(Stage, null, createElement(Pane, { terminal: { name: "main" } }));

  expect(collectPaneDefinitions(scene)).toEqual([
    {
      className: undefined,
      name: "main",
      style: undefined,
    },
  ]);
});

test("collectPaneDefinitions rejects panes without name or terminal", () => {
  const scene = createElement(Stage, null, createElement(Pane, {}));

  expect(() => collectPaneDefinitions(scene)).toThrowError("Pane nodes require a name or terminal");
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

test("collectPaneDefinitions allows standard React wrapper elements", () => {
  const SceneContext = createContext<null>(null);
  const scene = createElement(
    Stage,
    null,
    createElement(
      StrictMode,
      null,
      createElement(
        SceneContext.Provider,
        {
          value: null,
        },
        createElement(Pane, { name: "wrapped" }),
      ),
    ),
  );

  expect(collectPaneDefinitions(scene)).toEqual([
    {
      className: undefined,
      name: "wrapped",
      style: undefined,
    },
  ]);
});

test("collectPaneDefinitions allows Profiler wrappers", () => {
  const scene = createElement(
    Stage,
    null,
    createElement(
      Profiler,
      {
        id: "scene",
        onRender() {},
      },
      createElement(Pane, { name: "profiled" }),
    ),
  );

  expect(collectPaneDefinitions(scene)).toEqual([
    {
      className: undefined,
      name: "profiled",
      style: undefined,
    },
  ]);
});

test("collectPaneDefinitions rejects unsupported React wrappers with pane-bearing fallback props", () => {
  const scene = createElement(
    Stage,
    null,
    createElement(
      Suspense,
      {
        fallback: createElement(Pane, { name: "fallback" }),
      },
      null,
    ),
  );

  expect(() => collectPaneDefinitions(scene)).toThrowError(
    "Custom React components are not supported inside Stage scenes",
  );
});

function Sidebar() {
  return createElement(Pane, { name: "side" });
}
