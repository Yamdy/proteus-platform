import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { MetricsProvider } from "../../../hooks/useMetricsFilters";
import DatePresetSelector from "../DatePresetSelector";

function renderWithProviders(ui: React.ReactElement, initialUrl = "/observability") {
  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[initialUrl]}>
        <MetricsProvider>{children}</MetricsProvider>
      </MemoryRouter>
    ),
  });
}

describe("DatePresetSelector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders all preset options", () => {
    renderWithProviders(<DatePresetSelector />);
    expect(screen.getByTestId("date-preset-selector")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "24h" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "3d" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "7d" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "14d" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "30d" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Custom" })).toBeInTheDocument();
  });

  it("defaults to 7d selection", () => {
    renderWithProviders(<DatePresetSelector />);
    const select = screen.getByTestId("preset-select");
    expect(select).toHaveValue("7d");
  });

  it("selects preset from URL", () => {
    renderWithProviders(<DatePresetSelector />, "/observability?preset=3d");
    const select = screen.getByTestId("preset-select");
    expect(select).toHaveValue("3d");
  });

  it("shows custom date inputs when Custom is selected", () => {
    renderWithProviders(<DatePresetSelector />);
    const select = screen.getByTestId("preset-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "custom" } });
    expect(screen.getByTestId("custom-range-from")).toBeInTheDocument();
    expect(screen.getByTestId("custom-range-to")).toBeInTheDocument();
  });

  it("does not show custom date inputs for non-custom preset", () => {
    renderWithProviders(<DatePresetSelector />);
    expect(screen.queryByTestId("custom-range-from")).not.toBeInTheDocument();
    expect(screen.queryByTestId("custom-range-to")).not.toBeInTheDocument();
  });
});
