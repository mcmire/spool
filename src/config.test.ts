import { test, expect, describe } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findProjectRoot, loadConfig } from "./config.ts";
import { withTempDir } from "../tests/helpers.ts";

async function writeConfig(dir: string, content: unknown): Promise<void> {
  await writeFile(join(dir, "spool.json"), JSON.stringify(content), "utf-8");
}

describe("findProjectRoot", () => {
  describe("when spool.json exists in the start directory", () => {
    test("returns the start directory", () =>
      withTempDir(async (root) => {
        await writeConfig(root, {});

        expect(findProjectRoot(root)).toBe(root);
      }));
  });

  describe("when spool.json exists in a parent directory", () => {
    test("returns the ancestor directory containing spool.json", () =>
      withTempDir(async (root) => {
        await writeConfig(root, {});
        const child = join(root, "a", "b", "c");
        await mkdir(child, { recursive: true });

        expect(findProjectRoot(child)).toBe(root);
      }));
  });

  describe("when spool.json does not exist in the start directory or any parent", () => {
    test("throws an error", () =>
      withTempDir(async (root) => {
        expect(() => findProjectRoot(root)).toThrow("Could not find spool.json");
      }));
  });
});

describe("loadConfig", () => {
  describe("when source.code is a string", () => {
    test("returns a config with code set to that string and no excludeFromCode", () =>
      withTempDir(async (root) => {
        await writeConfig(root, { source: { code: "src", docs: "docs" }, target: "out" });

        const config = await loadConfig(root);

        expect(config).toEqual({
          source: { code: "src", docs: "docs", excludeFromCode: undefined },
          target: "out",
        });
      }));
  });

  describe("when source.code is an array with only the base path", () => {
    test("returns a config with code set to the first element and no excludeFromCode", () =>
      withTempDir(async (root) => {
        await writeConfig(root, { source: { code: ["src"], docs: "docs" }, target: "out" });

        const config = await loadConfig(root);

        expect(config).toEqual({
          source: { code: "src", docs: "docs", excludeFromCode: undefined },
          target: "out",
        });
      }));
  });

  describe("when source.code is an array with negation patterns", () => {
    test("sets excludeFromCode to the patterns with the leading ! stripped", () =>
      withTempDir(async (root) => {
        await writeConfig(root, {
          source: { code: ["src", "!**/*.test.ts", "!**/*.spec.ts"], docs: "docs" },
          target: "out",
        });

        const config = await loadConfig(root);

        expect(config.source.code).toBe("src");
        expect(config.source.excludeFromCode).toEqual(["**/*.test.ts", "**/*.spec.ts"]);
      }));
  });

  describe("when source.code is an array with non-negation entries after the first", () => {
    test("ignores them and sets no excludeFromCode", () =>
      withTempDir(async (root) => {
        await writeConfig(root, {
          source: { code: ["src", "other"], docs: "docs" },
          target: "out",
        });

        const config = await loadConfig(root);

        expect(config.source.code).toBe("src");
        expect(config.source.excludeFromCode).toBeUndefined();
      }));
  });

  describe("when the source field is missing", () => {
    test("throws an error", () =>
      withTempDir(async (root) => {
        await writeConfig(root, { target: "out" });

        expect(loadConfig(root)).rejects.toThrow("Missing or invalid fields in spool.json");
      }));
  });

  describe("when source.docs is missing", () => {
    test("throws an error", () =>
      withTempDir(async (root) => {
        await writeConfig(root, { source: { code: "src" }, target: "out" });

        expect(loadConfig(root)).rejects.toThrow("Missing or invalid fields in spool.json");
      }));
  });

  describe("when target is missing", () => {
    test("throws an error", () =>
      withTempDir(async (root) => {
        await writeConfig(root, { source: { code: "src", docs: "docs" } });

        expect(loadConfig(root)).rejects.toThrow("Missing or invalid fields in spool.json");
      }));
  });

  describe("when source.code is missing", () => {
    test("throws an error", () =>
      withTempDir(async (root) => {
        await writeConfig(root, { source: { docs: "docs" }, target: "out" });

        expect(loadConfig(root)).rejects.toThrow(
          'Missing or invalid "source.code" in spool.json',
        );
      }));
  });

  describe("when source.code is an empty array", () => {
    test("throws an error", () =>
      withTempDir(async (root) => {
        await writeConfig(root, { source: { code: [], docs: "docs" }, target: "out" });

        expect(loadConfig(root)).rejects.toThrow(
          'Missing or invalid "source.code" in spool.json',
        );
      }));
  });

  describe("when the config file contains invalid JSON", () => {
    test("throws an error", () =>
      withTempDir(async (root) => {
        await writeFile(join(root, "spool.json"), "{ not valid json", "utf-8");

        expect(loadConfig(root)).rejects.toThrow();
      }));
  });

  describe("when the config file does not exist", () => {
    test("throws an error", () =>
      withTempDir(async (root) => {
        expect(loadConfig(root)).rejects.toThrow();
      }));
  });
});
