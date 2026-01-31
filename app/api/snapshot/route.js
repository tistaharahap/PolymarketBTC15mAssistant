import { computeSnapshot } from "../../../src/web/snapshot.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const out = await computeSnapshot();
    return Response.json(out, {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch (e) {
    return Response.json(
      { error: e?.message ?? String(e) },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
