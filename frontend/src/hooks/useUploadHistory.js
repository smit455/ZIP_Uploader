import { useCallback, useEffect, useState } from 'react';
import { deleteUpload, getUploads } from '../services/api';

export function useUploadHistory() {
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const data = await getUploads();
      setUploads(data.uploads || []);
    } catch (err) {
      setError(err.message || 'Failed to load upload history');
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(async (uploadId) => {
  await deleteUpload(uploadId);

  // Remove from UI only after backend confirms deletion
  setUploads((current) =>
    current.filter((upload) => Number(upload.id) !== Number(uploadId))
  );

  // Confirm the database is now the source of truth
  await refresh();
}, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { uploads, loading, error, refresh, remove };
}
