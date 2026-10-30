import { afterEach, describe, expect, it } from "vitest";
import "cm/supportedModes";
import {
	addMode,
	getFormatAsMode,
	getModeForPath,
	getModes,
	removeMode,
} from "cm/modelist";

function getModeSpecificityScore(modeInstance) {
	if (modeInstance.name.toLowerCase() === "text") {
		return 0;
	}

	const extensionsStr = modeInstance.extensions;
	let maxScore = 0;

	if (extensionsStr) {
		const patterns = extensionsStr.split("|");
		for (const pattern of patterns) {
			let currentScore = 0;
			if (pattern.startsWith("^")) {
				currentScore = 1000 + (pattern.length - 1);
			} else {
				currentScore = pattern.length;
			}
			if (currentScore > maxScore) {
				maxScore = currentScore;
			}
		}
	}

	for (const matcher of modeInstance.filenameMatchers) {
		const score = 1000 + matcher.source.length;
		if (score > maxScore) {
			maxScore = score;
		}
	}

	return maxScore;
}

function legacyGetModeForPath(path) {
	const modes = getModes();
	let mode = modes.find((entry) => entry.name === "text");
	const fileName = path.split(/[/\\]/).pop() || "";

	const sortedModes = [...modes].sort((a, b) => {
		const scoreDiff = getModeSpecificityScore(b) - getModeSpecificityScore(a);
		if (scoreDiff !== 0) return scoreDiff;
		return modes.indexOf(b) - modes.indexOf(a);
	});

	for (const iMode of sortedModes) {
		if (iMode.supportsFile?.(fileName)) {
			mode = iMode;
			break;
		}
	}
	return mode;
}

function collectParityPaths() {
	const paths = new Set([
		"",
		"README",
		".gitignore",
		".env",
		"Dockerfile",
		"dockerfile",
		"MAKEFILE",
		"Makefile",
		"CMakeLists.txt",
		"Gemfile",
		"Rakefile",
		"BUILD",
		"BUCK",
		"Jenkinsfile",
		"nginx.conf",
		"sites-enabled/nginx.proxy.conf",
		"yarn.lock",
		"Cargo.lock",
		"poetry.lock",
		"package.json",
		"tsconfig.json",
		"foo.text",
		"notes.txt",
		"file.d.ts",
		"file.ts",
		"app.test.js",
		"app.js",
		"APP.JS",
		"src/components/Button.tsx",
		"C:\\Users\\dev\\main.py",
		"folder/sub/file.unknownext",
		"example.html ",
		".bashrc",
		".prettierrc",
		"bun.lock",
		"file.astro",
		"game.luau",
	]);

	for (const mode of getModes()) {
		if (mode.extensions) {
			for (const raw of mode.extensions.split("|")) {
				const pattern = raw.trim();
				if (!pattern) continue;
				if (pattern.startsWith("^")) {
					paths.add(pattern.slice(1));
					paths.add(`/tmp/${pattern.slice(1)}`);
				} else {
					paths.add(`sample.${pattern}`);
					paths.add(`nested/dir/sample.${pattern}`);
				}
			}
		}
		for (const matcher of mode.filenameMatchers) {
			const source = matcher.source;
			if (
				source.startsWith("^") &&
				source.endsWith("$") &&
				!/[|()[*+?]/.test(source.slice(1, -1).replace(/\\./g, ""))
			) {
				const name = source.slice(1, -1).replace(/\\(.)/g, "$1");
				if (name) paths.add(name);
			}
		}
	}

	return [...paths];
}

const addedModes = [];

afterEach(() => {
	while (addedModes.length) {
		removeMode(addedModes.pop());
	}
});

function registerTestMode(name, extensions, options) {
	addMode(name, extensions, name, null, options);
	addedModes.push(name);
}

describe("getModeForPath", () => {
	it("loads Markdown with extended GFM syntax", async () => {
		const markdownMode = getModeForPath("README.md");
		const loadMarkdown = markdownMode.getExtension();
		expect(loadMarkdown).toEqual(expect.any(Function));

		const support = await loadMarkdown();
		const tree = support.language.parser.parse(
			[
				"~~Strikethrough~~",
				"",
				"- [x] Completed task",
				"",
				"| Column 1 | Column 2 |",
				"|----------|----------|",
				"| A        | B        |",
			].join("\n"),
		);
		const syntax = tree.toString();

		expect(syntax).toContain("Strikethrough");
		expect(syntax).toContain("TaskMarker");
		expect(syntax).toContain("Table");
	});

	it("matches the previous sort-and-scan result for built-in modes", () => {
		const paths = collectParityPaths();
		expect(paths.length).toBeGreaterThan(100);

		const mismatches = [];
		for (const path of paths) {
			const next = getModeForPath(path);
			const legacy = legacyGetModeForPath(path);
			if (next !== legacy) {
				mismatches.push({
					path,
					next: next?.name,
					legacy: legacy?.name,
				});
			}
		}

		expect(mismatches).toEqual([]);
	});

	it("prefers later registrations when specificity is equal", () => {
		registerTestMode("nobicodebench-first", "nobicodebench");
		registerTestMode("nobicodebench-second", "nobicodebench");

		expect(getModeForPath("demo.nobicodebench").name).toBe("nobicodebench-second");

		removeMode("nobicodebench-second");
		addedModes.pop();

		expect(getModeForPath("demo.nobicodebench").name).toBe("nobicodebench-first");
	});

	it("keeps anchored filenames ahead of generic extensions", () => {
		expect(getModeForPath("Dockerfile").name).toBe("dockerfile");
		expect(getModeForPath("dockerfile").name).toBe(
			legacyGetModeForPath("dockerfile").name,
		);
		expect(getModeForPath("CMakeLists.txt").name).toBe("cmake");
		expect(getModeForPath("notes.txt").name).toBe("text");
	});

	it("keeps longer extensions ahead of shorter suffixes", () => {
		expect(getModeForPath("types.d.ts").name).toBe(
			legacyGetModeForPath("types.d.ts").name,
		);
		expect(getModeForPath("types.ts").name).toBe(
			legacyGetModeForPath("types.ts").name,
		);
	});

	it("resolves regex filename matchers", () => {
		expect(getModeForPath("nginx.conf").name).toBe(
			legacyGetModeForPath("nginx.conf").name,
		);
		expect(getModeForPath("BUILD").name).toBe(
			legacyGetModeForPath("BUILD").name,
		);
	});

	it("keeps higher-specificity filename regexes ahead of exact names", () => {
		registerTestMode("nobicode-exact-foo", "^nobicodepluginfile");
		registerTestMode("nobicode-regex-foo", "", {
			filenameMatchers: [/^nobicodepluginfile.*/],
		});

		expect(getModeForPath("nobicodepluginfile").name).toBe(
			legacyGetModeForPath("nobicodepluginfile").name,
		);
		expect(getModeForPath("nobicodepluginfile").name).toBe("nobicode-regex-foo");
	});

	it("stores the normalized formatAs mode", () => {
		registerTestMode("nobicode-json-like", "nobicodejsonlike", {
			formatAs: " JSON ",
		});
		registerTestMode("nobicode-plain", "nobicodeplain");

		expect(getModeForPath("a.nobicodejsonlike").formatAs).toBe("json");
		expect(getModeForPath("a.nobicodeplain").formatAs).toBeNull();
	});

	it("resolves formatAs aliases to the base mode name", () => {
		registerTestMode("nobicode-json5-like", "nobicodejson5like", {
			formatAs: "json5",
		});
		registerTestMode("nobicode-unknown-base", "nobicodeunknownbase", {
			formatAs: "nobicode-missing",
		});

		expect(getFormatAsMode("nobicode-json5-like")).toBe("json");
		expect(getFormatAsMode("nobicode-unknown-base")).toBe("nobicode-missing");
		expect(getFormatAsMode("json")).toBeNull();
	});

	it("ignores malformed mode options from plugins", () => {
		expect(() =>
			registerTestMode("nobicode-null-options", "nobicodenullopts", null),
		).not.toThrow();
		registerTestMode("nobicode-bad-options", "nobicodebadopts", {
			aliases: "abc",
			formatAs: 42,
		});

		const mode = getModeForPath("a.nobicodebadopts");
		expect(mode.aliases).toEqual([]);
		expect(mode.formatAs).toBeNull();
	});

	it("invalidates plugin registrations immediately", () => {
		registerTestMode("nobicodepluginmode", "nobicodepluginmode");

		expect(getModeForPath("demo.nobicodepluginmode").name).toBe("nobicodepluginmode");
		expect(getModes().some((mode) => mode.name === "nobicodepluginmode")).toBe(
			true,
		);

		removeMode("nobicodepluginmode");
		addedModes.pop();

		expect(getModeForPath("demo.nobicodepluginmode").name).toBe("text");
	});

	it("keeps mode-level ranking when a longer suffix is claimed by a lower-ranked mode", () => {
		registerTestMode("nobicode-long-ts", "ts|verylongextension");
		registerTestMode("nobicode-dts", "d.ts");

		expect(getModeForPath("types.d.ts").name).toBe(
			legacyGetModeForPath("types.d.ts").name,
		);
		expect(getModeForPath("types.d.ts").name).toBe("nobicode-long-ts");
		expect(getModeForPath("file.verylongextension").name).toBe("nobicode-long-ts");
		expect(getModeForPath("file.ts").name).toBe("nobicode-long-ts");
	});

	it("matches the previous sort-and-scan result for a large mixed folder", () => {
		const files = [];
		for (let i = 0; i < 50; i++) {
			files.push(`src/app${i}.js`);
			files.push(`src/app${i}.ts`);
			files.push(`src/app${i}.json`);
			files.push(`src/app${i}.py`);
			files.push(`src/app${i}.md`);
			files.push(`src/app${i}.css`);
			files.push(`src/app${i}.unknownext`);
			files.push("Dockerfile");
			files.push("nginx.conf");
			files.push("CMakeLists.txt");
			files.push("types.d.ts");
		}

		const mismatches = [];
		for (const file of files) {
			const next = getModeForPath(file);
			const legacy = legacyGetModeForPath(file);
			if (next !== legacy) {
				mismatches.push({
					file,
					next: next?.name,
					legacy: legacy?.name,
				});
			}
		}

		expect(mismatches).toEqual([]);
	});
});
