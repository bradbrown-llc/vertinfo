const VERTPUBINFOKVPATH = Deno.env.get("DENO_KV_PATH");
if (!VERTPUBINFOKVPATH) {
  throw new Error(`missing required env var 'VERTPUBINFOKVPATH'`);
}

const ISLOCAL = Deno.env.get("ISLOCAL");
export const kv = await Deno.openKv(ISLOCAL ? VERTPUBINFOKVPATH : undefined);
