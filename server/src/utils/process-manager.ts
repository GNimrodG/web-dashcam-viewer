import type { ResultPromise } from "execa";
import { logger } from "../logger.js";

/**
 * Manages child processes to ensure they're killed on shutdown
 */
class ProcessManager {
  private readonly processes = new Set<ResultPromise>();

  /**
   * Register a child process to be tracked
   */
  register(proc: ResultPromise): void {
    this.processes.add(proc);

    // Remove from tracking when it completes
    proc
      .catch(() => {})
      .finally(() => {
        this.processes.delete(proc);
      });
  }

  /**
   * Kill all tracked processes
   */
  killAll(): void {
    logger.info(
      { count: this.processes.size },
      "Killing tracked child processes",
    );

    for (const proc of this.processes) {
      try {
        proc.kill("SIGKILL");
      } catch (err) {
        logger.warn({ err }, "Failed to kill child process");
      }
    }

    this.processes.clear();
  }
}

export const processManager = new ProcessManager();
