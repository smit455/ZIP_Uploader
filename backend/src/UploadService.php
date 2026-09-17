<?php
declare(strict_types=1);

final class UploadService
{
    private PDO $db;
    private int $chunkSize;
    private string $storagePath;

    public function __construct(PDO $db)
    {
        $this->db = $db;
        $this->chunkSize = (int) (getenv('CHUNK_SIZE') ?: 5242880);
        $this->storagePath = getenv('STORAGE_PATH') ?: __DIR__ . '/../storage/uploads';

        if (!is_dir($this->storagePath) && !mkdir($this->storagePath, 0777, true) && !is_dir($this->storagePath)) {
            throw new RuntimeException('Unable to create storage directory');
        }
    }

    public function handshake(array $body): array
    {
        $filename = trim((string) ($body['filename'] ?? ''));
        $size = filter_var($body['size'] ?? null, FILTER_VALIDATE_INT);
        $lastModified = (string) ($body['lastModified'] ?? '');

        if ($filename === '' || $size === false || $size <= 0) {
            throw new InvalidArgumentException('filename and positive size are required');
        }
        if (!str_ends_with(strtolower($filename), '.zip')) {
            throw new InvalidArgumentException('Only ZIP files are supported');
        }
        if ($size > 10 * 1024 * 1024 * 1024) {
            throw new InvalidArgumentException('Maximum supported file size is 10GB');
        }

        $totalChunks = (int) ceil($size / $this->chunkSize);
        $fileKey = hash('sha256', $filename . "\0" . $size . "\0" . $lastModified);

        $stmt = $this->db->prepare('SELECT * FROM uploads WHERE file_key = ? LIMIT 1');
        $stmt->execute([$fileKey]);
        $upload = $stmt->fetch();

        if (!$upload) {
            try {
                $stmt = $this->db->prepare(
                    'INSERT INTO uploads (file_key, filename, total_size, total_chunks)
                     VALUES (?, ?, ?, ?)'
                );
                $stmt->execute([$fileKey, $filename, $size, $totalChunks]);
                $uploadId = (int) $this->db->lastInsertId();
            } catch (PDOException $e) {
                if ((int) ($e->errorInfo[1] ?? 0) !== 1062) {
                    throw $e;
                }

                $stmt = $this->db->prepare('SELECT * FROM uploads WHERE file_key = ? LIMIT 1');
                $stmt->execute([$fileKey]);
                $upload = $stmt->fetch();
                if (!$upload) {
                    throw $e;
                }
                $uploadId = (int) $upload['id'];
            }

            $this->ensureUploadFile($uploadId);
        } else {
            $uploadId = (int) $upload['id'];
            if ((int) $upload['total_size'] !== $size || (int) $upload['total_chunks'] !== $totalChunks) {
                throw new RuntimeException('Existing upload metadata does not match this file');
            }

            if ($upload['status'] === 'FAILED') {
                $reset = $this->db->prepare(
                    'UPDATE uploads
                     SET status = "UPLOADING", final_hash = NULL, zip_entries = NULL, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ? AND status = "FAILED"'
                );
                $reset->execute([$uploadId]);
            }

            $this->ensureUploadFile($uploadId);
        }

        return $this->status($uploadId);
    }

    public function listUploads(): array
    {
        $stmt = $this->db->query(
            'SELECT
                u.id,
                u.filename,
                u.total_size,
                u.total_chunks,
                u.status,
                u.final_hash,
                u.created_at,
                u.updated_at,
                COALESCE(SUM(CASE WHEN c.status = "SUCCESS" THEN 1 ELSE 0 END), 0) AS successful_chunks
             FROM uploads u
             LEFT JOIN chunks c ON c.upload_id = u.id
             GROUP BY u.id, u.filename, u.total_size, u.total_chunks, u.status, u.final_hash, u.created_at, u.updated_at
             ORDER BY u.created_at DESC'
        );

        return $stmt->fetchAll();
    }

    public function status(int $uploadId): array
    {
        $upload = $this->getUpload($uploadId);

        $stmt = $this->db->prepare(
            'SELECT chunk_index FROM chunks
             WHERE upload_id = ? AND status = "SUCCESS"
             ORDER BY chunk_index'
        );
        $stmt->execute([$uploadId]);
        $uploaded = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));

        return [
            'uploadId' => $uploadId,
            'filename' => $upload['filename'],
            'totalSize' => (int) $upload['total_size'],
            'totalChunks' => (int) $upload['total_chunks'],
            'status' => $upload['status'],
            'uploadedChunks' => $uploaded,
            'finalHash' => $upload['final_hash'],
            'zipEntries' => $upload['zip_entries'] ? json_decode($upload['zip_entries'], true) : null,
        ];
    }

    public function getZipContents(int $uploadId): array
    {
        $upload = $this->getUpload($uploadId);
        if ($upload['status'] !== 'COMPLETED') {
            throw new RuntimeException('ZIP is not finalized yet');
        }

        $path = $this->filePath($uploadId);
        if (!is_file($path)) {
            throw new RuntimeException('Stored ZIP file does not exist');
        }

        return [
            'uploadId' => $uploadId,
            'filename' => $upload['filename'],
            'entries' => $this->peekZipEntries($path),
        ];
    }

    public function deleteUpload(int $uploadId): array
    {
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare('SELECT * FROM uploads WHERE id = ? FOR UPDATE');
            $stmt->execute([$uploadId]);
            $upload = $stmt->fetch();
            if (!$upload) {
                throw new InvalidArgumentException('Upload not found');
            }

            if ($upload['status'] === 'PROCESSING') {
                throw new RuntimeException('Cannot delete an upload while finalization is running');
            }

            // Coordinate deletion with chunk writers. The same lock is held while a
            // chunk is written, so the file cannot be removed underneath an active write.
            $path = $this->storagePath . '/' . $uploadId . '/upload.bin';
            $file = null;
            if (is_file($path)) {
                $file = fopen($path, 'c+b');
                if ($file === false || !flock($file, LOCK_EX)) {
                    throw new RuntimeException('Unable to lock stored upload for deletion');
                }
            }

            $stmt = $this->db->prepare('DELETE FROM uploads WHERE id = ?');
            $stmt->execute([$uploadId]);
            $this->db->commit();

            if (is_resource($file)) {
                flock($file, LOCK_UN);
                fclose($file);
            }
        } catch (Throwable $e) {
            if (isset($file) && is_resource($file)) {
                @flock($file, LOCK_UN);
                @fclose($file);
            }
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }

        $directory = $this->storagePath . '/' . $uploadId;
        $this->removeDirectory($directory);

        return ['success' => true, 'uploadId' => $uploadId];
    }

    public function receiveChunk(int $uploadId, int $chunkIndex, $input, ?int $contentLength = null): array
    {
        $upload = $this->getUpload($uploadId);

        if ($upload['status'] !== 'UPLOADING') {
            if ($upload['status'] === 'COMPLETED') {
                return ['success' => true, 'alreadyUploaded' => true, 'chunkIndex' => $chunkIndex];
            }
            throw new RuntimeException('Upload is not accepting chunks');
        }

        $totalChunks = (int) $upload['total_chunks'];
        $totalSize = (int) $upload['total_size'];

        if ($chunkIndex < 0 || $chunkIndex >= $totalChunks) {
            throw new InvalidArgumentException('Invalid chunk index');
        }

        $offset = $chunkIndex * $this->chunkSize;
        $expectedLength = min($this->chunkSize, $totalSize - $offset);
        if ($expectedLength <= 0) {
            throw new InvalidArgumentException('Invalid chunk range');
        }

        if ($contentLength !== null && $contentLength !== $expectedLength) {
            throw new RuntimeException("Invalid chunk length: expected {$expectedLength}, received {$contentLength}");
        }

        if (getenv('FAILURE_SIMULATION') === 'true' && random_int(1, 100) <= 30) {
            throw new TransientUploadException('Simulated transient failure');
        }

        $check = $this->db->prepare(
            'SELECT status FROM chunks WHERE upload_id = ? AND chunk_index = ?'
        );
        $check->execute([$uploadId, $chunkIndex]);
        if ($check->fetchColumn() === 'SUCCESS') {
            return ['success' => true, 'alreadyUploaded' => true, 'chunkIndex' => $chunkIndex];
        }

        if (!is_resource($input)) {
            throw new RuntimeException('Unable to read request stream');
        }

        $filePath = $this->filePath($uploadId);
        $file = fopen($filePath, 'c+b');
        if (!$file) {
            throw new RuntimeException('Unable to open target file');
        }

        try {
            if (!flock($file, LOCK_EX)) {
                throw new RuntimeException('Unable to lock target file');
            }

            $check->execute([$uploadId, $chunkIndex]);
            if ($check->fetchColumn() === 'SUCCESS') {
                flock($file, LOCK_UN);
                return ['success' => true, 'alreadyUploaded' => true, 'chunkIndex' => $chunkIndex];
            }

            if (fseek($file, $offset, SEEK_SET) !== 0) {
                throw new RuntimeException('Unable to seek target file');
            }

            $remaining = $expectedLength;
            $written = 0;
            while ($remaining > 0) {
                $buffer = fread($input, min(1024 * 1024, $remaining));
                if ($buffer === false || $buffer === '') {
                    break;
                }

                $length = strlen($buffer);
                $n = fwrite($file, $buffer);
                if ($n === false || $n !== $length) {
                    throw new RuntimeException('Failed while writing chunk');
                }
                $written += $n;
                $remaining -= $n;
            }

            fflush($file);
            flock($file, LOCK_UN);

            if ($written !== $expectedLength) {
                $this->markChunkError($uploadId, $chunkIndex);
                throw new RuntimeException("Incomplete chunk: expected {$expectedLength} bytes, received {$written}");
            }

            $this->db->beginTransaction();
            $stmt = $this->db->prepare(
                'INSERT INTO chunks (upload_id, chunk_index, status, received_at)
                 VALUES (?, ?, "SUCCESS", NOW())
                 ON DUPLICATE KEY UPDATE status = "SUCCESS", received_at = NOW()'
            );
            $stmt->execute([$uploadId, $chunkIndex]);
            $this->db->commit();

            return ['success' => true, 'alreadyUploaded' => false, 'chunkIndex' => $chunkIndex];
        } catch (Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            if (is_resource($file)) {
                @flock($file, LOCK_UN);
            }
            throw $e;
        } finally {
            fclose($file);
        }
    }

    public function requestFinalize(int $uploadId): array
    {
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare('SELECT * FROM uploads WHERE id = ? FOR UPDATE');
            $stmt->execute([$uploadId]);
            $upload = $stmt->fetch();
            if (!$upload) {
                throw new InvalidArgumentException('Upload not found');
            }

            if ($upload['status'] === 'COMPLETED') {
                $this->db->commit();
                return $this->status($uploadId);
            }

            if ($upload['status'] === 'PROCESSING') {
                $this->db->commit();
                return [
                    'uploadId' => $uploadId,
                    'status' => 'PROCESSING',
                    'message' => 'Finalization is already queued or in progress',
                ];
            }

            $countStmt = $this->db->prepare(
                'SELECT COUNT(*) FROM chunks WHERE upload_id = ? AND status = "SUCCESS"'
            );
            $countStmt->execute([$uploadId]);
            $count = (int) $countStmt->fetchColumn();

            if ($count !== (int) $upload['total_chunks']) {
                throw new RuntimeException("Cannot finalize: {$count}/{$upload['total_chunks']} chunks received");
            }

            $stmt = $this->db->prepare(
                'UPDATE uploads
                 SET status = "PROCESSING", updated_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND status = "UPLOADING"'
            );
            $stmt->execute([$uploadId]);
            $this->db->commit();

            return [
                'uploadId' => $uploadId,
                'status' => 'PROCESSING',
                'message' => 'Finalization queued',
            ];
        } catch (Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }
    }

    public function processFinalization(int $uploadId): void
    {
        $lockName = "large-file-uploader:finalize:{$uploadId}";
        $lockStmt = $this->db->prepare('SELECT GET_LOCK(?, 0)');
        $lockStmt->execute([$lockName]);
        if ((int) $lockStmt->fetchColumn() !== 1) {
            return;
        }

        try {
            $upload = $this->getUpload($uploadId);
            if ($upload['status'] !== 'PROCESSING') {
                return;
            }

            $path = $this->filePath($uploadId);
            if (!is_file($path)) {
                throw new RuntimeException('Assembled file does not exist');
            }

            $expectedSize = (int) $upload['total_size'];
            if (filesize($path) < $expectedSize) {
                throw new RuntimeException('Assembled file is smaller than the expected upload size');
            }

            $hash = hash_file('sha256', $path);
            if ($hash === false) {
                throw new RuntimeException('Unable to calculate SHA-256');
            }

            $entries = $this->peekZipEntries($path);
            $encodedEntries = json_encode($entries, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

            $stmt = $this->db->prepare(
                'UPDATE uploads
                 SET status = "COMPLETED", final_hash = ?, zip_entries = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND status = "PROCESSING"'
            );
            $stmt->execute([$hash, $encodedEntries, $uploadId]);
        } catch (Throwable $e) {
            $stmt = $this->db->prepare(
                'UPDATE uploads SET status = "FAILED", updated_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND status = "PROCESSING"'
            );
            $stmt->execute([$uploadId]);
            throw $e;
        } finally {
            $release = $this->db->prepare('SELECT RELEASE_LOCK(?)');
            $release->execute([$lockName]);
        }
    }

    public function cleanupOrphans(int $maxAgeSeconds = 86400): int
    {
        $cutoff = date('Y-m-d H:i:s', time() - $maxAgeSeconds);
        $stmt = $this->db->prepare(
            'SELECT id FROM uploads
             WHERE updated_at < ? AND status IN ("UPLOADING", "FAILED")'
        );
        $stmt->execute([$cutoff]);
        $ids = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));

        foreach ($ids as $id) {
            $this->deleteUpload($id);
        }

        return count($ids);
    }

    private function peekZipEntries(string $path): array
    {
        if (!class_exists('ZipArchive')) {
            throw new RuntimeException('PHP ZIP extension is not installed');
        }

        $zip = new ZipArchive();
        $result = $zip->open($path, ZipArchive::RDONLY);
        if ($result !== true) {
            throw new RuntimeException('Uploaded file is not a valid ZIP archive');
        }

        $entries = [];
        try {
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $stat = $zip->statIndex($i);
                if (!$stat || empty($stat['name'])) {
                    continue;
                }

                $entries[] = [
                    'name' => ltrim((string) $stat['name'], '/'),
                    'size' => (int) ($stat['size'] ?? 0),
                    'compressed_size' => (int) ($stat['comp_size'] ?? 0),
                ];
            }
        } finally {
            $zip->close();
        }

        return $entries;
    }

    private function getUpload(int $uploadId): array
    {
        $stmt = $this->db->prepare('SELECT * FROM uploads WHERE id = ? LIMIT 1');
        $stmt->execute([$uploadId]);
        $upload = $stmt->fetch();
        if (!$upload) {
            throw new InvalidArgumentException('Upload not found');
        }
        return $upload;
    }

    private function ensureUploadFile(int $uploadId): void
    {
        $path = $this->filePath($uploadId);
        if (!file_exists($path)) {
            $fp = fopen($path, 'c+b');
            if ($fp === false) {
                throw new RuntimeException('Unable to create upload file');
            }
            fclose($fp);
        }
    }

    private function filePath(int $uploadId): string
    {
        $dir = $this->storagePath . '/' . $uploadId;
        if (!is_dir($dir) && !mkdir($dir, 0777, true) && !is_dir($dir)) {
            throw new RuntimeException('Unable to create upload directory');
        }
        return $dir . '/upload.bin';
    }

    private function markChunkError(int $uploadId, int $chunkIndex): void
    {
        $stmt = $this->db->prepare(
            'INSERT INTO chunks (upload_id, chunk_index, status)
             VALUES (?, ?, "ERROR")
             ON DUPLICATE KEY UPDATE status = "ERROR"'
        );
        $stmt->execute([$uploadId, $chunkIndex]);
    }

    private function removeDirectory(string $directory): void
    {
        if (!is_dir($directory)) {
            return;
        }

        $items = scandir($directory);
        if ($items === false) {
            return;
        }

        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $directory . '/' . $item;
            if (is_dir($path)) {
                $this->removeDirectory($path);
            } else {
                @unlink($path);
            }
        }

        @rmdir($directory);
    }
}

final class TransientUploadException extends RuntimeException
{
}
