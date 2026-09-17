<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/UploadService.php';

$db = (new Database())->pdo();
$service = new UploadService($db);

$pollSeconds = 2;

echo "Finalization worker started\n";

while (true) {
    try {
        $stmt = $db->query(
            'SELECT id FROM uploads
             WHERE status = "PROCESSING"
             ORDER BY updated_at ASC
             LIMIT 10'
        );
        $ids = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));

        foreach ($ids as $id) {
            try {
                echo "Processing upload {$id}\n";
                $service->processFinalization($id);
                echo "Finished upload {$id}\n";
            } catch (Throwable $e) {
                error_log("Finalization failed for upload {$id}: " . $e->getMessage());
            }
        }
    } catch (Throwable $e) {
        error_log('Worker loop error: ' . $e->getMessage());
    }

    sleep($pollSeconds);
}
