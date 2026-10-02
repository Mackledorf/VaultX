import { google } from 'googleapis';
import { bufferToStream } from './local.js';

const MANIFEST_FILE = 'vaultx-manifest.json';

export function createGoogleDriveStorageAdapter() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const credentialsFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const configured = Boolean(folderId && (serviceAccountJson || credentialsFile));
  let driveClient;
  let manifestFileId;

  async function getDrive() {
    if (driveClient) {
      return driveClient;
    }

    const auth = serviceAccountJson
      ? new google.auth.GoogleAuth({
        credentials: JSON.parse(serviceAccountJson),
        scopes: ['https://www.googleapis.com/auth/drive'],
      })
      : new google.auth.GoogleAuth({
        keyFile: credentialsFile,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });

    driveClient = google.drive({ version: 'v3', auth });
    return driveClient;
  }

  async function ensureManifestFile() {
    if (manifestFileId) {
      return manifestFileId;
    }

    const drive = await getDrive();
    const listResponse = await drive.files.list({
      q: `'${folderId}' in parents and name = '${MANIFEST_FILE}' and trashed = false`,
      fields: 'files(id, name)',
      spaces: 'drive',
      pageSize: 1,
    });
    const existing = listResponse.data.files?.[0];

    if (existing?.id) {
      manifestFileId = existing.id;
      return manifestFileId;
    }

    const createResponse = await drive.files.create({
      requestBody: {
        name: MANIFEST_FILE,
        parents: [folderId],
        mimeType: 'application/json',
      },
      media: {
        mimeType: 'application/json',
        body: bufferToStream(Buffer.from('{"version":1,"collections":[],"entries":[]}')),
      },
      fields: 'id',
    });

    manifestFileId = createResponse.data.id;
    return manifestFileId;
  }

  return {
    provider: 'google-drive',
    configured,
    async readManifest() {
      const drive = await getDrive();
      const fileId = await ensureManifestFile();
      const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });

      return JSON.parse(response.data || '{}');
    },
    async writeManifest(manifest) {
      const drive = await getDrive();
      const fileId = await ensureManifestFile();

      await drive.files.update({
        fileId,
        media: {
          mimeType: 'application/json',
          body: bufferToStream(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)),
        },
      });
    },
    async uploadFile({ file }) {
      const drive = await getDrive();
      const response = await drive.files.create({
        requestBody: {
          name: file.originalname,
          parents: [folderId],
          mimeType: file.mimetype,
        },
        media: {
          mimeType: file.mimetype,
          body: bufferToStream(file.buffer),
        },
        fields: 'id',
      });

      return { fileId: response.data.id };
    },
    async deleteFile(fileId) {
      const drive = await getDrive();
      await drive.files.delete({ fileId }).catch(() => undefined);
    },
    async streamFile(fileId, range) {
      const drive = await getDrive();
      const metadata = await drive.files.get({ fileId, fields: 'size' });
      const response = await drive.files.get(
        { fileId, alt: 'media' },
        {
          responseType: 'stream',
          headers: range ? { Range: range } : undefined,
        },
      );
      const contentRange = response.headers['content-range'];
      const parsedRange = parseContentRange(contentRange);

      return {
        stream: response.data,
        size: Number(metadata.data.size || response.headers['content-length'] || 0),
        range: parsedRange,
      };
    },
  };
}

function parseContentRange(contentRange) {
  if (!contentRange || typeof contentRange !== 'string') {
    return null;
  }

  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(contentRange);

  if (!match) {
    return null;
  }

  return {
    start: Number(match[1]),
    end: Number(match[2]),
  };
}