<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/UploadService.php';

$db = new Database();
$service = new UploadService($db->pdo());
$maxAge = (int) (getenv('CLEANUP_MAX_AGE') ?: 86400);

while (true) {
    try {
        $removed = $service->cleanupOrphans($maxAge);
        if ($removed > 0) {
            fwrite(STDOUT, sprintf("Removed %d stale upload(s).\n", $removed));
        }
    } catch (Throwable $e) {
        fwrite(STDERR, $e . PHP_EOL);
    }

    sleep(3600);
}
