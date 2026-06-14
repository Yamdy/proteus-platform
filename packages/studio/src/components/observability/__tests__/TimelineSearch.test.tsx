import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import TimelineSearch from "../TimelineSearch";

describe("TimelineSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders search input and clear button", () => {
    render(<TimelineSearch value="" onChange={() => {}} />);
    expect(screen.getByPlaceholderText("Search spans...")).toBeInTheDocument();
  });

  it("calls onChange with debounced value after 300ms", () => {
    const onChange = vi.fn();
    render(<TimelineSearch value="" onChange={onChange} />);

    const input = screen.getByPlaceholderText("Search spans...");
    fireEvent.change(input, { target: { value: "web" } });

    // Not called immediately
    expect(onChange).not.toHaveBeenCalled();

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onChange).toHaveBeenCalledWith("web");
  });

  it("clears input and calls onChange with empty string when clear is clicked", () => {
    const onChange = vi.fn();
    render(<TimelineSearch value="search-term" onChange={onChange} />);

    const clearButton = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clearButton);

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shows clear button only when value is non-empty", () => {
    const { rerender } = render(
      <TimelineSearch value="" onChange={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();

    rerender(<TimelineSearch value="test" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /clear/i })).toBeInTheDocument();
  });
});
