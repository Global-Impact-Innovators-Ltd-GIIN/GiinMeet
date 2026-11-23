// Phase C2a (9), library certificates list.
// GET /api/library/certificates, certificate files the caller hosts,
// newest first, with the meeting title each belongs to.
import { NextRequest } from 'next/server';
import { internalError } from '../../_lib/security';
import { listLibraryFilesForUser } from '../../_lib/libraryLists';

export async function GET(req: NextRequest) {
  try {
    return await listLibraryFilesForUser(req, 'library-certificates', 'certificate', 50);
  } catch (err) {
    return internalError('Library Certificates API', err);
  }
}
