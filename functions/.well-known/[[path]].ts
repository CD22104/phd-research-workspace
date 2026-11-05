import { handle } from '../../server/feed-bridge';
export const onRequest: PagesFunction<any> = ctx => handle(ctx.request,ctx.env);
