import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OpenInTracesButton, OpenErrorsInLogsButton } from "../DrilldownButtons";

describe("OpenInTracesButton", () => {
  it("renders a link with correct href", () => {
    render(
      <OpenInTracesButton href="/observability?tab=traces&sessionId=s1" />,
    );
    const link = screen.getByRole("link", { name: /open in traces/i });
    expect(link).toHaveAttribute(
      "href",
      "/observability?tab=traces&sessionId=s1",
    );
  });
});

describe("OpenErrorsInLogsButton", () => {
  it("renders a link with correct href", () => {
    render(
      <OpenErrorsInLogsButton href="/observability?tab=logs&status=error" />,
    );
    const link = screen.getByRole("link", { name: /view errors/i });
    expect(link).toHaveAttribute(
      "href",
      "/observability?tab=logs&status=error",
    );
  });
});
