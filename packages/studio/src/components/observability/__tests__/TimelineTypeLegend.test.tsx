import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TimelineTypeLegend from "../TimelineTypeLegend";

describe("TimelineTypeLegend", () => {
  const spanTypes = ["llm", "tool", "retrieval", "http"];

  it("renders all span type entries", () => {
    render(
      <TimelineTypeLegend
        spanTypes={spanTypes}
        fadedTypes={new Set()}
        onToggleType={() => {}}
        onShowAll={() => {}}
      />,
    );

    expect(screen.getByText("llm")).toBeInTheDocument();
    expect(screen.getByText("tool")).toBeInTheDocument();
    expect(screen.getByText("retrieval")).toBeInTheDocument();
    expect(screen.getByText("http")).toBeInTheDocument();
  });

  it("calls onToggleType when a type entry is clicked", () => {
    const onToggleType = vi.fn();
    render(
      <TimelineTypeLegend
        spanTypes={spanTypes}
        fadedTypes={new Set()}
        onToggleType={onToggleType}
        onShowAll={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("tool"));
    expect(onToggleType).toHaveBeenCalledWith("tool");
  });

  it("shows 'Show all' button when there are faded types", () => {
    render(
      <TimelineTypeLegend
        spanTypes={spanTypes}
        fadedTypes={new Set(["llm", "tool"])}
        onToggleType={() => {}}
        onShowAll={() => {}}
      />,
    );

    expect(screen.getByText("Show all")).toBeInTheDocument();
  });

  it("hides 'Show all' button when no types are faded", () => {
    render(
      <TimelineTypeLegend
        spanTypes={spanTypes}
        fadedTypes={new Set()}
        onToggleType={() => {}}
        onShowAll={() => {}}
      />,
    );

    expect(screen.queryByText("Show all")).not.toBeInTheDocument();
  });

  it("calls onShowAll when 'Show all' is clicked", () => {
    const onShowAll = vi.fn();
    render(
      <TimelineTypeLegend
        spanTypes={spanTypes}
        fadedTypes={new Set(["llm"])}
        onToggleType={() => {}}
        onShowAll={onShowAll}
      />,
    );

    fireEvent.click(screen.getByText("Show all"));
    expect(onShowAll).toHaveBeenCalled();
  });

  it("applies faded styling to faded type entries", () => {
    render(
      <TimelineTypeLegend
        spanTypes={spanTypes}
        fadedTypes={new Set(["tool"])}
        onToggleType={() => {}}
        onShowAll={() => {}}
      />,
    );

    const toolEntry = screen.getByText("tool").closest("[data-type-entry]");
    expect(toolEntry).toHaveClass("opacity-30");
  });

  it("does not apply faded styling to active type entries", () => {
    render(
      <TimelineTypeLegend
        spanTypes={spanTypes}
        fadedTypes={new Set(["tool"])}
        onToggleType={() => {}}
        onShowAll={() => {}}
      />,
    );

    const llmEntry = screen.getByText("llm").closest("[data-type-entry]");
    expect(llmEntry).not.toHaveClass("opacity-30");
  });
});
