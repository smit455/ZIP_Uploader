<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: http://localhost:5173');
header('Access-Control-Allow-Headers: Content-Type, X-Chunk-Length');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/UploadService.php';

$db = new Database();
$service = new UploadService($db->pdo());

function jsonInput(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function respond(array $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

try {
    $method = $_SERVER['REQUEST_METHOD'];
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/';

    if ($method === 'GET' && $path === '/api/uploads') {
        respond(['uploads' => $service->listUploads()]);
    }

    if ($method === 'POST' && $path === '/api/uploads/handshake') {
        respond($service->handshake(jsonInput()));
    }

    if ($method === 'GET' && preg_match('#^/api/uploads/(\d+)$#', $path, $m)) {
        respond($service->status((int) $m[1]));
    }

    if ($method === 'GET' && preg_match('#^/api/uploads/(\d+)/contents$#', $path, $m)) {
        respond($service->getZipContents((int) $m[1]));
    }

    if ($method === 'DELETE' && preg_match('#^/api/uploads/(\d+)$#', $path, $m)) {
        respond($service->deleteUpload((int) $m[1]));
    }

    if ($method === 'PUT' && preg_match('#^/api/uploads/(\d+)/chunks/(\d+)$#', $path, $m)) {
        $lengthHeader = $_SERVER['HTTP_X_CHUNK_LENGTH'] ?? $_SERVER['CONTENT_LENGTH'] ?? null;
        $contentLength = $lengthHeader !== null ? (int) $lengthHeader : null;
        $input = fopen('php://input', 'rb');
        respond($service->receiveChunk((int) $m[1], (int) $m[2], $input, $contentLength));
    }

    if ($method === 'POST' && preg_match('#^/api/uploads/(\d+)/finalize$#', $path, $m)) {
        respond($service->requestFinalize((int) $m[1]), 202);
    }

    respond(['error' => 'Not found', 'code' => 'NOT_FOUND'], 404);
} catch (TransientUploadException $e) {
    respond(['error' => $e->getMessage(), 'code' => 'TRANSIENT_FAILURE'], 503);
} catch (InvalidArgumentException $e) {
    respond(['error' => $e->getMessage(), 'code' => 'VALIDATION_ERROR'], 422);
} catch (RuntimeException $e) {
    respond(['error' => $e->getMessage(), 'code' => 'REQUEST_ERROR'], 409);
} catch (Throwable $e) {
    error_log((string) $e);
    respond(['error' => 'Internal server error', 'code' => 'INTERNAL_ERROR'], 500);
}
