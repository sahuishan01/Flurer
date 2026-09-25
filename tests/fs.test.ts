import { describe, test, expect } from "bun:test";
import { configureFilesystem, cleanDirPath, parentDir, baseName, pathSegments, resolvePath, joinPath, isPathWithin, nativeAbsolutePath } from "../src/lib/fs";

describe("native filesystem paths", () => {
  test("Linux roots, breadcrumbs, absolute and relative navigation", () => {
    configureFilesystem("linux", "/home/user");
    expect(cleanDirPath("/")).toBe("/");
    expect(parentDir("/home")).toBe("/");
    expect(parentDir("/")).toBe("/");
    expect(resolvePath("/home/user", "/etc")).toBe("/etc");
    expect(resolvePath("/home/user", "Documents")).toBe("/home/user/Documents");
    expect(joinPath("/", "notes")).toBe("/notes");
    expect(pathSegments("/home/user")).toEqual([
      { label: "/", path: "/" }, { label: "home", path: "/home" }, { label: "user", path: "/home/user" },
    ]);
    expect(nativeAbsolutePath("C:\\")).toBe(false);
  });
  test("Linux preserves case, backslashes, colons, and filename whitespace", () => {
    configureFilesystem("linux", "/home/user");
    expect(cleanDirPath("/tmp/name\\part ")).toBe("/tmp/name\\part ");
    expect(baseName("/tmp/name\\part")).toBe("name\\part");
    expect(parentDir("/tmp/name\\part")).toBe("/tmp");
    expect(isPathWithin("/home/User/file", "/home/user")).toBe(false);
    expect(isPathWithin("/home/user2", "/home/user")).toBe(false);
    expect(isPathWithin("/home/user", "/")).toBe(true);
    expect(joinPath("/tmp", "C:notes")).toBe("/tmp/C:notes");
  });
  test("Windows retains drive roots, UNC roots, and case-insensitive matching", () => {
    configureFilesystem("windows", "D:\\Users\\user");
    expect(cleanDirPath("D:/")).toBe("D:\\");
    expect(parentDir("D:\\notes")).toBe("D:\\");
    expect(parentDir("D:\\")).toBe("D:\\");
    expect(parentDir("\\\\server\\share")).toBe("\\\\server\\share");
    expect(resolvePath("D:\\Users", "notes")).toBe("D:\\Users\\notes");
    expect(isPathWithin("D:\\Users\\notes", "d:\\users")).toBe(true);
    expect(nativeAbsolutePath("/home/user")).toBe(false);
  });
});
