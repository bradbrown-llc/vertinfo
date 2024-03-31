import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const ISLOCAL = Deno.env.get("ISLOCAL");

const VERTPUBINFOKVPATH = Deno.env.get("DENO_KV_PATH");
if (!VERTPUBINFOKVPATH) {
  throw new Error(`missing required env var 'VERTPUBINFOKVPATH'`);
}

const kv = await Deno.openKv(ISLOCAL ? VERTPUBINFOKVPATH : undefined);

type EconConf = {
  gasLimitMultiplier: [numerator: bigint, denominator: bigint];
  gasPriceMultiplier: [numerator: bigint, denominator: bigint];
  baseFee: bigint;
};

const jsonRpcSchema = {
  get base() {
    return z.object({
      jsonrpc: z.literal("2.0"),
      id: z.string().or(z.number()).or(z.null()),
    });
  },

  get request() {
    return jsonRpcSchema.base.and(z.object({
      method: z.string(),
      params: z.object({}).passthrough(),
    }));
  },

  get errorObject() {
    return z.object({
      code: z.number(),
      message: z.string(),
    });
  },

  get errorResponse() {
    return jsonRpcSchema.base.and(z.object({
      error: jsonRpcSchema.errorObject,
    }));
  },

  get response() {
    return jsonRpcSchema.base.and(z.object({
      result: z.unknown(),
    }));
  },
};

const apiSchema = {
  get chainIdOnlyParam() {
    return z.object({ chainId: z.number() });
  },

  get getBurnStatusParam() {
    return z.object({ hash: z.string() });
  },

  get methods() {
    return z.union([
      z.literal("get_econConf"),
      z.literal("get_activeChains"),
      z.literal("get_confirmations"),
      z.literal("get_burnStatus"),
    ]);
  },
};

type JsonRpcId = string | number | null;

type JsonRpcErrorObject = z.infer<typeof jsonRpcSchema.errorObject>;

type JsonRpcErrorResponse = z.infer<typeof jsonRpcSchema.errorResponse>;

type JsonRpcResponse = z.infer<typeof jsonRpcSchema.response>;

type JsonRpcErrorOptions = {
  code: number;
  message: string;
  status: number;
  id?: JsonRpcId;
};

type JsonRpcResponseOptions = { result: unknown; id: JsonRpcId };

type JsonRpcRequest = z.infer<typeof jsonRpcSchema.request>;

function jsonRpcError({ code, message, status, id }: JsonRpcErrorOptions) {
  const error: JsonRpcErrorObject = { code, message };
  const response: JsonRpcErrorResponse = {
    jsonrpc: "2.0",
    error,
    id: id ?? null,
  };
  return new Response(JSON.stringify(response), { status });
}

function replacer(_key: string, value: unknown) {
  return typeof value == "bigint" ? `0x${value.toString(16)}` : value;
}

function jsonRpcResponse({ result, id }: JsonRpcResponseOptions) {
  const response: JsonRpcResponse = { jsonrpc: "2.0", result, id: id ?? null };
  return new Response(JSON.stringify(response, replacer), { status: 200 });
}

function badParseError() {
  return jsonRpcError({ code: -32700, message: "Parse error.", status: 500 });
}

function invalidParamsError(id: JsonRpcId) {
  return jsonRpcError({
    code: -32602,
    message: "Invalid params.",
    status: 500,
    id,
  });
}

function rateLimitError() {
  return jsonRpcError({ code: -32005, message: "Rate limited.", status: 429 });
}

function badMethodError() {
  return jsonRpcError({
    code: -32601,
    message: "Method not found.",
    status: 404,
  });
}

const lastRequestTimeMap: Map<string, number> = new Map();

function rateLimit(info: Deno.ServeHandlerInfo) {
  const lastRequestTime = lastRequestTimeMap.get(info.remoteAddr.hostname);
  if (!lastRequestTime) return false;
  return Date.now() - lastRequestTime < 1000;
}

async function getEconConf(
  { id, params }: Pick<JsonRpcRequest, "id" | "params">,
) {
  const paramsParseResult = await apiSchema.chainIdOnlyParam.parseAsync(params)
    .catch((_) => new Error());
  if (paramsParseResult instanceof Error) return invalidParamsError(id);
  const { chainId } = paramsParseResult;

  const kvem = await kv.get<EconConf>(["econConf", chainId]);
  return jsonRpcResponse({ result: kvem.value, id });
}

async function getActiveChains({ id }: Pick<JsonRpcRequest, "id">) {
  const kvem = await kv.get<number[]>(["chains"]);
  return jsonRpcResponse({ result: kvem.value, id });
}

async function getConfirmations(
  { id, params }: Pick<JsonRpcRequest, "id" | "params">,
) {
  const paramsParseResult = await apiSchema.chainIdOnlyParam.parseAsync(params)
    .catch((_) => new Error());
  if (paramsParseResult instanceof Error) return invalidParamsError(id);
  const { chainId } = paramsParseResult;

  const kvem = await kv.get<EconConf>(["confirmations", chainId]);
  return jsonRpcResponse({ result: kvem.value, id });
}

async function getBurnStatus(
  { id, params }: Pick<JsonRpcRequest, "id" | "params">,
) {
  const paramsParseResult = await apiSchema.getBurnStatusParam.parseAsync(
    params,
  ).catch((_) => new Error());
  if (paramsParseResult instanceof Error) return invalidParamsError(id);
  const { hash } = paramsParseResult;

  const kvem = await kv.get<EconConf>(["status", hash]);
  return jsonRpcResponse({ result: kvem.value, id });
}

async function handler(
  request: Request,
  info: Deno.ServeHandlerInfo,
): Promise<Response> {
  if (rateLimit(info)) return rateLimitError();
  lastRequestTimeMap.set(info.remoteAddr.hostname, Date.now());

  if (!request.body) return badParseError();

  let body = "";
  for await (const bytes of request.body.values()) {
    for (const byte of bytes) body += String.fromCharCode(byte);
  }

  try {
    JSON.parse(body);
  } catch (_) {
    return badParseError();
  }

  const requestParseResult = await jsonRpcSchema.request.parseAsync(
    JSON.parse(body),
  ).catch((_) => new Error());
  if (requestParseResult instanceof Error) return badParseError();
  const { method: unparsedMethod, params, id } = requestParseResult;

  const methodParseResult = await apiSchema.methods.parseAsync(unparsedMethod)
    .catch((_) => new Error());
  if (methodParseResult instanceof Error) return badMethodError();
  const method = methodParseResult;

  switch (method) {
    case "get_econConf":
      return getEconConf({ params, id });
    case "get_activeChains":
      return getActiveChains({ id });
    case "get_confirmations":
      return getConfirmations({ params, id });
    case "get_burnStatus":
      return getBurnStatus({ params, id });
  }
}

const options: Deno.ServeOptions = { port: 8001 };

Deno.serve(options, handler);
