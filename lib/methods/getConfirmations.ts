import * as jsonRpc from "../jsonRpc/mod.ts";
import { JsonRpcRequest, EconConf } from '../types/mod.ts'
import { kv } from '../kv.ts'
import * as error  from '../errors/mod.ts'
import * as schemas from '../schemas/mod.ts'

export async function getConfirmations(
  { id, params }: Pick<JsonRpcRequest, "id" | "params">,
) {
  const paramsParseResult = await schemas.api.chainIdOnlyParam.parseAsync(params)
    .catch((_) => new Error());
  if (paramsParseResult instanceof Error) return error.invalidParams(id);
  const { chainId } = paramsParseResult;

  const kvem = await kv.get<EconConf>(["confirmations", chainId]);
  return jsonRpc.response({ result: kvem.value, id });
}