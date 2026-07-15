const DEFAULT_INTERVAL_MINUTES = 240;
const MINIMUM_INTERVAL_MINUTES = 1;

export function getCollectionRotationIntervalMinutes() {
  const configuredValue = Number(
    process.env.COLLECTION_ROTATION_INTERVAL_MINUTES
  );

  if (
    !Number.isFinite(configuredValue) ||
    configuredValue < MINIMUM_INTERVAL_MINUTES
  ) {
    return DEFAULT_INTERVAL_MINUTES;
  }

  return Math.floor(configuredValue);
}

export function isCollectionRotationScheduleEnabled() {
  return (
    process.env.COLLECTION_ROTATION_CRON_ENABLED
      ?.trim()
      .toLowerCase() === "true"
  );
}

export function getCurrentScheduleBoundary(
  date = new Date()
) {
  const intervalMinutes =
    getCollectionRotationIntervalMinutes();

  const intervalMilliseconds =
    intervalMinutes * 60 * 1000;

  const boundaryMilliseconds =
    Math.floor(
      date.getTime() / intervalMilliseconds
    ) * intervalMilliseconds;

  return new Date(boundaryMilliseconds);
}

export function getNextScheduleBoundary(
  date = new Date()
) {
  const intervalMinutes =
    getCollectionRotationIntervalMinutes();

  const intervalMilliseconds =
    intervalMinutes * 60 * 1000;

  const nextBoundaryMilliseconds =
    (Math.floor(
      date.getTime() / intervalMilliseconds
    ) +
      1) *
    intervalMilliseconds;

  return new Date(nextBoundaryMilliseconds);
}

export function formatScheduleInterval(
  intervalMinutes: number
) {
  if (
    intervalMinutes >= 60 &&
    intervalMinutes % 60 === 0
  ) {
    const hours = intervalMinutes / 60;

    return `Every ${hours} hour${
      hours === 1 ? "" : "s"
    }`;
  }

  return `Every ${intervalMinutes} minute${
    intervalMinutes === 1 ? "" : "s"
  }`;
}