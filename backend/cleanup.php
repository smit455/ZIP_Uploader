<?php
declare(strict_types=1);

require_once __DIR__ . '/src/Database.php';

$db = (new Database())->pdo();
$storage = getenv('STORAGE_PATH') ?: __DIR__ . '/storage/uploads';

$stmt = $db->query(
    'SELECT id FROM uploads
     WHERE status IN ("UPLOADING", "FAILED")
     AND updated_at < NOW() - INTERVAL 24 HOUR'
);

$ids = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));

foreach ($ids as $id) {
    $dir = $storage . '/' . $id;

    if (is_dir($dir)) {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );

        foreach ($iterator as $file) {
            $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
        }
        rmdir($dir);
    }

    $delete = $db->prepare('DELETE FROM uploads WHERE id = ?');
    $delete->execute([$id]);

    echo "Cleaned upload {$id}\n";
}
