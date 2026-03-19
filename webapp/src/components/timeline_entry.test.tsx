import React, { type ReactElement } from "react";

import { renderMarkdown } from "./timeline_entry";

describe("renderMarkdown", () => {
  it("returns plain text unchanged", () => {
    const result = renderMarkdown("hello world");
    expect(result).toEqual(["hello world"]);
  });

  it("returns empty array for empty string", () => {
    const result = renderMarkdown("");
    expect(result).toEqual([]);
  });

  it("renders bold text", () => {
    const result = renderMarkdown("**bold**");
    expect(result).toHaveLength(1);
    const el = result[0] as ReactElement<{ children: string }>;
    expect(el.type).toBe("strong");
    expect(el.props.children).toBe("bold");
  });

  it("renders italic text", () => {
    const result = renderMarkdown("*italic*");
    expect(result).toHaveLength(1);
    const el = result[0] as ReactElement<{ children: string }>;
    expect(el.type).toBe("em");
    expect(el.props.children).toBe("italic");
  });

  it("renders inline code", () => {
    const result = renderMarkdown("`code`");
    expect(result).toHaveLength(1);
    const el = result[0] as ReactElement<{ children: string }>;
    expect(el.type).toBe("code");
    expect(el.props.children).toBe("code");
  });

  it("renders links", () => {
    const result = renderMarkdown("[click](https://example.com)");
    expect(result).toHaveLength(1);
    const el = result[0] as ReactElement<{
      href: string;
      children: string;
      target: string;
    }>;
    expect(el.type).toBe("a");
    expect(el.props.href).toBe("https://example.com");
    expect(el.props.children).toBe("click");
    expect(el.props.target).toBe("_blank");
  });

  it("renders newlines as br", () => {
    const result = renderMarkdown("line1\nline2");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("line1");
    const br = result[1] as ReactElement;
    expect(br.type).toBe("br");
    expect(result[2]).toBe("line2");
  });

  it("handles mixed markdown", () => {
    const result = renderMarkdown("hello **bold** and *italic*");
    expect(result.length).toBeGreaterThanOrEqual(4);
    expect(result[0]).toBe("hello ");
    expect((result[1] as ReactElement).type).toBe("strong");
    expect((result[3] as ReactElement).type).toBe("em");
  });
});
