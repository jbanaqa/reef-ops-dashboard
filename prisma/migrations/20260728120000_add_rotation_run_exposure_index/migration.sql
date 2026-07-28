-- Collection Rotation's Exposure metric now averages a product's position
-- across EVERY saved completed run for its collection (previously capped
-- at the 42 most recent). The query behind that (WHERE rotationId, status,
-- undoneAt = null; ORDER BY completedAt DESC) used to get away with a full
-- scan of a small, take(42)-bounded result set - without that cap, this
-- composite index lets Postgres satisfy the same query via an index scan
-- that's already in the right sort order, instead of scanning and sorting
-- every run a collection has ever completed.

CREATE INDEX "CollectionRotationRun_rotationId_status_undoneAt_completedAt_idx" ON "CollectionRotationRun"("rotationId", "status", "undoneAt", "completedAt");
