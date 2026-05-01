function authHeaders(record) {
  return {
    Authorization: `Bearer ${record.accessToken}`,
  };
}

async function fetchJson(url, record) {
  const response = await fetch(url, { headers: authHeaders(record) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error && (data.error.message || data.error_description)
      ? (data.error.message || data.error_description)
      : response.statusText;
    const err = new Error(detail || 'Cloud API request failed.');
    err.status = response.status === 401 ? 'expired' : 'error';
    err.httpStatus = response.status === 401 ? 401 : 502;
    throw err;
  }
  return data;
}

async function fetchQuota(record) {
  if (record.provider === 'gd') {
    const data = await fetchJson('https://www.googleapis.com/drive/v3/about?fields=storageQuota,user', record);
    const quota = data.storageQuota || {};
    return {
      provider: 'gd',
      user: data.user || null,
      storageUsed: Number(quota.usage || 0),
      storageTotal: quota.limit ? Number(quota.limit) : null,
      raw: data,
    };
  }

  const data = await fetchOneDriveDrive(record);
  return {
    provider: 'od',
    driveId: data.id || '',
    user: data.owner || null,
    storageUsed: data.quota && data.quota.used ? Number(data.quota.used) : 0,
    storageTotal: data.quota && data.quota.total ? Number(data.quota.total) : null,
    raw: data,
  };
}

async function fetchOneDriveDrive(recordOrToken) {
  const record = typeof recordOrToken === 'string'
    ? { accessToken: recordOrToken }
    : recordOrToken;
  return fetchJson('https://graph.microsoft.com/v1.0/me/drive', record);
}

async function listFiles(record, pageToken) {
  if (record.provider === 'gd') {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('pageSize', '20');
    url.searchParams.set('fields', 'nextPageToken,files(id,name,size,mimeType,modifiedTime)');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await fetchJson(url.toString(), record);
    return {
      files: (data.files || []).map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size ? Number(file.size) : null,
        type: file.mimeType || '',
        modified: file.modifiedTime || '',
      })),
      nextPageToken: data.nextPageToken || null,
    };
  }

  const url = new URL('https://graph.microsoft.com/v1.0/me/drive/root/children');
  url.searchParams.set('$select', 'id,name,size,file,folder,lastModifiedDateTime');
  const data = await fetchJson(url.toString(), record);
  return {
    files: (data.value || []).map((file) => ({
      id: file.id,
      name: file.name,
      size: Number(file.size || 0),
      type: file.file ? 'file' : 'folder',
      modified: file.lastModifiedDateTime || '',
    })),
    nextPageToken: null,
  };
}

module.exports = {
  fetchQuota,
  fetchOneDriveDrive,
  listFiles,
};
