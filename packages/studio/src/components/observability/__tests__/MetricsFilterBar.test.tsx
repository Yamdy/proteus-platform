import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { MetricsProvider } from "../../../hooks/useMetricsFilters";
import MetricsFilterBar from "../MetricsFilterBar";

function renderWithProviders(ui: React.ReactElement, initialUrl = "/observability") {
  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[initialUrl]}>
        <MetricsProvider>{children}</MetricsProvider>
      </MemoryRouter>
    ),
  });
}

describe("MetricsFilterBar", () => {
  it("renders all filter inputs", () => {
    renderWithProviders(<MetricsFilterBar />);
    expect(screen.getByTestId("metrics-filter-bar")).toBeInTheDocument();
    expect(screen.getByTestId("filter-entity-type")).toBeInTheDocument();
    expect(screen.getByTestId("filter-entity-name")).toBeInTheDocument();
    expect(screen.getByTestId("filter-session-id")).toBeInTheDocument();
    expect(screen.getByTestId("filter-tags")).toBeInTheDocument();
    expect(screen.getByTestId("filter-apply")).toBeInTheDocument();
    expect(screen.getByTestId("filter-clear")).toBeInTheDocument();
  });

  it("populates inputs from URL filter params", () => {
    renderWithProviders(
      <MetricsFilterBar />,
      "/observability?entityType=tool&sessionId=sess-1",
    );
    expect(screen.getByTestId("filter-entity-type")).toHaveValue("tool");
    expect(screen.getByTestId("filter-session-id")).toHaveValue("sess-1");
  });

  it("clear button resets all inputs", () => {
    renderWithProviders(
      <MetricsFilterBar />,
      "/observability?entityType=tool",
    );
    fireEvent.click(screen.getByTestId("filter-clear"));
    expect(screen.getByTestId("filter-entity-type")).toHaveValue("");
  });
});
