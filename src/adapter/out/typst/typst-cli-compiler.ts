// Outbound adapter for the TypstCompiler port: one `typst compile` process per render (ADR-0005),
// in a new temporary folder, with system fonts ignored and package downloads blocked (ADR-0006, ADR-0012).
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { DIAGNOSTIC_SEVERITY, type Diagnostic } from "../../../domain/render.js";
import {
  COMPILE_OUTCOME,
  type CompileJob,
  type CompileOutcome,
  type TypstCompiler,
} from "../../../application/port/out/typst-compiler.js";
import { parseTypstDiagnostics } from "./typst-diagnostics.js";

// Stop collecting stderr after this many characters, so a noisy template cannot fill the memory.
const MAX_STDERR_CHARS = 1_000_000;
const DEFAULT_BINARY = "typst";
const MAIN_FILE = "main.typ";
const OUTPUT_FILE = "out.pdf";
const TEMP_DIR_PREFIX = "docspawner-";

// An address where nothing listens. Typst sends package downloads through it and fails at once.
const BLOCKED_PROXY = "http://127.0.0.1:9";
const DOWNLOAD_FAILED_PREFIX = "failed to download package";
const DOWNLOAD_BLOCKED_HINT = "package downloads are disabled in docspawner; use only pre-installed packages";

/** Settings for the Typst CLI adapter. */
export interface TypstCliOptions {
  /** Path to the typst binary. Default: "typst" from PATH. */
  binary?: string;
  /** Extra font directories. System fonts are always ignored, for the same output on every machine. */
  fontPaths?: string[];
  /** Folder with pre-installed Typst packages: {packagePath}/{namespace}/{name}/{version}. */
  packagePath?: string;
}

/** How one `typst compile` process ended. */
interface RunResult {
  /** The exit code, or null when the process was killed. */
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
}

/** Outbound adapter: implements TypstCompiler with the typst CLI in a temporary directory. */
export class TypstCliCompiler implements TypstCompiler {
  private readonly binary: string;
  private readonly fontPaths: string[];
  private readonly packagePath: string | undefined;
  /** The first `typst --version` call, shared by every later call. */
  private versionPromise: Promise<string> | undefined;

  /**
   * Create the adapter. It does not run Typst yet.
   * @param options - Where the binary is, and the extra fonts and packages.
   */
  constructor(options: TypstCliOptions = {}) {
    this.binary = options.binary ?? DEFAULT_BINARY;
    this.fontPaths = options.fontPaths ?? [];
    this.packagePath = options.packagePath;
  }

  /**
   * Compile one job in a new temp folder. The folder is deleted afterwards.
   * @param job - The Typst source, extra files, timestamp, and timeout.
   * @returns The PDF, the errors, or a timeout.
   * @throws Error when a file name is not a plain name, or when the binary cannot start.
   */
  async compile(job: CompileJob): Promise<CompileOutcome> {
    const dir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));
    try {
      await writeInputs(dir, job);
      const run = await this.run(dir, job);
      if (run.timedOut) {
        return { kind: COMPILE_OUTCOME.timeout };
      }
      return await this.toOutcome(dir, run);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Read the Typst version once, then reuse it.
   * @returns The version number, for example "0.15.1".
   * @throws Error when the binary cannot run.
   */
  version(): Promise<string> {
    this.versionPromise ??= promisify(execFile)(this.binary, ["--version"]).then(
      ({ stdout }) => /typst (\S+)/.exec(stdout)?.[1] ?? stdout.trim(),
    );
    return this.versionPromise;
  }

  /**
   * Turn the result of a finished process into a compile outcome.
   * @param dir - The temp folder of this compile.
   * @param run - The exit code and the stderr text.
   * @returns Success with the PDF and the warnings, or failure with at least one error.
   */
  private async toOutcome(dir: string, run: RunResult): Promise<CompileOutcome> {
    // Remove the temp folder from messages: callers must not see internal paths.
    const stderr = run.stderr.replaceAll(dir, "");
    const diagnostics = parseTypstDiagnostics(stderr);
    addDownloadHints(diagnostics);

    if (run.exitCode === 0) {
      const pdf = new Uint8Array(await readFile(join(dir, OUTPUT_FILE)));
      const warnings = diagnostics.filter((d) => d.severity === DIAGNOSTIC_SEVERITY.warning);
      return { kind: COMPILE_OUTCOME.success, pdf, warnings };
    }

    if (!diagnostics.some((d) => d.severity === DIAGNOSTIC_SEVERITY.error)) {
      const message = stderr.trim() || `typst stopped with exit code ${run.exitCode}`;
      diagnostics.push({ severity: DIAGNOSTIC_SEVERITY.error, message });
    }
    return { kind: COMPILE_OUTCOME.failure, diagnostics };
  }

  /**
   * Build the command-line arguments for `typst compile`.
   * @param dir - The temp folder. It is the Typst root, so a template cannot read files outside it.
   * @param job - The compile job.
   * @returns The arguments, without the binary name.
   */
  private compileArgs(dir: string, job: CompileJob): string[] {
    const args = [
      "compile",
      "--root",
      dir,
      "--ignore-system-fonts",
      "--diagnostic-format",
      "human",
      "--creation-timestamp",
      String(job.timestamp),
      ...this.fontPaths.flatMap((path) => ["--font-path", path]),
    ];
    if (this.packagePath) {
      args.push("--package-path", this.packagePath);
    }
    // An empty cache, so a package cached on this machine cannot change the output.
    args.push("--package-cache-path", join(dir, ".package-cache"), MAIN_FILE, OUTPUT_FILE);
    return args;
  }

  /**
   * Build the environment for the Typst process. Typst has no option to turn off downloads,
   * so every proxy points to a closed port and a download fails at once (ADR-0007).
   * @returns The process environment.
   */
  private compileEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      HTTPS_PROXY: BLOCKED_PROXY,
      HTTP_PROXY: BLOCKED_PROXY,
      ALL_PROXY: BLOCKED_PROXY,
      NO_PROXY: "",
    };
  }

  /**
   * Start Typst, collect its stderr, and kill it when the timeout ends.
   * @param dir - The temp folder with main.typ and the extra files.
   * @param job - The compile job.
   * @returns The exit code, the stderr text, and whether the timeout killed the process.
   * @throws Error when the binary cannot start.
   */
  private run(dir: string, job: CompileJob): Promise<RunResult> {
    const args = this.compileArgs(dir, job);
    const env = this.compileEnv();

    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, { cwd: dir, env, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, job.timeoutMs);

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < MAX_STDERR_CHARS) {
          stderr += chunk;
        }
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`cannot start typst binary "${this.binary}": ${error.message}`));
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ exitCode, stderr, timedOut });
      });
    });
  }
}

/**
 * Write main.typ and the extra files. Only plain file names are allowed, so nothing escapes the folder.
 * @param dir - The temp folder.
 * @param job - The compile job with the source and the extra files.
 * @throws Error when a file name has a folder part, for example "../x".
 */
async function writeInputs(dir: string, job: CompileJob): Promise<void> {
  const files = Object.entries(job.files);
  for (const [name] of files) {
    if (basename(name) !== name) {
      throw new Error(`invalid file name: ${name}`);
    }
  }
  await Promise.all([
    writeFile(join(dir, MAIN_FILE), job.source),
    ...files.map(([name, content]) => writeFile(join(dir, name), content)),
  ]);
}

/**
 * Tell the caller why a package download failed: downloads are blocked on purpose.
 * @param diagnostics - The diagnostics to change in place.
 */
function addDownloadHints(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    if (diagnostic.message.startsWith(DOWNLOAD_FAILED_PREFIX)) {
      diagnostic.hints ??= [];
      diagnostic.hints.push(DOWNLOAD_BLOCKED_HINT);
    }
  }
}
