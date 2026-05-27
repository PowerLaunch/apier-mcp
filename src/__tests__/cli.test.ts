import { describe, it, expect } from "vitest";
import { buildChildEnv } from "../cli.js";

describe("buildChildEnv — env scrubbing", () => {
  it("strips APIER_API_KEY from the child environment", () => {
    const parent = { APIER_API_KEY: "apier_live_dummy_key", PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.APIER_API_KEY).toBeUndefined();
    expect(child.PATH).toBe("/usr/bin");
  });

  it("strips any env var whose name contains TOKEN/SECRET/BEARER/KEY/PASSWORD/CREDENTIAL", () => {
    const parent = {
      GITHUB_TOKEN: "ghp_abc", MY_SECRET: "x", AUTH_BEARER: "x",
      SOMETHING_KEY: "x", DB_PASSWORD: "x", AWS_CREDENTIAL: "x",
      PATH: "/usr/bin",
    } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.GITHUB_TOKEN).toBeUndefined();
    expect(child.MY_SECRET).toBeUndefined();
    expect(child.AUTH_BEARER).toBeUndefined();
    expect(child.SOMETHING_KEY).toBeUndefined();
    expect(child.DB_PASSWORD).toBeUndefined();
    expect(child.AWS_CREDENTIAL).toBeUndefined();
    expect(child.PATH).toBe("/usr/bin");
  });

  it("passes through PATH, HOME, USER, LANG, TMPDIR", () => {
    const parent = {
      PATH: "/usr/bin", HOME: "/home/u", USER: "u",
      LANG: "en_US.UTF-8", TMPDIR: "/tmp",
    } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.PATH).toBe("/usr/bin");
    expect(child.HOME).toBe("/home/u");
    expect(child.USER).toBe("u");
    expect(child.LANG).toBe("en_US.UTF-8");
    expect(child.TMPDIR).toBe("/tmp");
  });

  it("passes through HTTP_PROXY / HTTPS_PROXY / NO_PROXY (lower + upper case)", () => {
    const parent = {
      HTTP_PROXY: "http://p:3128", HTTPS_PROXY: "http://p:3128", NO_PROXY: "localhost",
      http_proxy: "http://p:3128", https_proxy: "http://p:3128", no_proxy: "localhost",
    } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.HTTP_PROXY).toBe("http://p:3128");
    expect(child.https_proxy).toBe("http://p:3128");
    expect(child.no_proxy).toBe("localhost");
  });

  it("passes through MCP_REMOTE_CONFIG_DIR (needed by mcp-remote)", () => {
    const parent = { MCP_REMOTE_CONFIG_DIR: "/tmp/mcp-auth", PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.MCP_REMOTE_CONFIG_DIR).toBe("/tmp/mcp-auth");
  });

  it("passes through LC_* locale vars", () => {
    const parent = { LC_ALL: "en_US.UTF-8", LC_TIME: "nb_NO.UTF-8", PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.LC_ALL).toBe("en_US.UTF-8");
    expect(child.LC_TIME).toBe("nb_NO.UTF-8");
  });

  it("defaults to deny for unknown vars not matching any allow rule", () => {
    const parent = { RANDOM_THING: "x", PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.RANDOM_THING).toBeUndefined();
    expect(child.PATH).toBe("/usr/bin");
  });

  it("does not mutate the parent env object", () => {
    const parent = { APIER_API_KEY: "apier_live_x", PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    const before = { ...parent };
    buildChildEnv(parent);
    expect(parent).toEqual(before);
  });
});

describe("redaction patterns", () => {
  it("redactor source contains the expected secret patterns", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("../cli.ts", import.meta.url), "utf8");
    expect(src).toMatch(/Bearer\\s\+/);
    expect(src).toMatch(/apier_\(live\|test\)_/);
    expect(src).toMatch(/ghp_/);
    expect(src).toMatch(/Authorization:/);
  });
});
