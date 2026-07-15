import { loadEnvConfig } from "@next/env";

type ScheduledResult = {
  collectionId: string;
  collectionTitle: string;
  status: "Completed" | "Failed";
  movesCount?: number;
  error?: string;
};

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
    {
      getCollectionRotationIntervalMinutes,
      getCurrentScheduleBoundary,
    },
  ] = await Promise.all([
    import("../lib/prisma"),
    import("../lib/collection-rotation"),
    import("../lib/collection-rotation-schedule"),
  ]);

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

  const existingScheduleRun =
    await prisma.collectionRotationScheduleRun.findUnique({
      where: {
        scheduledFor,
      },
    });

  if (existingScheduleRun) {
    console.log(
      `[collection-rotation] A cycle already exists for ${scheduledFor.toISOString()} with status ${existingScheduleRun.status}. Skipping duplicate execution.`
    );

    return {
      prisma,
      completedCount:
        existingScheduleRun.completedCount,
      failedCount:
        existingScheduleRun.failedCount,
    };
  }

  const scheduleRun =
    await prisma.collectionRotationScheduleRun.create({
      data: {
        scheduledFor,
        status: "Running",
      },
    });

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

  const results: ScheduledResult[] = [];

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
      process.exitCode = 1;
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