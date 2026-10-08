import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "../test_utils";
import type { ReactionClientSummary, TimelineUser } from "../types/timeline";
import ReactionPill from "./reaction_pill";

describe("ReactionPill", () => {
  const summary: ReactionClientSummary = {
    count: 1,
    self: false,
    recent_users: ["user-1"],
  };

  const renderPill = (user: TimelineUser) =>
    renderToStaticMarkup(
      withIntl(
        React.createElement(ReactionPill, {
          icon: "eyes",
          summary,
          onToggle: () => undefined,
          onFetchUsers: async () => [],
          getUser: () => user,
        }),
      ),
    );

  it("uses the internal Mattermost avatar endpoint instead of avatar_url fallback", () => {
    const html = renderPill({
      username: "alice",
      avatar_url: "https://attacker.invalid/pixel.png",
      last_picture_update: 0,
    });

    expect(html).toContain('src="/api/v4/users/user-1/image"');
    expect(html).not.toContain("https://attacker.invalid/pixel.png");
  });

  it("adds a cache-buster when last_picture_update is present", () => {
    const html = renderPill({
      username: "alice",
      avatar_url: "https://attacker.invalid/pixel.png",
      last_picture_update: 123,
    });

    expect(html).toContain('src="/api/v4/users/user-1/image?_=123"');
    expect(html).not.toContain("https://attacker.invalid/pixel.png");
  });

  it.each([
    [1, "I've seen this: 1 reaction"],
    [2, "I've seen this: 2 reactions"],
  ])(
    "exposes the reaction meaning and count for %i reactions",
    (count, label) => {
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(
        withIntl(
          <ReactionPill
            icon="eyes"
            summary={{ ...summary, count, self: true }}
            onToggle={() => undefined}
            onFetchUsers={async () => []}
            getUser={() => undefined}
          />,
        ),
      );

      expect(
        container.querySelector("button")?.getAttribute("aria-label"),
      ).toBe(label);
      expect(
        container.querySelector("button")?.getAttribute("aria-pressed"),
      ).toBe("true");
    },
  );
});
