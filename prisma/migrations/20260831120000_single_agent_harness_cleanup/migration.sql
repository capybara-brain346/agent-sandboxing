DELETE FROM "events"
WHERE ("type" = 'artifact_created' AND "payload"->>'kind' = 'worker_report')
   OR "artifact_id" IN (
       SELECT "id"
       FROM "artifacts"
       WHERE "kind" = 'worker_report'
   );

DELETE FROM "artifacts"
WHERE "kind" = 'worker_report';
