import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "./manifest";

describe("plugin entrypoint", () => {
  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(window, "registerPlugin");
  });

  it("registers the plugin on load", async () => {
    const registerPlugin = vi.fn();
    window.registerPlugin = registerPlugin;

    await import("./index");

    expect(registerPlugin).toHaveBeenCalledTimes(1);
    expect(registerPlugin).toHaveBeenCalledWith(
      manifest.id,
      expect.any(Object),
    );
  });
});
