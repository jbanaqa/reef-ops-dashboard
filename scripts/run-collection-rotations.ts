import { loadEnvConfig } from "@next/env";

type ScheduledResult = {
  collectionId: string;
  collectionTitle: string;
  status: "Completed" | "Failed";
  movesCount?: number;
  error?: string;
};

const ABANDONED_SCHEDULE_AFTER_MS = 3 * 60 * 60 * 1_000;

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function runScheduledRotations() {
  /*
    Standalone tsx scripts do not automatically load
    Next.js environment files. Load .env.local and .env
    before importing modules that read process.env.
  */
  loadEnvConfig(process.cwd());

  const [
    { prisma },
    { shuffleCollection },
    { syncAnalyticsForEnabledRotations },
    {
      getCollectionRotationIntervalMinutes,
      getCurrentScheduleBoundary,
      isCollectionRotationScheduleEnabled,
    },
  ] = await Promise.all([
    import("../lib/prisma"),
    import("../lib/collection-rotation"),
    import("../lib/collection-rotation-analytics"),
    import("../lib/collection-rotation-schedule"),
  ]);

  if (!isCollectionRotationScheduleEnabled()) {
    console.log(
      "[collection-rotation] Scheduler is disabled. Set COLLECTION_ROTATION_CRON_ENABLED=true to enable it."
    );

    return {
      prisma,
      completedCount: 0,
      failedCount: 0,
    };
  }

  const scheduledFor =
    getCurrentScheduleBoundary();

  const intervalMinutes =
    getCollectionRotationIntervalMinutes();

  console.log(
    `[collection-rotation] Starting scheduled cycle for ${scheduledFor.toISOString()}`
  );

  console.log(
    `[collection-rotation] Configured interval: ${intervalMinutes} minutes`
  );

  let existingScheduleRun =
    await prisma.collectionRotationScheduleRun.findUnique({
      where: {
        scheduledFor,
      },
    });

  if (
    existingScheduleRun?.status === "Running" &&
    existingScheduleRun.startedAt.getTime() <
      Date.now() - ABANDONED_SCHEDULE_AFTER_MS
  ) {
    existingScheduleRun =
      await prisma.collectionRotationScheduleRun.update({
        where: { id: existingScheduleRun.id },
        data: {
          status: "Failed",
          failedCount: Math.max(existingScheduleRun.failedCount, 1),
          results: [
            {
              status: "Failed",
              error:
                "The scheduled process stopped before it could finish.",
            },
          ],
          completedAt: new Date(),
        },
      });
  }

  if (existingScheduleRun) {
    console.log(
      `[collection-rotation] A cycle already exists for ${scheduledFor.toISOString()} with status ${existingScheduleRun.status}. Skipping duplicate execution.`
    );

    return {
      prisma,
      completedCount:
        existingScheduleRun.completedCount,
      // The recorded run already finished. Preserve its error counts in the
      // rotation history, but do not fail every later cron tick in this same
      // schedule window while correctly skipping a duplicate attempt.
      failedCount: 0,
    };
  }

  let scheduleRun;

  try {
    scheduleRun =
      await prisma.collectionRotationScheduleRun.create({
        data: {
          scheduledFor,
          status: "Running",
        },
      });
  } catch (error) {
    const concurrentRun =
      await prisma.collectionRotationScheduleRun.findUnique({
        where: { scheduledFor },
      });

    if (concurrentRun) {
      console.log(
        `[collection-rotation] Another process claimed ${scheduledFor.toISOString()} with status ${concurrentRun.status}. Skipping duplicate execution.`
      );

      return {
        prisma,
        completedCount: concurrentRun.completedCount,
        failedCount: 0,
      };
    }

    throw error;
  }

  const results: ScheduledResult[] = [];

  try {

  let analyticsRefresh: Record<string, unknown>;

  try {
    analyticsRefresh =
      await syncAnalyticsForEnabledRotations();
  } catch (error) {
    analyticsRefresh = {
      skipped: true,
      error:
        error instanceof Error
          ? error.message
          : "Analytics refresh failed.",
    };

    console.error(
      "[collection-rotation] Analytics refresh failed; continuing with cached and local data:",
      analyticsRefresh.error
    );
  }

  console.log(
    `[collection-rotation] Analytics refresh: ${JSON.stringify(analyticsRefresh)}`
  );

  const enabledRotations =
    await prisma.collectionRotation.findMany({
      where: {
        isEnabled: true,
      },

      orderBy: [
        {
          isStarred: "desc",
        },
        {
          collectionTitle: "asc",
        },
      ],

      select: {
        shopifyCollectionId: true,
        collectionTitle: true,
      },
    });

  await prisma.collectionRotationScheduleRun.update({
    where: {
      id: scheduleRun.id,
    },

    data: {
      enabledCount:
        enabledRotations.length,
    },
  });

  console.log(
    `[collection-rotation] ${enabledRotations.length} enabled collection(s) found.`
  );

  for (
    let index = 0;
    index < enabledRotations.length;
    index += 1
  ) {
    const rotation =
      enabledRotations[index];

    console.log(
      `[collection-rotation] Processing ${index + 1}/${enabledRotations.length}: ${rotation.collectionTitle}`
    );

    try {
      const result =
        await shuffleCollection(
          rotation.shopifyCollectionId,
          "Scheduled"
        );

      results.push({
        collectionId:
          rotation.shopifyCollectionId,
        collectionTitle:
          rotation.collectionTitle,
        status: "Completed",
        movesCount:
          result.movesCount,
      });

      console.log(
        `[collection-rotation] Completed ${rotation.collectionTitle}: ${result.movesCount} move(s).`
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown scheduled shuffle error.";

      results.push({
        collectionId:
          rotation.shopifyCollectionId,
        collectionTitle:
          rotation.collectionTitle,
        status: "Failed",
        error: message,
      });

      console.error(
        `[collection-rotation] Failed ${rotation.collectionTitle}: ${message}`
      );
    }

    if (
      index <
      enabledRotations.length - 1
    ) {
      await sleep(1_500);
    }
  }

  const completedCount =
    results.filter(
      (result) =>
        result.status === "Completed"
    ).length;

  const failedCount =
    results.filter(
      (result) =>
        result.status === "Failed"
    ).length;

  const finalStatus =
    failedCount === 0
      ? "Completed"
      : completedCount > 0
        ? "Completed With Errors"
        : "Failed";

  await prisma.collectionRotationScheduleRun.update({
    where: {
      id: scheduleRun.id,
    },

    data: {
      status: finalStatus,
      completedCount,
      failedCount,
      results,
      completedAt: new Date(),
    },
  });

  console.log(
    `[collection-rotation] Scheduled cycle finished. ${completedCount} completed, ${failedCount} failed.`
  );

  return {
    prisma,
    completedCount,
    failedCount,
  };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The scheduled runner stopped unexpectedly.";

    try {
      await prisma.collectionRotationScheduleRun.updateMany({
        where: {
          id: scheduleRun.id,
          status: "Running",
        },
        data: {
          status: "Failed",
          completedCount: results.filter(
            (result) => result.status === "Completed"
          ).length,
          failedCount: Math.max(
            1,
            results.filter((result) => result.status === "Failed").length
          ),
          results: [
            ...results,
            {
              collectionId: "",
              collectionTitle: "Scheduled cycle",
              status: "Failed",
              error: message,
            },
          ],
          completedAt: new Date(),
        },
      });
    } catch (finalizationError) {
      console.error(
        "[collection-rotation] Could not finalize the failed schedule record:",
        finalizationError
      );
    }

    throw error;
  }
}

async function main() {
  let prisma:
    | Awaited<
        ReturnType<
          typeof runScheduledRotations
        >
      >["prisma"]
    | null = null;

  try {
    const result =
      await runScheduledRotations();

    prisma = result.prisma;

    if (result.failedCount > 0) {
      console.warn(
        `[collection-rotation] ${result.failedCount} collection(s) failed. The cycle completed and the failures were recorded in Reef Ops.`
      );
    }
  } catch (error) {
    console.error(
      "[collection-rotation] Scheduled runner crashed:",
      error
    );

    process.exitCode = 1;
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
  }
}

void main();
