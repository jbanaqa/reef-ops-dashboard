import { spawn } from "node:child_process";

/**
 * Railway invokes this command from the existing cron service. Keeping the
 * two jobs as separate child processes means each runner retains its own
 * environment loading and Prisma cleanup while one cron tick can service
 * both marketing messages and collection rotations.
 */
function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      env: process.env,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with ${
            signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
          }`
        )
      );
    });
  });
}

async function main() {
  const runner = "node_modules/tsx/dist/cli.mjs";
  const failures: Error[] = [];

  console.log("[scheduled] Running marketing worker.");
  try {
    await run(process.execPath, [runner, "scripts/run-marketing.ts"]);
  } catch (error) {
    const failure =
      error instanceof Error ? error : new Error(String(error));
    failures.push(failure);
    console.error("[scheduled] Marketing worker failed:", failure.message);
  }

  console.log("[scheduled] Running collection rotation scheduler.");
  try {
    await run(process.execPath, [runner, "scripts/run-collection-rotations.ts"]);
  } catch (error) {
    const failure =
      error instanceof Error ? error : new Error(String(error));
    failures.push(failure);
    console.error(
      "[scheduled] Collection rotation scheduler failed:",
      failure.message
    );
  }

  if (failures.length) {
    throw new Error(
      `${failures.length} scheduled job${failures.length === 1 ? "" : "s"} failed.`
    );
  }

  console.log("[scheduled] Scheduled jobs completed.");
}

main().catch((error) => {
  console.error("[scheduled] Scheduled jobs failed:", error);
  process.exitCode = 1;
});
