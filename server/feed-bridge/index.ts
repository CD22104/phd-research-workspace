import { HttpError, type Env } from '../db';
import { SCOPE, boundTasks, origin, resource, reply, readJson, object, challenge, checkOrigin } from './common';
import { access, authorize, connections, metadata, register, resourceMetadata, revoke, token } from './oauth';
import { saveReport, getReport } from './reports';
const securitySchemes = [{type:'oauth2',scopes:SCOPE.split(' ')}];
// 工具的任务参数按网站里已绑定的任务生成；还没有绑定时不限制取值（保存会被拒绝）
export async function toolsFor(env: Env) {
  const bound = await boundTasks(env);
  const keys = bound.map((b) => b.task_key);
  const names = [...new Set(bound.flatMap((b) => [b.task_name, ...b.aliases]))];
  const selector = {task_key:{type:'string',...(keys.length ? {enum:keys} : {})},task_name:{type:'string',...(names.length ? {enum:names} : {})}};
  return [
  {name:'save_feed_result',title:'归档完整信息流报告',description:'将已经生成的完整 Markdown 报告写入本人 Research Workspace 信息流。只允许网站「信息流」里已填写 ChatGPT 归档编号的任务。相同任务、报告日期、run_key 与内容重试返回原回执；正文修订另存版本。不能用摘要替代完整报告。run_key 建议使用该次 Scheduled Task 的稳定运行标识；重试和修订保持相同值。未提供时视作当天一期。',
    inputSchema:{type:'object',properties:{...selector,report_date:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$',description:'报告归属日 YYYY-MM-DD（按网站时区）'},title:{type:'string',minLength:1,maxLength:300},markdown:{type:'string',minLength:1,maxLength:400000,description:'完整 Markdown，原样保存'},content_status:{type:'string',enum:['complete','partial','no_updates']},run_key:{type:'string',minLength:1,maxLength:200},source_url:{type:'string',maxLength:2048}},required:['report_date','title','markdown','content_status'],anyOf:[{required:['task_key']},{required:['task_name']}],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},securitySchemes},
  {name:'get_feed_result',title:'查询信息流归档回执',description:'查询此接入归档的报告 ID、运行 ID、版本、哈希和时间戳；不会返回其他研究数据或正文。指定 task_key/task_name，加 report_id 或 report_date（可加 run_key）。最多返回最近 50 个版本。',
    inputSchema:{type:'object',properties:{...selector,report_date:{type:'string'},run_key:{type:'string',maxLength:200},report_id:{type:'integer',minimum:1}},anyOf:[{required:['task_key']},{required:['task_name']}],additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},securitySchemes}
];
}
const rpcError = (id: any, code: number, message: string, status=200) => reply({jsonrpc:'2.0',id:id ?? null,error:{code,message}},status);
export async function handle(req: Request, env: Env): Promise<Response> {
  try {
    const o=origin(env),path=new URL(req.url).pathname;
    // Preview deployment URLs cannot become alternative public authorization hosts.
    if (new URL(req.url).origin !== o) return reply({error:'not_found'},404);
    checkOrigin(req,env);
    if (req.method === 'GET' && path === '/.well-known/oauth-authorization-server') return reply(metadata(env));
    if (req.method === 'GET' && path === '/.well-known/oauth-protected-resource/feed-bridge/mcp') return reply(resourceMetadata(env));
    if (path === '/feed-connect/authorize') return await authorize(req,env);
    if (path === '/feed-connect/connections' && ['GET','POST'].includes(req.method)) return await connections(req,env);
    if (req.method === 'POST') {
      if (path === '/feed-bridge/register') return await register(req,env);
      if (path === '/feed-bridge/token') return await token(req,env);
      if (path === '/feed-bridge/revoke') return await revoke(req,env);
    }
    if (!['/feed-bridge/mcp','/feed-bridge/reports','/feed-bridge/receipt'].includes(path)) return reply({error:'not_found'},404);
    const grant=await access(req,env); if (!grant) return challenge(env);
    if (req.method !== 'POST') return reply({error:'method_not_allowed'},405,{Allow:'POST'});
    const input=await readJson(req);object(input);
    if (path !== '/feed-bridge/mcp') {
      const required=path.endsWith('/reports') ? 'feeds:save':'feeds:read';
      if (!grant.scope.split(' ').includes(required)) return reply({error:'insufficient_scope'},403);
      const result=required === 'feeds:save' ? await saveReport(env,input) : await getReport(env,input);
      return reply(result,('created' in result && result.created) ? 201:200);
    }
    if (input.jsonrpc !== '2.0' || typeof input.method !== 'string') return rpcError(input.id,-32600,'Invalid Request',400);
    if (input.id !== undefined && !['string','number'].includes(typeof input.id)) return rpcError(null,-32600,'Invalid Request',400);
    if (input.id === undefined) return new Response(null,{status:202});
    let result: any;
    switch (input.method) {
      case 'initialize': {
        const versions=['2025-11-25','2025-06-18','2025-03-26'];
        result={protocolVersion:versions.includes(input.params?.protocolVersion) ? input.params.protocolVersion:versions[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'honey-feed-archive',version:'1.0.0'},instructions:'仅归档已生成的完整报告。工具成功只证明保存成功，不证明 Scheduled Task 无人值守联通。'};break;
      }
      case 'ping':result={};break;
      case 'tools/list':result={tools:(await toolsFor(env)).filter(t=>grant.scope.split(' ').includes(t.name === 'save_feed_result' ? 'feeds:save':'feeds:read'))};break;
      case 'tools/call': {
        const name=input.params?.name;
        if (!['save_feed_result','get_feed_result'].includes(name)) return rpcError(input.id,-32602,'Unknown tool');
        if (!grant.scope.split(' ').includes(name === 'save_feed_result' ? 'feeds:save':'feeds:read')) return rpcError(input.id,-32602,'Insufficient scope');
        try {
          const data=name === 'save_feed_result' ? await saveReport(env,input.params.arguments) : await getReport(env,input.params.arguments);
          result={content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:false};
        } catch(e) {
          result={isError:true,content:[{type:'text',text:e instanceof HttpError ? e.message:'archive_failed_retry_same_run_key'}]};
        }
        break;
      }
      default:return rpcError(input.id,-32601,'Method not found');
    }
    return reply({jsonrpc:'2.0',id:input.id,result});
  } catch(e) {
    // Never log OAuth headers, codes, report bodies or raw database errors.
    return reply({error:e instanceof HttpError ? e.message:'integration_error'},e instanceof HttpError ? e.status:500);
  }
}
