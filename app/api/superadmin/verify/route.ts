import { NextRequest, NextResponse } from 'next/server';
import { checkSuperadminRole } from '../lib';

// POST /api/superadmin/verify { accessToken }
// The portal gate: verifies the session server-side and reports
// whether the signed-in user holds the superadmin role in the
// database. A signed-in non-superadmin gets isSuperadmin: false
// (the portal shows Access Denied); an invalid token gets 401.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await checkSuperadminRole(body?.accessToken);
    if (!result) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Your session is invalid or has expired. Please sign in again.' },
        { status: 401 }
      );
    }
    return NextResponse.json({
      ok: true,
      isSuperadmin: result.isSuperadmin,
      email: result.user.email || null,
      userId: result.user.id,
    });
  } catch (err: any) {
    console.error('[Superadmin Verify] Internal Exception:', err);
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' },
      { status: 500 }
    );
  }
}
