// Phase C2a (9), library recent files list.
// GET /api/library/recent, the caller's newest library files of any
// kind, newest first, with the meeting title each belongs to.
import { NextRequest } from 'next/server';
import { internalError } from '../../_lib/security';
import { listLibraryFilesForUser } from '../../_lib/libraryLists';

export async function GET(req: NextRequest) {
  try {
    return await listLibraryFilesForUser(req, 'library-recent', null, 30);
  } catch (err) {
    return internalError('Library Recent API', err);
  }
}
