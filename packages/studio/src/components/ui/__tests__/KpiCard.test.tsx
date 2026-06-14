import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  KpiCard,
  KpiCardLabel,
  KpiCardValue,
  KpiCardChange,
  KpiCardNoChange,
  KpiCardNoData,
  KpiCardError,
  KpiCardLoading,
} from "../KpiCard";

describe("KpiCard compound component", () => {
  describe("KpiCardRoot", () => {
    it("renders children inside a container", () => {
      render(
        <KpiCard>
          <span>child content</span>
        </KpiCard>
      );
      expect(screen.getByText("child content")).toBeInTheDocument();
    });
  });

  describe("KpiCardLabel", () => {
    it("renders the label text", () => {
      render(<KpiCardLabel>Agent Runs</KpiCardLabel>);
      expect(screen.getByText("Agent Runs")).toBeInTheDocument();
    });

    it("applies muted small text styling", () => {
      render(<KpiCardLabel>Test Label</KpiCardLabel>);
      const el = screen.getByText("Test Label");
      expect(el.className).toMatch(/text-xs/);
    });
  });

  describe("KpiCardValue", () => {
    it("renders the value text", () => {
      render(<KpiCardValue>1.2K</KpiCardValue>);
      expect(screen.getByText("1.2K")).toBeInTheDocument();
    });

    it("applies large bold styling", () => {
      render(<KpiCardValue>42</KpiCardValue>);
      const el = screen.getByText("42");
      expect(el.className).toMatch(/text-2xl/);
      expect(el.className).toMatch(/font-bold/);
    });
  });

  describe("KpiCardChange", () => {
    it("shows positive change with green color and TrendingUp icon", () => {
      const { container } = render(<KpiCardChange value={12.5} />);
      const text = screen.getByText(/\+12\.5%/);
      expect(text).toBeInTheDocument();
      expect(text.className).toMatch(/text-green/);
      // TrendingUp icon should be present (svg element)
      const svgs = container.querySelectorAll("svg");
      expect(svgs.length).toBeGreaterThan(0);
    });

    it("shows negative change with red color and TrendingDown icon", () => {
      const { container } = render(<KpiCardChange value={-8.3} />);
      const text = screen.getByText(/-8\.3%/);
      expect(text).toBeInTheDocument();
      expect(text.className).toMatch(/text-red/);
      const svgs = container.querySelectorAll("svg");
      expect(svgs.length).toBeGreaterThan(0);
    });

    it("includes 'vs previous' text", () => {
      render(<KpiCardChange value={5} />);
      expect(screen.getByText(/vs previous/)).toBeInTheDocument();
    });

    it("inverts colors when lowerIsBetter is true", () => {
      render(<KpiCardChange value={12.5} lowerIsBetter />);
      const text = screen.getByText(/\+12\.5%/);
      // With lowerIsBetter, positive change should be red (bad)
      expect(text.className).toMatch(/text-red/);
    });

    it("inverts negative to green when lowerIsBetter is true", () => {
      render(<KpiCardChange value={-8.3} lowerIsBetter />);
      const text = screen.getByText(/-8\.3%/);
      // With lowerIsBetter, negative change should be green (good)
      expect(text.className).toMatch(/text-green/);
    });
  });

  describe("KpiCardNoChange", () => {
    it("shows 'No change' text", () => {
      render(<KpiCardNoChange />);
      expect(screen.getByText("No change")).toBeInTheDocument();
    });

    it("renders a Minus icon", () => {
      const { container } = render(<KpiCardNoChange />);
      const svgs = container.querySelectorAll("svg");
      expect(svgs.length).toBeGreaterThan(0);
    });
  });

  describe("KpiCardNoData", () => {
    it("shows 'No data available' text", () => {
      render(<KpiCardNoData />);
      expect(screen.getByText("No data available")).toBeInTheDocument();
    });
  });

  describe("KpiCardError", () => {
    it("renders error message with red styling", () => {
      render(<KpiCardError message="Connection failed" />);
      const el = screen.getByText("Connection failed");
      expect(el).toBeInTheDocument();
      expect(el.className).toMatch(/text-red/);
    });
  });

  describe("KpiCardLoading", () => {
    it("renders a spinner", () => {
      const { container } = render(<KpiCardLoading />);
      // Spinner renders an animated div with animate-spin class
      const spinner = container.querySelector(".animate-spin");
      expect(spinner).toBeInTheDocument();
    });
  });

  describe("dot-notation usage", () => {
    it("works with KpiCard.Label, KpiCard.Value, KpiCard.Change", () => {
      render(
        <KpiCard>
          <KpiCard.Label>Token Usage</KpiCard.Label>
          <KpiCard.Value>4.5M</KpiCard.Value>
          <KpiCard.Change value={-3.2} />
        </KpiCard>
      );
      expect(screen.getByText("Token Usage")).toBeInTheDocument();
      expect(screen.getByText("4.5M")).toBeInTheDocument();
      expect(screen.getByText(/-3\.2%/)).toBeInTheDocument();
    });
  });
});
