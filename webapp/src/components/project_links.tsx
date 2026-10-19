import React from "react";

export function ProjectLinks() {
  return (
    <section className="icoretech-plugin-links" aria-label="Project links">
      <span className="icoretech-plugin-links__group">
        Follow on X:{" "}
        <a
          href="https://x.com/icoretech_inc"
          target="_blank"
          rel="noopener noreferrer"
        >
          @icoretech_inc
        </a>
      </span>
      <span className="icoretech-plugin-links__group">
        Star on GitHub:{" "}
        <a
          href="https://github.com/icoretech/mattermost-timeline"
          target="_blank"
          rel="noopener noreferrer"
        >
          icoretech/mattermost-timeline
        </a>
      </span>
    </section>
  );
}
