#!/usr/bin/env bun

import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const root = resolve(import.meta.dir, "../../..");
const gamesDirectory = join(root, "games");
const templateDirectory = join(root, "templates", "game");
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface GameMetadata {
  readonly slug: string;
  readonly title: string;
  readonly directory: string;
}

const titleCase = (slug: string): string =>
  slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

async function listGames(): Promise<GameMetadata[]> {
  await mkdir(gamesDirectory, { recursive: true });
  const entries = await readdir(gamesDirectory, { withFileTypes: true });
  const games: GameMetadata[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(gamesDirectory, entry.name);
    try {
      const manifest = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      ) as { bgame?: { title?: unknown } };
      games.push({
        slug: entry.name,
        title:
          typeof manifest.bgame?.title === "string"
            ? manifest.bgame.title
            : titleCase(entry.name),
        directory,
      });
    } catch {
      // Ignore directories that are not game workspaces.
    }
  }
  return games.sort((left, right) => left.slug.localeCompare(right.slug));
}

async function ask(question: string): Promise<string> {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    return (await readline.question(question)).trim();
  } finally {
    readline.close();
  }
}

function assertSlug(slug: string): void {
  if (!slugPattern.test(slug)) {
    throw new Error(
      "Game slug must use lowercase letters, digits, and single hyphens (example: skull-king)",
    );
  }
}

const optionValue = (args: readonly string[], option: string): string | null => {
  const index = args.indexOf(option);
  return index >= 0 ? (args[index + 1] ?? null) : null;
};

async function replaceTemplateTokens(
  directory: string,
  replacements: Readonly<Record<string, string>>,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await replaceTemplateTokens(path, replacements);
      continue;
    }
    if (!entry.isFile()) continue;
    let content = await readFile(path, "utf8");
    for (const [token, value] of Object.entries(replacements)) {
      content = content.replaceAll(token, value);
    }
    await writeFile(path, content, "utf8");
  }
}

async function refreshWorkspace(): Promise<void> {
  const child = Bun.spawn([process.execPath, "install"], {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`bun install exited with code ${exitCode}`);
}

async function createGame(args: readonly string[]): Promise<void> {
  let slug = args.find((argument) => !argument.startsWith("--")) ?? "";
  if (!slug) slug = await ask("Game slug: ");
  assertSlug(slug);

  let title = optionValue(args, "--title") ?? "";
  if (!title && args.length === 0) {
    title = (await ask(`Game title [${titleCase(slug)}]: `)) || titleCase(slug);
  }
  if (!title) title = titleCase(slug);

  const destination = join(gamesDirectory, slug);
  if (await Bun.file(join(destination, "package.json")).exists()) {
    throw new Error(`Game already exists: ${slug}`);
  }

  await cp(templateDirectory, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  await replaceTemplateTokens(destination, {
    __GAME_SLUG__: slug,
    __GAME_TITLE__: title,
    __GAME_IDENTIFIER__: slug.replace(/-([a-z0-9])/g, (_, letter: string) =>
      letter.toUpperCase(),
    ),
  });
  await refreshWorkspace();
  console.log(`\nCreated games/${slug}`);
  console.log(`Run it with: bgame ${slug}`);
}

async function deleteGame(args: readonly string[]): Promise<void> {
  const games = await listGames();
  let slug = args.find((argument) => !argument.startsWith("--")) ?? "";
  if (!slug) {
    if (games.length === 0) {
      console.log("No games exist.");
      return;
    }
    console.log(games.map((game) => `- ${game.slug} (${game.title})`).join("\n"));
    slug = await ask("Game slug to delete: ");
  }
  assertSlug(slug);
  const game = games.find((candidate) => candidate.slug === slug);
  if (!game) throw new Error(`Unknown game: ${slug}`);

  if (!args.includes("--force")) {
    const confirmation = await ask(`Delete games/${slug}? Type the slug to confirm: `);
    if (confirmation !== slug) {
      console.log("Cancelled.");
      return;
    }
  }

  await rm(game.directory, { recursive: true, force: false });
  await refreshWorkspace();
  console.log(`Deleted games/${slug}`);
}

async function runGame(slug: string, args: readonly string[]): Promise<void> {
  assertSlug(slug);
  const game = (await listGames()).find((candidate) => candidate.slug === slug);
  if (!game) {
    throw new Error(`Unknown game: ${slug}. Run \`bgame list\` first.`);
  }
  const serverEntry = join(game.directory, "src", "server.ts");
  if (!(await Bun.file(serverEntry).exists())) {
    throw new Error(`${relative(root, serverEntry)} does not exist`);
  }
  const child = Bun.spawn([process.execPath, "run", serverEntry, ...args], {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = await child.exited;
}

function printHelp(): void {
  console.log(`bgame — Bun multiplayer boardgame workspace

Usage:
  bgame <game> [--port 3000]
  bgame new [slug] [--title "Game title"]
  bgame del [slug] [--force]
  bgame list
`);
}

async function main(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2);
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    case "new":
      await createGame(args);
      return;
    case "del":
    case "delete":
      await deleteGame(args);
      return;
    case "list":
    case "ls": {
      const games = await listGames();
      console.log(
        games.length === 0
          ? "No games. Create one with `bgame new`."
          : games.map((game) => `${game.slug.padEnd(18)} ${game.title}`).join("\n"),
      );
      return;
    }
    default:
      await runGame(command, args);
  }
}

main().catch((error: unknown) => {
  console.error(`\n[bgame] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
