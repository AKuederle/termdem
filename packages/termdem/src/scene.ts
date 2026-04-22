import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  Profiler,
  StrictMode,
  type ReactElement,
  type ReactNode,
} from "react";

export type PaneStyle = Record<string, number | string>;

export type StageProps = {
  children?: ReactNode;
};

export type PaneProps = {
  name: string;
  className?: string;
  style?: PaneStyle;
};

export type PaneDefinition = {
  name: string;
  className?: string;
  style?: PaneStyle;
};

type PaneElement = ReactElement<PaneProps, typeof Pane>;
type SceneElement = ReactElement<{ children?: ReactNode }>;

export function Stage({ children }: StageProps) {
  return children ?? null;
}

export function Pane(_props: PaneProps) {
  return null;
}

export function collectPaneDefinitions(scene: ReactNode) {
  const panes: PaneDefinition[] = [];
  const seenNames = new Set<string>();

  walkScene(scene, (element) => {
    const pane = paneDefinitionFromElement(element);
    if (seenNames.has(pane.name)) {
      throw new Error(`Duplicate pane name "${pane.name}"`);
    }

    seenNames.add(pane.name);
    panes.push(pane);
  });

  return panes;
}

export function renderStageScene(
  scene: ReactNode,
  renderPane: (pane: PaneDefinition) => ReactNode,
): ReactNode {
  const seenNames = new Set<string>();

  return transformScene(scene, (element) => {
    const pane = paneDefinitionFromElement(element);
    if (seenNames.has(pane.name)) {
      throw new Error(`Duplicate pane name "${pane.name}"`);
    }

    seenNames.add(pane.name);
    return renderPane(pane);
  });
}

function walkScene(node: ReactNode, visitPane: (pane: PaneElement) => void) {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) {
      return;
    }

    const element = child as SceneElement;
    assertSupportedSceneElement(element);
    if (element.type === Pane) {
      assertPaneIsLeaf(element);
      visitPane(element as PaneElement);
      return;
    }

    walkScene(element.props.children, visitPane);
  });
}

function transformScene(node: ReactNode, replacePane: (pane: PaneElement) => ReactNode): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement(child)) {
      return child;
    }

    const element = child as SceneElement;
    assertSupportedSceneElement(element);
    if (element.type === Pane) {
      assertPaneIsLeaf(element);
      return replacePane(element as PaneElement);
    }

    const children = transformScene(element.props.children, replacePane);
    return cloneElement(element, undefined, children);
  });
}

function paneDefinitionFromElement(element: PaneElement): PaneDefinition {
  return {
    name: element.props.name,
    className: element.props.className,
    style: element.props.style,
  };
}

function assertPaneIsLeaf(element: SceneElement) {
  if (Children.count(element.props.children) === 0) {
    return;
  }

  throw new Error("Pane nodes cannot have children");
}

function assertSupportedSceneElement(element: SceneElement) {
  if (
    element.type === Pane ||
    element.type === Stage ||
    typeof element.type === "string" ||
    isSupportedSymbolWrapper(element.type) ||
    isContextWrapperType(element.type)
  ) {
    return;
  }

  throw new Error("Custom React components are not supported inside Stage scenes");
}

function isContextWrapperType(value: unknown) {
  if (typeof value !== "object" || value === null || !("$$typeof" in value)) {
    return false;
  }

  const kind = value.$$typeof;
  return kind === Symbol.for("react.context") || kind === Symbol.for("react.provider");
}

function isSupportedSymbolWrapper(value: unknown) {
  return value === Fragment || value === Profiler || value === StrictMode;
}
