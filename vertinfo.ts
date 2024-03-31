import { rateLimit, lastRequestTimeMap } from './lib/rateLimit.ts'
import * as errors from './lib/errors/mod.ts'
import * as schemas from './lib/schemas/mod.ts'
import * as methods  from './lib/methods/mod.ts'

async function handler(request: Request, info: Deno.ServeHandlerInfo):Promise<Response> {

  if (rateLimit(info)) return errors.rateLimit()
  lastRequestTimeMap.set(info.remoteAddr.hostname, Date.now())

  if (!request.body) return errors.badParse()

  let body = ''
  for await (const bytes of request.body.values())
    for (const byte of bytes) body += String.fromCharCode(byte)
  
  try { JSON.parse(body) } catch(_) { return errors.badParse() }

  const requestParseResult = await schemas.jsonRpc.request.parseAsync(JSON.parse(body)).catch(_ => new Error())
  if (requestParseResult instanceof Error) return errors.badParse()
  const { method:unparsedMethod, params, id } = requestParseResult

  const methodParseResult = await schemas.api.methods.parseAsync(unparsedMethod).catch(_ => new Error())
  if (methodParseResult instanceof Error) return errors.badMethod()
  const method = methodParseResult

  switch(method) {
    case 'get_econConf': return methods.getEconConf({ params, id })
    case 'get_activeChains': return methods.getActiveChains({ id })
    case 'get_confirmations': return methods.getConfirmations({ params, id })
    case 'get_burnStatus': return methods.getBurnStatus({ params, id })
  }
  
} 

const options:Deno.ServeOptions = { port: 8001 }

Deno.serve(options, handler)