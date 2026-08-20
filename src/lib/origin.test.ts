import { afterEach, describe, expect, it } from "vitest";
import { publicOrigin } from "./origin";

const original = process.env.PUBLIC_BASE_URL;
afterEach(() => {
  if (original === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = original;
});

describe("publicOrigin", () => {
  it("falls back to the request origin when unset", () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(publicOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("overrides the request origin when set", () => {
    // This is the case that matters: Vercel Cron calls the deployment's own
    // hostname, so without the override every scheduled email would link
    // players to a URL they have never seen.
    process.env.PUBLIC_BASE_URL = "https://novasurvivorleague.com";
    expect(publicOrigin("https://survivorleague-mu.vercel.app")).toBe(
      "https://novasurvivorleague.com",
    );
  });

  it("strips a trailing slash rather than emitting a double slash", () => {
    process.env.PUBLIC_BASE_URL = "https://novasurvivorleague.com/";
    expect(publicOrigin("http://localhost:3000")).toBe("https://novasurvivorleague.com");
  });

  it("ignores an empty or whitespace value", () => {
    process.env.PUBLIC_BASE_URL = "   ";
    expect(publicOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });
});
